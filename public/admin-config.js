(() => {
  "use strict";

  const getToken = () => sessionStorage.getItem("yasmin_token") || "";

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

  function showMessage(node, text, ok = true) {
    node.textContent = text;
    node.style.marginTop = "10px";
    node.style.fontSize = "13px";
    node.style.color = ok ? "#78e6b1" : "#ff8d9a";
  }

  async function loadSettingsMap() {
    const rows = await request("/settings").catch(() => []);
    const map = new Map();
    for (const row of rows || []) {
      try { map.set(row.key, JSON.parse(row.value)); }
      catch { map.set(row.key, row.value); }
    }
    return map;
  }

  async function saveSetting(key, value) {
    return request(`/settings/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  }

  async function enhanceSettings() {
    if (location.hash !== "#settings") return;
    const root = document.getElementById("viewRoot");
    if (!root || root.querySelector("#adminConfigPanel")) return;
    if (root.textContent.includes("Rota não encontrada")) return;

    const settings = await loadSettingsMap();
    if (location.hash !== "#settings" || root.querySelector("#adminConfigPanel")) return;

    const panel = document.createElement("div");
    panel.id = "adminConfigPanel";
    panel.innerHTML = `
      <div class="section-title"><div><h3>Administração do sistema</h3><p>Preferências gerais e segurança do painel.</p></div></div>
      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h3>Segurança</h3><span class="badge success">Protegido</span></div>
          <form id="changePasswordForm" class="stack gap-md">
            <label class="field"><span>Senha atual</span><input id="currentAdminPassword" type="password" autocomplete="current-password" required /></label>
            <label class="field"><span>Nova senha</span><input id="newAdminPassword" type="password" minlength="10" autocomplete="new-password" required placeholder="Mínimo de 10 caracteres" /></label>
            <label class="field"><span>Confirmar nova senha</span><input id="confirmAdminPassword" type="password" minlength="10" autocomplete="new-password" required /></label>
            <button class="btn btn-primary" type="submit">Alterar senha</button>
            <div id="passwordChangeMessage"></div>
          </form>
        </section>

        <section class="card">
          <div class="card-head"><h3>Preferências do estúdio</h3><span class="badge">Aplicação</span></div>
          <form id="studioSettingsForm" class="stack gap-md">
            <label class="field"><span>Idioma padrão</span><select id="settingLanguage"><option value="pt-BR">Português (Brasil)</option><option value="en-US">Inglês</option></select></label>
            <label class="field"><span>Plataforma padrão</span><select id="settingPlatform"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="threads">Threads</option><option value="x">X</option><option value="youtube">YouTube</option></select></label>
            <label class="field"><span>Tom padrão das legendas</span><input id="settingCaptionTone" placeholder="natural, confiante e elegante" /></label>
            <label class="field"><span>Modelo de texto do Workers AI</span><input id="settingTextModel" placeholder="@cf/meta/llama-3.2-3b-instruct" /></label>
            <label class="field"><span>Priorizar provedor gratuito</span><select id="settingFreeFirst"><option value="true">Sim</option><option value="false">Não</option></select></label>
            <button class="btn btn-primary" type="submit">Salvar preferências</button>
            <div id="studioSettingsMessage"></div>
          </form>
        </section>
      </div>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><h3>Chaves de provedores externos</h3><span class="badge warning">Segredos protegidos</span></div>
        <p class="muted small">As chaves privadas de OpenAI, Google, Replicate, FAL e Stability continuam armazenadas como Segredos da Cloudflare. O painel permite testar, ativar, desativar e priorizar provedores sem expor essas chaves no navegador.</p>
      </section>`;

    root.appendChild(panel);

    document.getElementById("settingLanguage").value = settings.get("default_language") || "pt-BR";
    document.getElementById("settingPlatform").value = settings.get("default_platform") || "instagram";
    document.getElementById("settingCaptionTone").value = settings.get("caption_tone") || "natural, confiante e elegante";
    document.getElementById("settingTextModel").value = settings.get("text_ai_model") || "@cf/meta/llama-3.2-3b-instruct";
    document.getElementById("settingFreeFirst").value = String(settings.get("free_first_mode") ?? true);

    document.getElementById("changePasswordForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const current = document.getElementById("currentAdminPassword").value;
      const next = document.getElementById("newAdminPassword").value;
      const confirm = document.getElementById("confirmAdminPassword").value;
      const message = document.getElementById("passwordChangeMessage");
      if (next !== confirm) {
        showMessage(message, "As novas senhas não coincidem.", false);
        return;
      }
      try {
        await request("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ current_password: current, new_password: next }),
        });
        showMessage(message, "Senha alterada com sucesso. Use a nova senha no próximo login.", true);
        if (form instanceof HTMLFormElement) form.reset();
      } catch (err) {
        showMessage(message, err.message || "Não foi possível alterar a senha.", false);
      }
    });

    document.getElementById("studioSettingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("studioSettingsMessage");
      try {
        await Promise.all([
          saveSetting("default_language", document.getElementById("settingLanguage").value),
          saveSetting("default_platform", document.getElementById("settingPlatform").value),
          saveSetting("caption_tone", document.getElementById("settingCaptionTone").value.trim()),
          saveSetting("text_ai_model", document.getElementById("settingTextModel").value.trim()),
          saveSetting("free_first_mode", document.getElementById("settingFreeFirst").value === "true"),
        ]);
        showMessage(message, "Preferências salvas com sucesso.", true);
      } catch (err) {
        showMessage(message, err.message || "Não foi possível salvar as preferências.", false);
      }
    });
  }

  let timer = null;
  function scheduleEnhance() {
    clearTimeout(timer);
    timer = setTimeout(enhanceSettings, 120);
  }

  window.addEventListener("hashchange", scheduleEnhance);
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleEnhance();
})();
