(() => {
  "use strict";

  const MODEL = "yasmin";
  const state = {
    token: sessionStorage.getItem("yasmin_token") || "",
    view: (location.hash || "#dashboard").replace("#", ""),
    dashboard: null,
    health: null,
    providers: [],
    references: [],
    generationAssets: [],
    blobUrls: new Map(),
    agentMessages: [
      { role: "agent", text: "Comando rápido ativo. Posso preparar uma geração, criar legenda ou levar você direto para a ferramenta certa." }
    ],
  };

  const el = (id) => document.getElementById(id);
  const root = el("viewRoot");
  const dialog = el("dialog");
  const titles = {
    dashboard: ["YASMIN AI STUDIO", "Dashboard"],
    create: ["GENERATION STUDIO", "Create"],
    library: ["CONTENT", "Library"],
    references: ["IDENTITY", "References"],
    trends: ["DISCOVERY", "Trends"],
    planner: ["CONTENT CALENDAR", "Planner"],
    automations: ["WORKFLOWS", "Automations"],
    agent: ["COMMAND CENTER", "AI Agent"],
    settings: ["SYSTEM", "Settings"],
  };

  const escapeHtml = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const safeJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  };

  const dateTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
  };

  function toast(message, type = "success") {
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    el("toastRoot").appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function openDialog(title, html) {
    el("dialogTitle").textContent = title;
    el("dialogBody").innerHTML = html;
    dialog.showModal();
  }

  function setBusy(button, busy, label = "Processando…") {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(path, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
    if (!response.ok || payload?.success === false) {
      if (response.status === 401) {
        clearSession();
        showLogin("Sua sessão expirou. Entre novamente.");
      }
      const error = new Error(payload?.error?.message || `Erro HTTP ${response.status}`);
      error.details = payload?.error?.details;
      error.status = response.status;
      throw error;
    }
    return payload?.data ?? payload;
  }

  async function assetUrl(storageKey) {
    if (!storageKey) return "";
    if (state.blobUrls.has(storageKey)) return state.blobUrls.get(storageKey);
    const response = await fetch(`/assets/${encodeURI(storageKey)}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) throw new Error("Não foi possível carregar a imagem.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    state.blobUrls.set(storageKey, url);
    return url;
  }

  function clearBlobUrls() {
    for (const url of state.blobUrls.values()) URL.revokeObjectURL(url);
    state.blobUrls.clear();
  }

  function showLogin(message = "") {
    el("appShell").classList.add("hidden");
    el("loginScreen").classList.remove("hidden");
    el("loginMessage").textContent = message;
    setTimeout(() => el("loginPassword")?.focus(), 50);
  }

  function showApp() {
    el("loginScreen").classList.add("hidden");
    el("appShell").classList.remove("hidden");
  }

  function clearSession() {
    state.token = "";
    sessionStorage.removeItem("yasmin_token");
    clearBlobUrls();
  }

  async function validateSession() {
    if (!state.token) return false;
    try {
      await api("/dashboard");
      return true;
    } catch {
      return false;
    }
  }

  function navigate(view) {
    if (!titles[view]) view = "dashboard";
    location.hash = `#${view}`;
  }

  function closeMobileMenu() {
    el("sidebar").classList.remove("open");
    el("sidebarBackdrop").classList.remove("show");
  }

  function updateChrome(view) {
    const [eyebrow, title] = titles[view] || titles.dashboard;
    el("pageEyebrow").textContent = eyebrow;
    el("pageTitle").textContent = title;
    document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  }

  async function renderCurrent() {
    const view = (location.hash || "#dashboard").replace("#", "");
    state.view = titles[view] ? view : "dashboard";
    updateChrome(state.view);
    closeMobileMenu();
    root.innerHTML = `<div class="grid grid-3"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
    try {
      const renderer = views[state.view] || views.dashboard;
      await renderer();
    } catch (err) {
      console.error(err);
      root.innerHTML = `<div class="card"><h3>Não foi possível carregar esta área</h3><p class="muted">${escapeHtml(err.message || "Erro inesperado")}</p><button class="btn btn-primary" id="retryView">Tentar novamente</button></div>`;
      el("retryView")?.addEventListener("click", renderCurrent);
    }
  }

  async function loadHealth() {
    try {
      state.health = await api("/health");
      const allCoreOnline = ["api", "database", "storage"].every((key) => state.health?.[key] === "ONLINE");
      el("sidebarStatusDot").className = `status-dot ${allCoreOnline ? "online" : "offline"}`;
      el("sidebarStatus").textContent = allCoreOnline ? "Sistema operacional" : "Verificar configuração";
    } catch {
      el("sidebarStatusDot").className = "status-dot offline";
      el("sidebarStatus").textContent = "Sistema indisponível";
    }
  }

  const healthHtml = (health = {}) => Object.entries(health).map(([key, value]) => {
    const badge = value === "ONLINE" ? "success" : value === "NOT_CONFIGURED" ? "warning" : "danger";
    return `<div class="health-item"><strong>${escapeHtml(key.replaceAll("_", " "))}</strong><span class="badge ${badge}">${escapeHtml(value)}</span></div>`;
  }).join("");

  async function renderDashboard() {
    const [dashboard, health, providers] = await Promise.all([
      api("/dashboard"),
      api("/health"),
      api("/providers").catch(() => []),
    ]);
    state.dashboard = dashboard;
    state.health = health;
    state.providers = providers;
    const activeProvider = providers.find((p) => p.active && p.status === "ONLINE") || providers.find((p) => p.status === "ONLINE");

    root.innerHTML = `
      <div class="hero">
        <div><p class="eyebrow">CENTRO DE COMANDO</p><h3>Boa noite. Yasmin está pronta para criar.</h3><p>Geração, referências, conteúdo e automações em um único painel.</p></div>
        <button class="btn btn-primary btn-lg" data-go="create">+ Gerar imagem</button>
      </div>
      <div class="cards">
        ${statCard("Referências", dashboard.references_count, "ativas no vault")}
        ${statCard("Geradas hoje", dashboard.content_generated_today, "jobs de geração")}
        ${statCard("Conteúdo pronto", dashboard.content_ready, "itens READY")}
        ${statCard("Oportunidades", dashboard.trend_opportunities, "sugestões abertas")}
        ${statCard("Automações", dashboard.active_automations, "regras ativas")}
      </div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>System Health</h3><span class="badge ${activeProvider ? "success" : "warning"}">${escapeHtml(activeProvider?.name || "Sem provider ativo")}</span></div>
          <div class="health-grid">${healthHtml(health)}</div>
        </section>
        <section class="card">
          <div class="card-head"><h3>Ações rápidas</h3><span class="muted small">Atalhos</span></div>
          <div class="quick-grid">
            <button class="quick-action" data-go="create"><span>✦</span><strong>Generate Image</strong></button>
            <button class="quick-action" data-go="references"><span>◈</span><strong>Add Reference</strong></button>
            <button class="quick-action" data-go="trends"><span>↗</span><strong>Analyze Trend</strong></button>
            <button class="quick-action" data-go="agent"><span>✧</span><strong>Content Idea</strong></button>
          </div>
        </section>
      </div>
      <div class="section-title"><div><h3>Atividade recente</h3><p>Eventos mais recentes registrados pelo backend.</p></div></div>
      <section class="card">
        <div class="list">
          ${(dashboard.recent_activity || []).length ? dashboard.recent_activity.map(activityRow).join("") : empty("Nenhuma atividade registrada ainda.")}
        </div>
      </section>`;
    bindGoButtons();
  }

  function statCard(label, value, note) {
    return `<div class="stat-card"><span class="stat-label">${escapeHtml(label)}</span><strong class="stat-value">${Number(value || 0)}</strong><span class="stat-note">${escapeHtml(note)}</span></div>`;
  }

  function activityRow(item) {
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(item.description || item.event_type || "Atividade")}</div><div class="list-row-meta">${escapeHtml(item.event_type || "EVENT")} · ${dateTime(item.created_at)}</div></div><span class="badge purple">${escapeHtml((item.event_type || "LOG").replaceAll("_", " "))}</span></div>`;
  }

  function bindGoButtons() {
    root.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  }

  async function renderCreate() {
    const providers = await api("/providers").catch(() => []);
    state.providers = providers;
    const providerOptions = providers.filter((p) => p.status === "ONLINE").map((p) => `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)}</option>`).join("");

    root.innerHTML = `
      <div class="generation-layout">
        <section class="card">
          <div class="card-head"><h3>Nova geração</h3><span class="badge purple">Yasmin</span></div>
          <form id="generateForm" class="stack gap-md">
            <label class="field"><span>O que você quer criar?</span><textarea id="generatePrompt" required placeholder="Ex.: Yasmin em uma cafeteria elegante, luz suave, olhando para a câmera…"></textarea></label>
            <div class="grid grid-2">
              <label class="field"><span>Formato</span><select id="generateFormat"><option>1:1</option><option selected>4:5</option><option>9:16</option><option value="landscape">Landscape</option></select></label>
              <label class="field"><span>Identity Lock</span><select id="identityLock"><option>NORMAL</option><option selected>STRONG</option><option>MAXIMUM</option><option>OFF</option></select></label>
              <label class="field"><span>Provider</span><select id="providerSelect"><option value="">AUTO / fallback</option>${providerOptions}</select></label>
              <label class="field"><span>Quantidade</span><select id="quantity"><option>1</option><option>2</option><option>4</option></select></label>
            </div>
            <label class="field"><span>Roupa — descrição opcional</span><input id="clothingDescription" placeholder="Ex.: vestido preto minimalista" /></label>
            <label class="field"><span>Cenário — descrição opcional</span><input id="sceneDescription" placeholder="Ex.: hotel moderno, luz noturna" /></label>
            <button id="generateBtn" class="btn btn-primary btn-lg" type="submit">✦ GERAR</button>
          </form>
          <div class="section-title"><div><h3>Providers</h3><p>Somente providers online aparecem para seleção manual.</p></div></div>
          <div class="row-wrap">${providers.map(providerBadge).join("") || `<span class="badge warning">Nenhum provider carregado</span>`}</div>
        </section>
        <section class="card result-stage">
          <div class="card-head"><h3>Resultado</h3><span id="resultStatus" class="badge">Aguardando geração</span></div>
          <div id="generationResult">${empty("Sua próxima geração aparecerá aqui.")}</div>
        </section>
      </div>`;

    el("generateForm").addEventListener("submit", handleGenerate);
    if (sessionStorage.getItem("yasmin_prefill_prompt")) {
      el("generatePrompt").value = sessionStorage.getItem("yasmin_prefill_prompt");
      sessionStorage.removeItem("yasmin_prefill_prompt");
    }
  }

  function providerBadge(p) {
    const badge = p.status === "ONLINE" ? "success" : "warning";
    return `<span class="badge ${badge}">${escapeHtml(p.name)} · ${escapeHtml(p.status)}</span>`;
  }

  async function handleGenerate(event) {
    event.preventDefault();
    const button = el("generateBtn");
    setBusy(button, true, "Gerando…");
    el("resultStatus").className = "badge warning";
    el("resultStatus").textContent = "PROCESSING";
    el("generationResult").innerHTML = `<div class="skeleton" style="min-height:420px"></div>`;
    const body = {
      user_request: el("generatePrompt").value.trim(),
      format: el("generateFormat").value,
      quantity: Number(el("quantity").value),
      identity_lock: el("identityLock").value,
      clothing_description: el("clothingDescription").value.trim() || undefined,
      scene_description: el("sceneDescription").value.trim() || undefined,
      provider_slug: el("providerSelect").value || undefined,
    };
    try {
      const data = await api(`/models/${MODEL}/generate`, { method: "POST", body: JSON.stringify(body) });
      state.generationAssets = data.assets || [];
      el("resultStatus").className = "badge success";
      el("resultStatus").textContent = "COMPLETED";
      await renderGeneratedAssets(data.assets || [], data.job);
      toast("Geração concluída.");
    } catch (err) {
      el("resultStatus").className = "badge danger";
      el("resultStatus").textContent = "FAILED";
      el("generationResult").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      toast(err.message, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function renderGeneratedAssets(assets, job) {
    if (!assets.length) {
      el("generationResult").innerHTML = empty("O job terminou sem retornar assets.");
      return;
    }
    const cards = await Promise.all(assets.map(async (asset) => {
      let src = "";
      try { src = await assetUrl(asset.storage_key); } catch {}
      return `
        <article class="asset-card" data-asset-id="${escapeHtml(asset.id)}">
          <div class="asset-media">${src ? `<img src="${src}" alt="Imagem gerada" />` : `<div class="image-placeholder">Imagem indisponível</div>`}</div>
          <div class="asset-actions">
            <button class="btn btn-success" data-asset-action="approve">Aprovar</button>
            <button class="btn" data-asset-action="favorite">♡ Favoritar</button>
            <button class="btn" data-asset-action="caption">Legenda</button>
            <button class="btn" data-asset-action="library">+ Library</button>
            <button class="btn btn-danger" data-asset-action="reject">Rejeitar</button>
          </div>
        </article>`;
    }));
    el("generationResult").innerHTML = `<div class="result-grid">${cards.join("")}</div>${job ? `<div class="section-title"><div><h3>Job</h3><p class="mono">${escapeHtml(job.id || "")}</p></div></div>` : ""}`;
    el("generationResult").querySelectorAll("[data-asset-action]").forEach((button) => button.addEventListener("click", () => handleAssetAction(button)));
  }

  async function handleAssetAction(button) {
    const card = button.closest("[data-asset-id]");
    const id = card?.dataset.assetId;
    const action = button.dataset.assetAction;
    if (!id) return;
    try {
      if (action === "approve") {
        await api(`/models/assets/${id}/approve`, { method: "POST" });
        toast("Imagem aprovada.");
      } else if (action === "favorite") {
        await api(`/models/assets/${id}/favorite`, { method: "POST", body: JSON.stringify({ favorite: true }) });
        button.textContent = "♥ Favorita";
        toast("Adicionada aos favoritos.");
      } else if (action === "reject") {
        openRejectDialog(id);
      } else if (action === "caption") {
        await captionForAsset(id);
      } else if (action === "library") {
        await api("/library", { method: "POST", body: JSON.stringify({ model_slug: MODEL, asset_id: id, content_type: "post" }) });
        toast("Adicionado à Library como rascunho.");
      }
    } catch (err) { toast(err.message, "error"); }
  }

  function openRejectDialog(id) {
    openDialog("Rejeitar geração", `
      <form id="rejectForm" class="stack gap-md">
        <label class="field"><span>Motivo</span><select id="rejectReason"><option>face</option><option>body</option><option>hands</option><option>hair</option><option>clothing</option><option>pose</option><option>scene</option><option>identity</option><option>lighting</option><option>quality</option></select></label>
        <button class="btn btn-danger" type="submit">Confirmar rejeição</button>
      </form>`);
    el("rejectForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api(`/models/assets/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: el("rejectReason").value }) });
        dialog.close();
        toast("Imagem rejeitada e feedback salvo.");
      } catch (err) { toast(err.message, "error"); }
    });
  }

  async function captionForAsset(id) {
    const context = el("generatePrompt")?.value?.trim() || "Imagem aprovada da Yasmin para conteúdo social";
    const result = await api(`/models/${MODEL}/caption`, { method: "POST", body: JSON.stringify({ context, platform: "instagram", tone: "confiante e natural", language: "pt-BR" }) });
    openDialog("Legenda sugerida", `<div class="stack gap-md"><p>${escapeHtml(result.caption || "")}</p><div class="row-wrap">${(result.hashtags || []).map((tag) => `<span class="badge purple">${escapeHtml(tag)}</span>`).join("")}</div><button id="copyCaption" class="btn btn-primary">Copiar legenda</button></div>`);
    el("copyCaption")?.addEventListener("click", () => navigator.clipboard?.writeText(`${result.caption || ""}\n\n${(result.hashtags || []).join(" ")}`).then(() => toast("Legenda copiada.")));
  }

  async function renderReferences() {
    const refs = await api(`/models/${MODEL}/references`);
    state.references = refs;
    root.innerHTML = `
      <div class="grid grid-3">
        <section class="card">
          <div class="card-head"><h3>Adicionar referência</h3><span class="badge purple">Reference Vault</span></div>
          <form id="referenceForm" class="stack gap-md">
            <label class="field"><span>Imagem</span><input id="referenceFile" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
            <label class="field"><span>Tipo</span><select id="referenceType"><option>FACE</option><option>BODY</option><option>HAIR</option><option>MASTER</option><option>STYLE</option><option>TEMPORARY</option></select></label>
            <div class="grid grid-2"><label class="field"><span>Prioridade</span><input id="referencePriority" type="number" value="5" min="0" max="100" /></label><label class="field"><span>Peso</span><input id="referenceWeight" type="number" value="1" min="0" max="5" step="0.1" /></label></div>
            <label class="field"><span>Descrição</span><input id="referenceDescription" placeholder="Ex.: rosto principal, luz neutra" /></label>
            <button id="referenceBtn" class="btn btn-primary" type="submit">Enviar referência</button>
          </form>
        </section>
        <section class="card" style="grid-column: span 2">
          <div class="card-head"><h3>Resumo do Vault</h3><span class="badge">${refs.length} referências</span></div>
          <div class="grid grid-3">
            ${statCard("FACE", refs.filter((r) => r.reference_type === "FACE").length, "referências")}
            ${statCard("BODY", refs.filter((r) => r.reference_type === "BODY").length, "referências")}
            ${statCard("MASTER", refs.filter((r) => r.reference_type === "MASTER" || r.is_master_face || r.is_master_body || r.is_master_full).length, "prioritárias")}
          </div>
        </section>
      </div>
      <div class="section-title"><div><h3>Referências ativas</h3><p>As imagens são carregadas do R2 com autenticação.</p></div></div>
      <div id="referenceGrid" class="ref-grid">${refs.length ? refs.map(refSkeleton).join("") : empty("Nenhuma referência cadastrada.")}</div>`;
    el("referenceForm").addEventListener("submit", uploadReference);
    await hydrateReferenceImages(refs);
  }

  function refSkeleton(ref) {
    return `<article class="ref-card" data-ref-id="${escapeHtml(ref.id)}"><div class="asset-media"><div class="skeleton" style="width:100%;height:100%"></div></div><div class="ref-info"><div class="between"><strong>${escapeHtml(ref.reference_type)}</strong><span class="badge">P${Number(ref.priority || 0)}</span></div><span class="muted small truncate">${escapeHtml(ref.description || ref.storage_key || "")}</span><div class="ref-actions"><button class="btn" data-ref-master="${escapeHtml(ref.reference_type)}">Definir master</button><button class="btn btn-danger" data-ref-delete>Excluir</button></div></div></article>`;
  }

  async function hydrateReferenceImages(refs) {
    await Promise.all(refs.map(async (ref) => {
      const card = root.querySelector(`[data-ref-id="${CSS.escape(ref.id)}"]`);
      if (!card) return;
      let url = "";
      try { url = await assetUrl(ref.storage_key); } catch {}
      const media = card.querySelector(".asset-media");
      media.innerHTML = url ? `<img src="${url}" alt="Referência ${escapeHtml(ref.reference_type)}" />` : `<div class="image-placeholder">Imagem indisponível</div>`;
      card.querySelector("[data-ref-delete]")?.addEventListener("click", async () => {
        if (!confirm("Excluir esta referência permanentemente?")) return;
        try { await api(`/models/references/${ref.id}`, { method: "DELETE" }); toast("Referência excluída."); await renderReferences(); } catch (err) { toast(err.message, "error"); }
      });
      card.querySelector("[data-ref-master]")?.addEventListener("click", async () => {
        const body = ref.reference_type === "FACE" ? { is_master_face: 1 } : ref.reference_type === "BODY" ? { is_master_body: 1 } : { is_master_full: 1 };
        try { await api(`/models/references/${ref.id}`, { method: "PATCH", body: JSON.stringify(body) }); toast("Referência marcada como master."); await renderReferences(); } catch (err) { toast(err.message, "error"); }
      });
    }));
  }

  async function uploadReference(event) {
    event.preventDefault();
    const button = el("referenceBtn");
    const file = el("referenceFile").files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("reference_type", el("referenceType").value);
    form.set("priority", el("referencePriority").value);
    form.set("weight", el("referenceWeight").value);
    form.set("description", el("referenceDescription").value);
    setBusy(button, true, "Enviando…");
    try { await api(`/models/${MODEL}/references`, { method: "POST", body: form }); toast("Referência enviada."); await renderReferences(); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); }
  }

  async function renderLibrary() {
    const items = await api(`/library?model=${MODEL}`);
    root.innerHTML = `
      <div class="hero"><div><p class="eyebrow">CONTENT LIBRARY</p><h3>Conteúdo organizado para produção.</h3><p>Rascunhos, conteúdos prontos e materiais publicados.</p></div><button class="btn btn-primary" data-go="create">+ Novo conteúdo</button></div>
      <section class="card">
        <div class="card-head"><h3>Library</h3><span class="badge">${items.length} itens</span></div>
        ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Status</th><th>Legenda</th><th>Hashtags</th><th>Criado</th><th>Ações</th></tr></thead><tbody>${items.map(libraryRow).join("")}</tbody></table></div>` : empty("Sua biblioteca ainda está vazia. Aprove uma geração e adicione-a à Library.")}
      </section>`;
    bindGoButtons();
    root.querySelectorAll("[data-library-status]").forEach((select) => select.addEventListener("change", async () => {
      try { await api(`/library/${select.dataset.libraryStatus}`, { method: "PATCH", body: JSON.stringify({ status: select.value }) }); toast("Status atualizado."); } catch (err) { toast(err.message, "error"); }
    }));
  }

  function libraryRow(item) {
    const tags = safeJson(item.hashtags, []) || [];
    return `<tr><td>${escapeHtml(item.content_type)}</td><td><select data-library-status="${escapeHtml(item.id)}"><option ${item.status === "DRAFT" ? "selected" : ""}>DRAFT</option><option ${item.status === "READY" ? "selected" : ""}>READY</option><option ${item.status === "APPROVED" ? "selected" : ""}>APPROVED</option><option ${item.status === "PUBLISHED" ? "selected" : ""}>PUBLISHED</option><option ${item.status === "ARCHIVED" ? "selected" : ""}>ARCHIVED</option></select></td><td>${escapeHtml((item.caption || "—").slice(0,110))}</td><td>${escapeHtml(tags.slice(0,3).join(" ") || "—")}</td><td>${dateTime(item.created_at)}</td><td><span class="mono">${escapeHtml(String(item.id).slice(0,8))}</span></td></tr>`;
  }

  async function renderTrends() {
    const [trends, opportunities] = await Promise.all([api("/trends"), api(`/models/${MODEL}/opportunities`).catch(() => [])]);
    root.innerHTML = `
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>Registrar tendência</h3><span class="badge purple">Manual</span></div>
          <form id="trendForm" class="stack gap-md">
            <div class="grid grid-2"><label class="field"><span>Plataforma</span><select id="trendPlatform"><option>instagram</option><option>tiktok</option><option>threads</option><option>x</option><option>youtube</option></select></label><label class="field"><span>Trend Score</span><input id="trendScore" type="number" min="0" max="100" value="80" /></label></div>
            <label class="field"><span>Título / padrão observado</span><input id="trendTitle" required placeholder="Ex.: luz de janela + enquadramento 4:5" /></label>
            <label class="field"><span>Categoria</span><input id="trendCategory" placeholder="lifestyle, fashion, editorial…" /></label>
            <label class="field"><span>Fonte</span><input id="trendSource" placeholder="Instagram / observação manual" /></label>
            <button id="trendBtn" class="btn btn-primary" type="submit">Salvar tendência</button>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>Oportunidades para Yasmin</h3><span class="badge">${opportunities.length}</span></div>
          <div class="list">${opportunities.length ? opportunities.map(opportunityRow).join("") : empty("Nenhuma oportunidade criada ainda.")}</div>
        </section>
      </div>
      <div class="section-title"><div><h3>Tendências registradas</h3><p>Transforme padrões visuais em conceitos originais.</p></div></div>
      <section class="card"><div class="list">${trends.length ? trends.map(trendRow).join("") : empty("Nenhuma tendência cadastrada.")}</div></section>`;
    el("trendForm").addEventListener("submit", async (event) => {
      event.preventDefault(); const button = el("trendBtn"); setBusy(button, true, "Salvando…");
      try { await api("/trends", { method: "POST", body: JSON.stringify({ platform: el("trendPlatform").value, title: el("trendTitle").value, category: el("trendCategory").value || undefined, score: Number(el("trendScore").value), source: el("trendSource").value || undefined }) }); toast("Tendência registrada."); await renderTrends(); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); }
    });
    root.querySelectorAll("[data-opportunity]").forEach((button) => button.addEventListener("click", () => createOpportunity(button.dataset.opportunity, button.dataset.title)));
  }

  function trendRow(t) {
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(t.title)}</div><div class="list-row-meta">${escapeHtml(t.platform)} · ${escapeHtml(t.category || "sem categoria")} · ${dateTime(t.detected_at)}</div></div><div class="row-wrap"><span class="badge ${Number(t.score) >= 85 ? "success" : "purple"}">${Number(t.score)} / 100</span><button class="btn" data-opportunity="${escapeHtml(t.id)}" data-title="${escapeHtml(t.title)}">Criar oportunidade</button></div></div>`;
  }

  function opportunityRow(o) {
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(o.suggested_concept || o.trend_title || "Oportunidade")}</div><div class="list-row-meta">${escapeHtml(o.platform || "")} · ${escapeHtml(o.trend_title || "")}</div></div><span class="badge success">${Number(o.compatibility_score || 0)}%</span></div>`;
  }

  function createOpportunity(trendId, title) {
    openDialog("Criar oportunidade", `<form id="opportunityForm" class="stack gap-md"><p class="muted small">${escapeHtml(title || "Tendência selecionada")}</p><label class="field"><span>Compatibilidade com Yasmin</span><input id="opportunityScore" type="number" min="0" max="100" value="85" /></label><label class="field"><span>Conceito original</span><textarea id="opportunityConcept" required placeholder="Descreva como transformar a tendência em um conteúdo novo da Yasmin."></textarea></label><button class="btn btn-primary" type="submit">Criar oportunidade</button></form>`);
    el("opportunityForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await api(`/models/${MODEL}/opportunities`, { method: "POST", body: JSON.stringify({ trend_id: trendId, compatibility_score: Number(el("opportunityScore").value), suggested_concept: el("opportunityConcept").value }) }); dialog.close(); toast("Oportunidade criada."); await renderTrends(); } catch (err) { toast(err.message, "error"); } });
  }

  async function renderPlanner() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const [plans, content] = await Promise.all([api(`/planner?from=${encodeURIComponent(first)}&to=${encodeURIComponent(last)}`), api(`/library?model=${MODEL}`)]);
    const contentOptions = content.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.content_type)} · ${escapeHtml((item.caption || item.id).slice(0,55))}</option>`).join("");
    root.innerHTML = `
      <div class="grid grid-3">
        <section class="card">
          <div class="card-head"><h3>Agendar conteúdo</h3><span class="badge purple">Planner</span></div>
          <form id="plannerForm" class="stack gap-md">
            <label class="field"><span>Conteúdo</span><select id="plannerContent" required><option value="">Selecione…</option>${contentOptions}</select></label>
            <label class="field"><span>Plataforma</span><select id="plannerPlatform"><option>instagram</option><option>tiktok</option><option>threads</option><option>x</option><option>youtube</option></select></label>
            <label class="field"><span>Data e hora</span><input id="plannerDate" type="datetime-local" required /></label>
            <button id="plannerBtn" class="btn btn-primary" type="submit">Adicionar ao Planner</button>
          </form>
        </section>
        <section class="card" style="grid-column:span 2"><div class="card-head"><h3>Este mês</h3><span class="badge">${plans.length} itens</span></div><div class="list">${plans.length ? plans.map(planRow).join("") : empty("Nenhum conteúdo agendado neste mês.")}</div></section>
      </div>`;
    el("plannerForm").addEventListener("submit", async (event) => { event.preventDefault(); const button = el("plannerBtn"); setBusy(button, true, "Agendando…"); try { await api("/planner", { method: "POST", body: JSON.stringify({ content_id: el("plannerContent").value, platform: el("plannerPlatform").value, scheduled_at: new Date(el("plannerDate").value).toISOString() }) }); toast("Conteúdo adicionado ao Planner."); await renderPlanner(); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); } });
  }

  function planRow(p) {
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(p.content_type)} · ${escapeHtml(p.platform)}</div><div class="list-row-meta">${escapeHtml((p.caption || "Sem legenda").slice(0,100))}</div></div><div class="stack gap-xs"><span class="badge purple">${escapeHtml(p.status)}</span><span class="small muted">${dateTime(p.scheduled_at)}</span></div></div>`;
  }

  async function renderAutomations() {
    const rules = await api("/automations");
    root.innerHTML = `
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>Nova automação</h3><span class="badge purple">Draft-first</span></div>
          <form id="automationForm" class="stack gap-md">
            <label class="field"><span>Nome</span><input id="automationName" required placeholder="Ex.: Sugerir conteúdo em trend alta" /></label>
            <div class="grid grid-2"><label class="field"><span>Gatilho</span><select id="automationTrigger"><option value="trend_score_above">Trend score acima</option><option value="asset_approved">Asset aprovado</option></select></label><label class="field"><span>Ação</span><select id="automationAction"><option value="suggest_content">Sugerir conteúdo</option><option value="generate_caption">Gerar legenda</option></select></label></div>
            <label class="field"><span>Threshold (se aplicável)</span><input id="automationThreshold" type="number" value="85" min="0" max="100" /></label>
            <button id="automationBtn" class="btn btn-primary" type="submit">Criar automação</button>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>Execução</h3><button id="runAutomations" class="btn">⚡ Executar agora</button></div>
          <p class="muted small">O Worker também executa as regras pelo Cron configurado no Wrangler.</p>
          <div class="stat-card" style="margin-top:12px"><span class="stat-label">Regras cadastradas</span><strong class="stat-value">${rules.length}</strong><span class="stat-note">${rules.filter((r) => r.active).length} ativas</span></div>
        </section>
      </div>
      <div class="section-title"><div><h3>Regras</h3><p>Ative, desative ou remova automações.</p></div></div>
      <section class="card"><div class="list">${rules.length ? rules.map(automationRow).join("") : empty("Nenhuma automação cadastrada.")}</div></section>`;
    el("automationForm").addEventListener("submit", async (event) => { event.preventDefault(); const button = el("automationBtn"); setBusy(button, true, "Criando…"); const trigger = el("automationTrigger").value; try { await api("/automations", { method: "POST", body: JSON.stringify({ model_slug: MODEL, name: el("automationName").value, trigger_type: trigger, trigger_config: trigger === "trend_score_above" ? { threshold: Number(el("automationThreshold").value) } : {}, action_type: el("automationAction").value, action_config: {} }) }); toast("Automação criada."); await renderAutomations(); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); } });
    el("runAutomations").addEventListener("click", async (event) => { setBusy(event.currentTarget, true, "Executando…"); try { const result = await api("/automations/run", { method: "POST" }); openDialog("Execução concluída", `<pre class="mono">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`); } catch (err) { toast(err.message, "error"); } finally { setBusy(event.currentTarget, false); } });
    root.querySelectorAll("[data-auto-toggle]").forEach((button) => button.addEventListener("click", async () => { try { await api(`/automations/${button.dataset.autoToggle}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.active !== "1" }) }); await renderAutomations(); } catch (err) { toast(err.message, "error"); } }));
    root.querySelectorAll("[data-auto-delete]").forEach((button) => button.addEventListener("click", async () => { if (!confirm("Excluir esta automação?")) return; try { await api(`/automations/${button.dataset.autoDelete}`, { method: "DELETE" }); toast("Automação excluída."); await renderAutomations(); } catch (err) { toast(err.message, "error"); } }));
  }

  function automationRow(rule) {
    const trigger = safeJson(rule.trigger_config, {}) || {};
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(rule.name)}</div><div class="list-row-meta">${escapeHtml(rule.trigger_type)}${trigger.threshold ? ` (${Number(trigger.threshold)})` : ""} → ${escapeHtml(rule.action_type)}</div></div><div class="row-wrap"><span class="badge ${rule.active ? "success" : "warning"}">${rule.active ? "ACTIVE" : "PAUSED"}</span><button class="btn" data-auto-toggle="${escapeHtml(rule.id)}" data-active="${rule.active ? "1" : "0"}">${rule.active ? "Pausar" : "Ativar"}</button><button class="btn btn-danger" data-auto-delete="${escapeHtml(rule.id)}">Excluir</button></div></div>`;
  }

  async function renderSettings() {
    const [identity, providers, settings, health] = await Promise.all([
      api(`/models/${MODEL}/identity`), api("/providers"), api("/settings"), api("/health")
    ]);
    state.providers = providers;
    root.innerHTML = `
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>Yasmin Identity</h3><span class="badge success">21+ ADULT</span></div>
          <form id="identityForm" class="stack gap-md">
            <div class="grid grid-2"><label class="field"><span>Faixa etária</span><input id="idAge" value="${escapeHtml(identity?.age_range || "adult 21+")}" /></label><label class="field"><span>Identity Lock padrão</span><select id="idLock"><option ${identity?.default_identity_lock === "NORMAL" ? "selected" : ""}>NORMAL</option><option ${identity?.default_identity_lock === "STRONG" ? "selected" : ""}>STRONG</option><option ${identity?.default_identity_lock === "MAXIMUM" ? "selected" : ""}>MAXIMUM</option><option ${identity?.default_identity_lock === "OFF" ? "selected" : ""}>OFF</option></select></label></div>
            <label class="field"><span>Descrição étnica/aparência</span><input id="idEthnicity" value="${escapeHtml(identity?.ethnicity_description || "")}" /></label>
            <label class="field"><span>Tom de pele</span><input id="idSkin" value="${escapeHtml(identity?.skin_tone || "")}" /></label>
            <label class="field"><span>Tipo corporal</span><input id="idBody" value="${escapeHtml(identity?.body_type || "")}" /></label>
            <label class="field"><span>Rosto</span><textarea id="idFace">${escapeHtml(identity?.face_description || "")}</textarea></label>
            <label class="field"><span>Cabelo</span><input id="idHair" value="${escapeHtml(identity?.hair_description || "")}" /></label>
            <label class="field"><span>Características distintivas</span><input id="idFeatures" value="${escapeHtml(identity?.distinguishing_features || "")}" /></label>
            <button id="identityBtn" class="btn btn-primary" type="submit">Salvar identidade</button>
          </form>
        </section>
        <section class="stack gap-md">
          <div class="card"><div class="card-head"><h3>System Health</h3><span class="badge">Live</span></div><div class="health-grid">${healthHtml(health)}</div></div>
          <div class="card"><div class="card-head"><h3>Configurações</h3><span class="badge">${settings.length}</span></div><div class="list">${settings.length ? settings.map(settingRow).join("") : empty("Nenhuma configuração dinâmica no D1.")}</div></div>
        </section>
      </div>
      <div class="section-title"><div><h3>AI Providers</h3><p>Teste conexão e escolha quais ficam ativos.</p></div></div>
      <div class="provider-grid">${providers.map(providerCard).join("")}</div>`;
    el("identityForm").addEventListener("submit", saveIdentity);
    root.querySelectorAll("[data-provider-test]").forEach((button) => button.addEventListener("click", () => testProvider(button)));
    root.querySelectorAll("[data-provider-toggle]").forEach((button) => button.addEventListener("click", () => toggleProvider(button)));
  }

  function settingRow(item) {
    return `<div class="list-row"><div><div class="list-row-title">${escapeHtml(item.key)}</div><div class="list-row-meta mono">${escapeHtml(item.value)}</div></div><span class="badge">D1</span></div>`;
  }

  function providerCard(p) {
    const statusClass = p.status === "ONLINE" ? "success" : "warning";
    return `<article class="provider-card"><div class="between"><div><h4>${escapeHtml(p.name)}</h4><span class="badge ${statusClass}">${escapeHtml(p.status)}</span></div><span class="badge">P${Number(p.priority || 5)}</span></div><div class="models">${escapeHtml((p.models || []).join(", ") || "Nenhum modelo listado")}</div><div class="row-wrap"><button class="btn" data-provider-test="${escapeHtml(p.slug)}">Testar</button><button class="btn ${p.active ? "btn-success" : ""}" data-provider-toggle="${escapeHtml(p.slug)}" data-active="${p.active ? "1" : "0"}">${p.active ? "Ativo" : "Ativar"}</button></div></article>`;
  }

  async function saveIdentity(event) {
    event.preventDefault(); const button = el("identityBtn"); setBusy(button, true, "Salvando…");
    try { await api(`/models/${MODEL}/identity`, { method: "PUT", body: JSON.stringify({ age_range: el("idAge").value, ethnicity_description: el("idEthnicity").value, skin_tone: el("idSkin").value, body_type: el("idBody").value, face_description: el("idFace").value, hair_description: el("idHair").value, distinguishing_features: el("idFeatures").value, default_identity_lock: el("idLock").value }) }); toast("Identidade atualizada."); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); }
  }

  async function testProvider(button) {
    setBusy(button, true, "Testando…");
    try { const result = await api(`/providers/${button.dataset.providerTest}/test`, { method: "POST" }); toast(result.success ? "Provider online." : (result.error || "Teste falhou"), result.success ? "success" : "error"); await renderSettings(); } catch (err) { toast(err.message, "error"); } finally { setBusy(button, false); }
  }

  async function toggleProvider(button) {
    const active = button.dataset.active !== "1";
    try { await api(`/providers/${button.dataset.providerToggle}`, { method: "PATCH", body: JSON.stringify({ active }) }); toast(active ? "Provider ativado." : "Provider desativado."); await renderSettings(); } catch (err) { toast(err.message, "error"); }
  }

  async function renderAgent() {
    root.innerHTML = `
      <section class="agent-shell">
        <div class="card-head"><div><h3>AI Command Center</h3><p class="muted small">Atalhos inteligentes conectados às ferramentas já existentes.</p></div><span class="badge purple">Yasmin</span></div>
        <div id="agentLog" class="agent-log">${state.agentMessages.map((m) => `<div class="message ${m.role}">${escapeHtml(m.text)}</div>`).join("")}</div>
        <form id="agentForm" class="agent-input"><textarea id="agentPrompt" placeholder="Ex.: Gere uma foto da Yasmin em uma cafeteria…"></textarea><button class="btn btn-primary" type="submit">Enviar</button></form>
        <div class="row-wrap" style="margin-top:10px"><button class="btn" data-agent-example="Gere uma foto da Yasmin em uma cafeteria elegante.">Exemplo: gerar imagem</button><button class="btn" data-agent-example="Crie uma legenda para uma foto lifestyle da Yasmin.">Exemplo: legenda</button></div>
      </section>`;
    const log = el("agentLog"); log.scrollTop = log.scrollHeight;
    root.querySelectorAll("[data-agent-example]").forEach((b) => b.addEventListener("click", () => { el("agentPrompt").value = b.dataset.agentExample; el("agentPrompt").focus(); }));
    el("agentForm").addEventListener("submit", handleAgentCommand);
  }

  async function handleAgentCommand(event) {
    event.preventDefault();
    const input = el("agentPrompt");
    const text = input.value.trim();
    if (!text) return;
    state.agentMessages.push({ role: "user", text });
    input.value = "";
    const lower = text.toLowerCase();
    if (lower.includes("legenda") || lower.includes("caption")) {
      try {
        const result = await api(`/models/${MODEL}/caption`, { method: "POST", body: JSON.stringify({ context: text, platform: "instagram", tone: "natural e confiante", language: "pt-BR" }) });
        state.agentMessages.push({ role: "agent", text: `${result.caption}\n\n${(result.hashtags || []).join(" ")}` });
      } catch (err) { state.agentMessages.push({ role: "agent", text: `Não consegui gerar a legenda: ${err.message}` }); }
      await renderAgent();
      return;
    }
    if (lower.includes("gere") || lower.includes("gerar") || lower.includes("foto") || lower.includes("imagem")) {
      sessionStorage.setItem("yasmin_prefill_prompt", text);
      state.agentMessages.push({ role: "agent", text: "Preparei seu pedido no Generation Studio. Abrindo Create…" });
      navigate("create");
      return;
    }
    if (lower.includes("tend")) {
      state.agentMessages.push({ role: "agent", text: "Abrindo Trends para registrar ou transformar uma tendência em oportunidade." });
      navigate("trends");
      return;
    }
    state.agentMessages.push({ role: "agent", text: "Posso encaminhar este pedido para geração, legenda, tendências, referências, planner ou automações. Para geração, descreva a imagem que deseja; para legenda, mencione ‘legenda’." });
    await renderAgent();
  }

  const views = {
    dashboard: renderDashboard,
    create: renderCreate,
    library: renderLibrary,
    references: renderReferences,
    trends: renderTrends,
    planner: renderPlanner,
    automations: renderAutomations,
    agent: renderAgent,
    settings: renderSettings,
  };

  function empty(message) { return `<div class="empty">${escapeHtml(message)}</div>`; }

  async function boot() {
    el("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector("button[type=submit]");
      const password = el("loginPassword").value;
      el("loginMessage").textContent = "";
      setBusy(button, true, "Entrando…");
      try {
        const data = await api("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
        state.token = data.token;
        sessionStorage.setItem("yasmin_token", state.token);
        el("loginPassword").value = "";
        showApp();
        await Promise.all([loadHealth(), renderCurrent()]);
      } catch (err) {
        el("loginMessage").textContent = err.message;
      } finally { setBusy(button, false); }
    });

    el("logoutBtn").addEventListener("click", () => { clearSession(); showLogin("Sessão encerrada."); });
    el("refreshBtn").addEventListener("click", async () => { await loadHealth(); await renderCurrent(); toast("Painel atualizado."); });
    el("menuBtn").addEventListener("click", () => { el("sidebar").classList.add("open"); el("sidebarBackdrop").classList.add("show"); });
    el("sidebarBackdrop").addEventListener("click", closeMobileMenu);
    el("nav").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) navigate(button.dataset.view); });
    el("dialogClose").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    window.addEventListener("hashchange", () => { if (state.token) renderCurrent(); });

    if (await validateSession()) {
      showApp();
      await Promise.all([loadHealth(), renderCurrent()]);
    } else {
      clearSession();
      showLogin();
    }
  }

  boot();
})();
