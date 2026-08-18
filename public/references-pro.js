(() => {
  "use strict";
  const MODEL = "yasmin";
  const token = () => sessionStorage.getItem("yasmin_token") || "";
  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (token()) headers.set("Authorization", `Bearer ${token()}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const r = await fetch(path, { ...options, headers });
    const p = await r.json().catch(() => null);
    if (!r.ok || p?.success === false) throw new Error(p?.error?.message || `Erro HTTP ${r.status}`);
    return p?.data ?? p;
  };
  const toast = (msg, type = "success") => {
    const root = document.getElementById("toastRoot"); if (!root) return;
    const n = document.createElement("div"); n.className = `toast ${type}`; n.textContent = msg; root.appendChild(n); setTimeout(() => n.remove(), 4200);
  };
  const esc = (v = "") => String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const labels = { FACE:"Rosto", BODY:"Corpo", HAIR:"Cabelo", MASTER:"Referência geral", STYLE:"Estilo", TEMPORARY:"Temporária" };
  const masterLabel = (r) => r.is_master_face ? "ROSTO PRINCIPAL" : r.is_master_body ? "CORPO PRINCIPAL" : r.is_master_full ? "REFERÊNCIA GERAL" : "";

  async function imageUrl(key) {
    const r = await fetch(`/assets/${encodeURI(key)}`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!r.ok) return ""; return URL.createObjectURL(await r.blob());
  }

  async function enhance() {
    if (location.hash !== "#references") return;
    const root = document.getElementById("viewRoot");
    if (!root || root.querySelector("#referenceProPanel") || !root.querySelector("#referenceForm")) return;

    const oldForm = root.querySelector("#referenceForm");
    const card = oldForm.closest(".card");
    if (card) card.style.display = "none";

    const refs = await api(`/models/${MODEL}/references?active=all`).catch(() => []);
    if (location.hash !== "#references" || root.querySelector("#referenceProPanel")) return;

    const panel = document.createElement("section");
    panel.id = "referenceProPanel";
    panel.className = "card";
    panel.style.marginBottom = "16px";
    panel.innerHTML = `
      <div class="card-head"><div><h3>Vault de identidade visual</h3><p class="muted small">Envie uma ou várias imagens, classifique e escolha as referências principais da Yasmin.</p></div><span class="badge purple">${refs.filter(r=>r.active).length} ativas</span></div>
      <form id="referenceProForm" class="stack gap-md">
        <label class="field"><span>Imagens</span><input id="refProFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple required /><small class="muted">Você pode selecionar várias imagens de uma vez.</small></label>
        <div class="grid grid-3">
          <label class="field"><span>Categoria</span><select id="refProType"><option value="FACE">Rosto</option><option value="BODY">Corpo</option><option value="HAIR">Cabelo</option><option value="MASTER">Referência geral</option><option value="STYLE">Estilo</option><option value="TEMPORARY">Temporária</option></select></label>
          <label class="field"><span>Prioridade</span><input id="refProPriority" type="number" min="0" max="100" value="10" /></label>
          <label class="field"><span>Peso</span><input id="refProWeight" type="number" min="0" max="5" step="0.1" value="1" /></label>
        </div>
        <label class="field"><span>Descrição</span><input id="refProDescription" placeholder="Ex.: rosto frontal, luz neutra" /></label>
        <label class="field"><span>Definir como principal</span><select id="refProMaster"><option value="">Não</option><option value="FACE">Rosto principal (Master Face)</option><option value="BODY">Corpo principal (Master Body)</option><option value="FULL">Referência geral principal (Master Full)</option></select></label>
        <button id="refProSubmit" class="btn btn-primary" type="submit">Enviar referência(s)</button>
      </form>`;
    root.prepend(panel);

    panel.querySelector("#referenceProForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const files = [...panel.querySelector("#refProFiles").files]; if (!files.length) return;
      const btn = panel.querySelector("#refProSubmit"); btn.disabled = true; btn.textContent = `Enviando 0/${files.length}…`;
      try {
        for (let i=0;i<files.length;i++) {
          const f = new FormData(); f.set("file", files[i]); f.set("reference_type", panel.querySelector("#refProType").value); f.set("priority", panel.querySelector("#refProPriority").value); f.set("weight", panel.querySelector("#refProWeight").value); f.set("description", panel.querySelector("#refProDescription").value || files[i].name);
          if (files.length === 1) f.set("master_kind", panel.querySelector("#refProMaster").value);
          await api(`/models/${MODEL}/references`, { method:"POST", body:f }); btn.textContent = `Enviando ${i+1}/${files.length}…`;
        }
        toast("Referências enviadas para o R2."); location.reload();
      } catch(err) { toast(err.message, "error"); btn.disabled=false; btn.textContent="Enviar referência(s)"; }
    });

    const oldGrid = root.querySelector("#referenceGrid"); if (oldGrid) oldGrid.style.display = "none";
    const title = oldGrid?.previousElementSibling; if (title) title.style.display = "none";
    const gallery = document.createElement("div"); gallery.className = "ref-grid"; gallery.id = "referenceProGrid";
    gallery.innerHTML = refs.length ? refs.map(r => `<article class="ref-card" data-pro-ref="${esc(r.id)}"><div class="asset-media"><div class="skeleton" style="width:100%;height:100%"></div></div><div class="ref-info"><div class="between"><strong>${labels[r.reference_type] || esc(r.reference_type)}</strong><span class="badge ${r.active ? "success" : "warning"}">${r.active ? "ATIVA" : "INATIVA"}</span></div>${masterLabel(r) ? `<span class="badge purple">${masterLabel(r)}</span>`:""}<span class="muted small">${esc(r.description || "Sem descrição")}</span><div class="row-wrap"><button class="btn" data-master-face>Rosto principal</button><button class="btn" data-master-body>Corpo principal</button><button class="btn" data-toggle>${r.active ? "Desativar" : "Ativar"}</button><button class="btn btn-danger" data-delete>Excluir</button></div></div></article>`).join("") : `<div class="empty">Nenhuma referência cadastrada.</div>`;
    root.appendChild(gallery);

    for (const r of refs) {
      const c = gallery.querySelector(`[data-pro-ref="${CSS.escape(r.id)}"]`); if (!c) continue;
      const u = await imageUrl(r.storage_key).catch(()=>""); c.querySelector(".asset-media").innerHTML = u ? `<img src="${u}" alt="${labels[r.reference_type] || "Referência"}" />` : `<div class="image-placeholder">Imagem indisponível</div>`;
      c.querySelector("[data-master-face]").onclick = async()=>{ await api(`/models/references/${r.id}`,{method:"PATCH",body:JSON.stringify({is_master_face:1,is_master_body:0,is_master_full:0})}); toast("Rosto principal atualizado."); location.reload(); };
      c.querySelector("[data-master-body]").onclick = async()=>{ await api(`/models/references/${r.id}`,{method:"PATCH",body:JSON.stringify({is_master_body:1,is_master_face:0,is_master_full:0})}); toast("Corpo principal atualizado."); location.reload(); };
      c.querySelector("[data-toggle]").onclick = async()=>{ await api(`/models/references/${r.id}`,{method:"PATCH",body:JSON.stringify({active:r.active?0:1})}); location.reload(); };
      c.querySelector("[data-delete]").onclick = async()=>{ if(!confirm("Excluir esta referência permanentemente?"))return; await api(`/models/references/${r.id}`,{method:"DELETE"}); toast("Referência excluída."); location.reload(); };
    }
  }

  let timer; const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,150)};
  addEventListener("hashchange",schedule); new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true}); schedule();
})();
