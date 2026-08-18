(() => {
  "use strict";

  const getToken = () => sessionStorage.getItem("yasmin_token") || "";
  let firstAutoScanStarted = false;

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.error?.message || `Erro HTTP ${response.status}`);
    }
    return payload?.data ?? payload;
  }

  function formatDate(value) {
    if (!value) return "Ainda não executado";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  function summary(result) {
    if (!result) return "O scanner fará a primeira busca automaticamente.";
    if (result.message && result.skipped) return result.message;
    if (result.message && !result.skipped) return `Última tentativa: ${result.message}`;
    return `${Number(result.trends_saved || 0)} novas tendências · ${Number(result.opportunities_created || 0)} oportunidades criadas`;
  }

  async function runScan(button, message, reload = true) {
    const original = button?.textContent || "↻ Buscar tendências agora";
    if (button) {
      button.disabled = true;
      button.textContent = "Buscando…";
    }
    if (message) message.textContent = "Analisando tendências e criando oportunidades…";
    try {
      const result = await request("/trends/scan", { method: "POST", body: "{}" });
      if (message) message.textContent = `${Number(result.trends_saved || 0)} novas tendências e ${Number(result.opportunities_created || 0)} oportunidades criadas.`;
      if (reload) setTimeout(() => location.reload(), 900);
      return result;
    } catch (err) {
      if (message) message.textContent = err.message || "Não foi possível executar a busca agora.";
      return null;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  async function enhanceTrends() {
    if (location.hash !== "#trends") return;
    const root = document.getElementById("viewRoot");
    if (!root || root.querySelector("#trendScannerPanel")) return;
    if (root.querySelector(".skeleton")) return;

    const status = await request("/trends/scanner").catch(() => null);
    if (location.hash !== "#trends" || root.querySelector("#trendScannerPanel")) return;

    root.querySelectorAll("h3").forEach((title) => {
      if (title.textContent?.trim() === "Registrar tendência") title.textContent = "Adicionar tendência manual (opcional)";
    });

    const panel = document.createElement("section");
    panel.id = "trendScannerPanel";
    panel.className = "card";
    panel.style.marginBottom = "16px";
    panel.innerHTML = `
      <div class="card-head">
        <div>
          <h3>Scanner automático de tendências</h3>
          <p class="muted small" style="margin-top:4px">Busca tendências no Brasil, filtra com IA e cria oportunidades para a Yasmin automaticamente.</p>
        </div>
        <span class="badge success">AUTOMÁTICO</span>
      </div>
      <div class="grid grid-3" style="margin-top:12px">
        <div class="stat-card"><span class="stat-label">Fonte</span><strong class="stat-value" style="font-size:16px">${escapeHtml(status?.source || "Google Trends Brasil")}</strong><span class="stat-note">sinais públicos</span></div>
        <div class="stat-card"><span class="stat-label">Frequência</span><strong class="stat-value">${Number(status?.interval_minutes || 60)} min</strong><span class="stat-note">sem ação manual</span></div>
        <div class="stat-card"><span class="stat-label">Última busca</span><strong class="stat-value" style="font-size:16px">${escapeHtml(formatDate(status?.last_run))}</strong><span class="stat-note">${escapeHtml(summary(status?.last_result))}</span></div>
      </div>
      <div class="row-wrap" style="margin-top:12px">
        <button id="trendScanNow" class="btn btn-primary">↻ Buscar tendências agora</button>
        <span id="trendScanMessage" class="muted small">O cron continua funcionando mesmo com o painel fechado.</span>
      </div>`;

    root.prepend(panel);

    const button = document.getElementById("trendScanNow");
    const message = document.getElementById("trendScanMessage");
    button?.addEventListener("click", () => runScan(button, message, true));

    if (!status?.last_run && !firstAutoScanStarted) {
      firstAutoScanStarted = true;
      if (message) message.textContent = "Primeira busca automática iniciada…";
      await runScan(button, message, true);
    }
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(enhanceTrends, 160);
  }

  window.addEventListener("hashchange", schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
