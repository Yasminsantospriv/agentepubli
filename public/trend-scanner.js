(() => {
  "use strict";

  const MODEL = "yasmin";
  const getToken = () => sessionStorage.getItem("yasmin_token") || "";
  const nativeFetch = window.fetch.bind(window);
  let rendering = false;

  // Injeta a inspiração selecionada no body da geração sem alterar o app principal.
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    let nextInit = init;
    let attachedInspiration = false;
    const inspirationId = sessionStorage.getItem("yasmin_inspiration_id");
    if (inspirationId && /\/models\/yasmin\/generate(?:\?|$)/.test(url) && String(init.method || "GET").toUpperCase() === "POST" && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        body.inspiration_id = inspirationId;
        nextInit = { ...init, body: JSON.stringify(body) };
        attachedInspiration = true;
      } catch {}
    }
    const response = await nativeFetch(input, nextInit);
    if (attachedInspiration && response.ok) {
      sessionStorage.removeItem("yasmin_inspiration_id");
      sessionStorage.removeItem("yasmin_inspiration_title");
    }
    return response;
  };

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (getToken()) headers.set("Authorization", `Bearer ${getToken()}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) throw new Error(payload?.error?.message || `Erro HTTP ${response.status}`);
    return payload?.data ?? payload;
  }

  function esc(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmt(n) {
    const value = Number(n || 0);
    return new Intl.NumberFormat("pt-BR", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
  }

  function when(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function toast(message, type = "success") {
    const root = document.getElementById("toastRoot");
    if (!root) return;
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  async function renderInstagramTrends() {
    if (location.hash !== "#trends" || rendering) return;
    const root = document.getElementById("viewRoot");
    if (!root || root.dataset.instagramTrends === "1") return;
    if (root.querySelector(".skeleton")) return;
    rendering = true;

    try {
      const [status, inspirations] = await Promise.all([
        request("/instagram/status").catch(() => null),
        request("/instagram/inspirations?limit=48").catch(() => []),
      ]);
      if (location.hash !== "#trends") return;

      root.dataset.instagramTrends = "1";
      const hashtags = status?.hashtags || [];
      root.innerHTML = `
        <div class="hero">
          <div>
            <p class="eyebrow">INSPIRAÇÕES DO INSTAGRAM</p>
            <h3>Postagens com sinais de alto engajamento</h3>
            <p>O scanner acompanha hashtags do nicho, ranqueia os posts e deixa a referência pronta para gerar uma versão original da Yasmin.</p>
          </div>
          <button id="instagramScanNow" class="btn btn-primary" ${status?.configured ? "" : "disabled"}>↻ Buscar agora</button>
        </div>

        ${status?.configured ? `
          <div class="cards">
            <div class="stat-card"><span class="stat-label">Status</span><strong class="stat-value" style="font-size:18px">CONECTADO</strong><span class="stat-note">Meta Instagram API</span></div>
            <div class="stat-card"><span class="stat-label">Última busca</span><strong class="stat-value" style="font-size:16px">${esc(when(status.last_run))}</strong><span class="stat-note">a cada ${Number(status.interval_minutes || 120)} min</span></div>
            <div class="stat-card"><span class="stat-label">Inspirações</span><strong class="stat-value">${inspirations.length}</strong><span class="stat-note">ordenadas por score</span></div>
          </div>
          <section class="card" style="margin-bottom:16px">
            <div class="card-head"><div><h3>Fontes automáticas</h3><p class="muted small">Não precisa cadastrar tendências manualmente. Ajuste só se quiser mudar o nicho.</p></div><span class="badge success">AUTOMÁTICO</span></div>
            <div class="grid grid-2" style="margin-top:12px">
              <label class="field"><span>Hashtags monitoradas</span><input id="instagramHashtags" value="${esc(hashtags.join(", "))}" /></label>
              <label class="field"><span>Frequência</span><select id="instagramInterval"><option value="60" ${Number(status.interval_minutes)===60?"selected":""}>1 hora</option><option value="120" ${Number(status.interval_minutes)===120?"selected":""}>2 horas</option><option value="180" ${Number(status.interval_minutes)===180?"selected":""}>3 horas</option><option value="360" ${Number(status.interval_minutes)===360?"selected":""}>6 horas</option></select></label>
            </div>
            <div class="row-wrap" style="margin-top:12px"><button id="instagramSaveConfig" class="btn">Salvar fontes</button><span id="instagramScanMessage" class="muted small">O cron continua funcionando com o painel fechado.</span></div>
          </section>
        ` : `
          <section class="card">
            <div class="card-head"><h3>Conectar Instagram</h3><span class="badge warning">FALTA CONFIGURAR</span></div>
            <p>O código já está pronto. Para ativar a busca automática, adicione no Worker os segredos <strong>META_ACCESS_TOKEN</strong> e <strong>META_IG_USER_ID</strong>.</p>
            <p class="muted small" style="margin-top:8px">Depois disso esta tela começa a buscar automaticamente; não precisa cadastrar tendências à mão.</p>
          </section>
        `}

        <div class="section-title"><div><h3>Referências encontradas</h3><p>Imagem, perfil, métricas e score. Use uma inspiração para levá-la direto ao gerador.</p></div></div>
        <div id="instagramInspirationGrid" class="ref-grid">
          ${inspirations.length ? inspirations.map(inspirationCard).join("") : `<div class="empty">${status?.configured ? "Ainda não há inspirações. A primeira varredura pode ser executada agora." : "Conecte a Meta API para começar."}</div>`}
        </div>`;

      document.getElementById("instagramScanNow")?.addEventListener("click", scanNow);
      document.getElementById("instagramSaveConfig")?.addEventListener("click", saveConfig);
      root.querySelectorAll("[data-use-inspiration]").forEach((button) => button.addEventListener("click", () => useInspiration(button)));
      await hydrateImages(inspirations);

      if (status?.configured && !status?.last_run) {
        setTimeout(() => document.getElementById("instagramScanNow")?.click(), 250);
      }
    } finally {
      rendering = false;
    }
  }

  function inspirationCard(item) {
    const score = Number(item.score || 0);
    const engagement = Number(item.engagement_rate || 0);
    return `<article class="ref-card" data-inspiration-card="${esc(item.id)}">
      <div class="asset-media"><div class="skeleton" style="width:100%;height:100%"></div></div>
      <div class="ref-info">
        <div class="between"><strong>${esc(item.username ? `@${item.username}` : "Instagram")}</strong><span class="badge ${score >= 80 ? "success" : "purple"}">${score}/100</span></div>
        <span class="muted small">#${esc(item.source_hashtag || "inspiração")} · ${esc(item.media_type || "POST")}</span>
        <span class="muted small">♥ ${fmt(item.like_count)} · 💬 ${fmt(item.comments_count)}${engagement > 0 ? ` · ${engagement.toFixed(2)}%` : ""}</span>
        <span class="muted small truncate">${esc((item.caption || "Sem legenda").slice(0, 150))}</span>
        <div class="row-wrap"><button class="btn btn-primary" data-use-inspiration="${esc(item.id)}" data-title="${esc(item.username ? `@${item.username}` : "Post do Instagram")}">Usar como inspiração</button>${item.permalink ? `<a class="btn" href="${esc(item.permalink)}" target="_blank" rel="noopener">Abrir post</a>` : ""}</div>
      </div>
    </article>`;
  }

  async function hydrateImages(items) {
    await Promise.all(items.map(async (item) => {
      const card = document.querySelector(`[data-inspiration-card="${CSS.escape(item.id)}"]`);
      if (!card) return;
      try {
        const response = await nativeFetch(`/instagram/inspirations/${encodeURIComponent(item.id)}/image`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!response.ok) throw new Error("imagem indisponível");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        card.querySelector(".asset-media").innerHTML = `<img src="${url}" alt="Referência de postagem do Instagram" />`;
      } catch {
        card.querySelector(".asset-media").innerHTML = `<div class="image-placeholder">Prévia indisponível</div>`;
      }
    }));
  }

  async function scanNow() {
    const button = document.getElementById("instagramScanNow");
    const message = document.getElementById("instagramScanMessage");
    if (button) { button.disabled = true; button.textContent = "Buscando…"; }
    if (message) message.textContent = "Consultando posts do Instagram…";
    try {
      const result = await request("/instagram/scan", { method: "POST", body: "{}" });
      if (message) message.textContent = `${Number(result.posts_seen || 0)} posts analisados · ${Number(result.posts_saved || 0)} atualizados.`;
      toast("Varredura do Instagram concluída.");
      setTimeout(() => { const root = document.getElementById("viewRoot"); if (root) delete root.dataset.instagramTrends; renderInstagramTrends(); }, 700);
    } catch (err) {
      if (message) message.textContent = err.message || "Falha na busca.";
      toast(err.message || "Falha na busca do Instagram.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "↻ Buscar agora"; }
    }
  }

  async function saveConfig() {
    const hashtags = String(document.getElementById("instagramHashtags")?.value || "").split(",").map((x) => x.trim()).filter(Boolean);
    const interval = Number(document.getElementById("instagramInterval")?.value || 120);
    try {
      await request("/instagram/config", { method: "PUT", body: JSON.stringify({ hashtags, interval_minutes: interval }) });
      toast("Fontes do scanner atualizadas.");
    } catch (err) { toast(err.message, "error"); }
  }

  async function useInspiration(button) {
    const id = button.dataset.useInspiration;
    if (!id) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparando…";
    try {
      const response = await nativeFetch(`/instagram/inspirations/${encodeURIComponent(id)}/image`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!response.ok) throw new Error("Não foi possível carregar a imagem de referência.");
      const originalBlob = await response.blob();
      const resized = await resizeForAi(originalBlob, 448);
      const form = new FormData();
      form.set("file", new File([resized], "inspiration-ai.jpg", { type: "image/jpeg" }));
      await request(`/instagram/inspirations/${encodeURIComponent(id)}/ai-ready`, { method: "POST", body: form });
      const selected = await request(`/instagram/inspirations/${encodeURIComponent(id)}/select`, { method: "POST", body: "{}" });
      sessionStorage.setItem("yasmin_inspiration_id", id);
      sessionStorage.setItem("yasmin_inspiration_title", button.dataset.title || "Instagram");
      sessionStorage.setItem("yasmin_prefill_prompt", selected.concept || "Criar uma postagem original da Yasmin inspirada na composição visual selecionada.");
      toast("Inspiração pronta para gerar.");
      location.hash = "#create";
    } catch (err) {
      toast(err.message || "Não foi possível preparar a inspiração.", "error");
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function resizeForAi(blob, maxSide) {
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      return await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Falha ao reduzir a imagem")), "image/jpeg", 0.9));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function decorateCreate() {
    if (location.hash !== "#create") return;
    const id = sessionStorage.getItem("yasmin_inspiration_id");
    const root = document.getElementById("viewRoot");
    if (!id || !root || root.querySelector("#instagramInspirationSelected") || !root.querySelector("#generateForm")) return;
    const card = document.createElement("div");
    card.id = "instagramInspirationSelected";
    card.className = "card";
    card.style.marginBottom = "16px";
    card.innerHTML = `<div class="between"><div><strong>Inspiração do Instagram selecionada</strong><div class="muted small">${esc(sessionStorage.getItem("yasmin_inspiration_title") || "Post de referência")} · será usada apenas para composição/estilo; a identidade vem da Yasmin.</div></div><button id="clearInstagramInspiration" class="btn">Remover</button></div>`;
    root.prepend(card);
    card.querySelector("#clearInstagramInspiration")?.addEventListener("click", () => {
      sessionStorage.removeItem("yasmin_inspiration_id");
      sessionStorage.removeItem("yasmin_inspiration_title");
      card.remove();
      toast("Inspiração removida.");
    });
  }

  let timer;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (location.hash === "#trends") renderInstagramTrends();
      if (location.hash === "#create") decorateCreate();
    }, 180);
  }

  window.addEventListener("hashchange", schedule);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
