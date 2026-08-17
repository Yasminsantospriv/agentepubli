import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createCaption, createCreativeBrief, generateCarouselAsset } from "./ai";
import {
  ensureRun,
  getRegenerationSeed,
  getRunContext,
  insertCandidates,
  saveAsset,
  updateRun
} from "./db";
import type { ContentWorkflowParams, CreativeBrief, GeneratedAsset, TriggerType } from "./types";
import { discoverTrends, downloadReference, storeReference } from "./trends";

const retryPolicy = {
  retries: { limit: 2, delay: "5 seconds", backoff: "exponential" as const },
  timeout: "5 minutes"
} as const;

const generationPolicy = {
  retries: { limit: 2, delay: "10 seconds", backoff: "exponential" as const },
  timeout: "10 minutes"
} as const;

export class ContentWorkflow extends WorkflowEntrypoint<Env, ContentWorkflowParams> {
  async run(event: WorkflowEvent<ContentWorkflowParams>, step: WorkflowStep): Promise<{ runId: string; status: string }> {
    const payload = event.payload ?? {};
    const runId = payload.runId ?? event.instanceId;
    const trigger: TriggerType = payload.trigger ?? "scheduled";

    try {
      await step.do("initialize-run", async () => {
        await ensureRun(this.env.DB, runId, event.instanceId, trigger);
      });

      const contextJson = await step.do("load-private-configuration", async () => JSON.stringify(await getRunContext(this.env.DB)));
      const context = JSON.parse(contextJson) as Awaited<ReturnType<typeof getRunContext>>;
      if (context.identityRefs.length < 3) {
        await step.do("mark-identity-setup-needed", async () => {
          await updateRun(this.env.DB, runId, {
            status: "needs_setup",
            error_message: "Envie 3 referências canônicas da Yasmin, com no máximo 512 × 512 px."
          });
        });
        return { runId, status: "needs_setup" };
      }
      if (context.sources.length === 0) {
        await step.do("mark-source-setup-needed", async () => {
          await updateRun(this.env.DB, runId, {
            status: "needs_setup",
            error_message: "Cadastre ao menos uma fonte adulta verificada entre 19 e 23 anos."
          });
        });
        return { runId, status: "needs_setup" };
      }

      let brief: CreativeBrief | null = null;
      if (trigger === "regenerate" && payload.sourceRunId) {
        const seed = await step.do("load-regeneration-seed", async () => getRegenerationSeed(this.env.DB, payload.sourceRunId as string));
        if (seed) {
          brief = seed.brief;
          await step.do("copy-regeneration-context", async () => {
            await updateRun(this.env.DB, runId, {
              selected_candidate_id: seed.selectedCandidateId,
              selected_platform: seed.selectedPlatform,
              selected_source_url: seed.selectedSourceUrl,
              selected_reference_key: seed.selectedReferenceKey,
              concept: brief?.concept ?? null,
              brief_json: JSON.stringify(brief)
            });
          });
        }
      }

      if (!brief) {
        const candidates = await step.do("discover-adult-trend-signals", retryPolicy, async () => {
          const found = await discoverTrends(this.env, context);
          await insertCandidates(this.env.DB, runId, found);
          return found;
        });
        const selected = candidates[0];
        if (!selected) {
          await step.do("mark-no-candidates", async () => {
            await updateRun(this.env.DB, runId, {
              status: "no_candidates",
              error_message: "Nenhuma referência elegível foi encontrada nesta execução."
            });
          });
          return { runId, status: "no_candidates" };
        }

        const storedReference = await step.do("capture-private-reference", retryPolicy, async () => {
          const image = await downloadReference(selected);
          const key = await storeReference(this.env.BUCKET, runId, selected, image);
          await updateRun(this.env.DB, runId, {
            selected_candidate_id: selected.id,
            selected_platform: selected.platform,
            selected_source_url: selected.sourceUrl,
            selected_reference_key: key
          });
          return { key, contentType: image.contentType };
        });

        brief = await step.do("derive-original-creative-brief", retryPolicy, async () => {
          const object = await this.env.BUCKET.get(storedReference.key);
          if (!object || object.size > 4_000_000) throw new Error("Stored reference is unavailable or too large");
          const result = await createCreativeBrief(
            this.env,
            selected,
            { bytes: new Uint8Array(await object.arrayBuffer()), contentType: storedReference.contentType },
            context.brandProfile,
            context.contentPolicy
          );
          if (!result.platformSafe) throw new Error("Creative brief did not pass platform-safety screening");
          await updateRun(this.env.DB, runId, {
            concept: result.concept,
            brief_json: JSON.stringify(result)
          });
          return result;
        });
      }

      if (!brief) throw new Error("Creative brief was not created");
      const finalBrief: CreativeBrief = brief;
      const caption = await step.do("write-caption", retryPolicy, async () => {
        const value = await createCaption(this.env, finalBrief, context.captionStyle);
        await updateRun(this.env.DB, runId, { caption: value });
        return value;
      });

      const requestedSize = Number.parseInt(this.env.CAROUSEL_SIZE, 10);
      const carouselSize = Number.isFinite(requestedSize) ? Math.max(1, Math.min(3, requestedSize)) : 3;
      const assets: GeneratedAsset[] = [];
      for (let position = 1; position <= carouselSize; position += 1) {
        const asset = await step.do(`generate-and-audit-frame-${position}`, generationPolicy, async () => {
          const generated = await generateCarouselAsset(
            this.env,
            runId,
            position,
            finalBrief,
            context.brandProfile,
            context.identityRefs
          );
          await saveAsset(this.env.DB, runId, generated);
          return generated;
        });
        assets.push(asset);
      }

      const allPassed = assets.length === carouselSize && assets.every((asset) => asset.status === "passed");
      const finalStatus = allPassed ? "ready" : "blocked";
      await step.do("finalize-review-package", async () => {
        await updateRun(this.env.DB, runId, {
          status: finalStatus,
          caption,
          moderation_json: JSON.stringify(assets.map((asset) => ({ position: asset.position, audit: asset.audit }))),
          error_message: allPassed ? null : "Uma ou mais imagens foram bloqueadas pela auditoria e precisam ser regeneradas."
        });
      });
      return { runId, status: finalStatus };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unexpected workflow failure";
      await step.do("record-workflow-failure", async () => {
        await updateRun(this.env.DB, runId, { status: "failed", error_message: message });
      });
      throw error;
    }
  }
}
