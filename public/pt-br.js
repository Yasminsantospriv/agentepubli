(() => {
  "use strict";

  const exact = new Map([
    ["Dashboard", "Painel"], ["Create", "Criar"], ["Library", "Biblioteca"],
    ["References", "Referências"], ["Trends", "Tendências"], ["Planner", "Planejador"],
    ["Automations", "Automações"], ["AI Agent", "Agente de IA"], ["Settings", "Configurações"],
    ["GENERATION STUDIO", "ESTÚDIO DE GERAÇÃO"], ["CONTENT", "CONTEÚDO"],
    ["IDENTITY", "IDENTIDADE"], ["DISCOVERY", "DESCOBERTA"],
    ["CONTENT CALENDAR", "CALENDÁRIO DE CONTEÚDO"], ["WORKFLOWS", "FLUXOS DE AUTOMAÇÃO"],
    ["COMMAND CENTER", "CENTRO DE COMANDO"], ["SYSTEM", "SISTEMA"],
    ["System Health", "Saúde do sistema"], ["Live", "Ao vivo"],
    ["Generate Image", "Gerar imagem"], ["Add Reference", "Adicionar referência"],
    ["Analyze Trend", "Analisar tendência"], ["Content Idea", "Ideia de conteúdo"],
    ["Providers", "Provedores"], ["Provider", "Provedor"],
    ["AI Providers", "Provedores de IA"], ["Yasmin Identity", "Identidade da Yasmin"],
    ["Identity Lock", "Trava de identidade"], ["Identity Lock padrão", "Trava de identidade padrão"],
    ["Reference Vault", "Cofre de referências"], ["Resumo do Vault", "Resumo do cofre"],
    ["Draft-first", "Rascunho primeiro"], ["Threshold (se aplicável)", "Limite (se aplicável)"],
    ["ACTIVE", "ATIVA"], ["PAUSED", "PAUSADA"], ["ONLINE", "ATIVO"],
    ["OFFLINE", "INATIVO"], ["ERROR", "ERRO"], ["NOT_CONFIGURED", "NÃO CONFIGURADO"],
    ["PROCESSING", "PROCESSANDO"], ["COMPLETED", "CONCLUÍDO"], ["FAILED", "FALHOU"],
    ["PENDING", "PENDENTE"], ["APPROVED", "APROVADO"], ["REJECTED", "REJEITADO"],
    ["READY", "PRONTO"], ["DRAFT", "RASCUNHO"], ["PUBLISHED", "PUBLICADO"],
    ["Landscape", "Paisagem"], ["AUTO / fallback", "AUTOMÁTICO / alternativa"],
    ["AI Command Center", "Centro de comando de IA"],
    ["Nenhum modelo listado", "Nenhum modelo disponível"],
  ]);

  const replacements = [
    [/Generation Studio/gi, "Estúdio de Geração"],
    [/Reference Vault/gi, "Cofre de Referências"],
    [/System Health/gi, "Saúde do sistema"],
    [/AI Providers/gi, "Provedores de IA"],
    [/AI Command Center/gi, "Centro de Comando de IA"],
    [/Identity Lock/gi, "Trava de identidade"],
    [/Provider online\./gi, "Provedor online."],
    [/Provider ativado\./gi, "Provedor ativado."],
    [/Provider desativado\./gi, "Provedor desativado."],
    [/Settings → AI Providers/gi, "Configurações → Provedores de IA"],
    [/Library/gi, "Biblioteca"],
    [/Planner/gi, "Planejador"],
    [/Trends/gi, "Tendências"],
  ];

  function translateText(text) {
    const trimmed = text.trim();
    if (!trimmed) return text;
    if (exact.has(trimmed)) return text.replace(trimmed, exact.get(trimmed));
    let out = text;
    for (const [pattern, value] of replacements) out = out.replace(pattern, value);
    return out;
  }

  function translateNode(root = document.body) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest("script,style,textarea,input")) continue;
      const translated = translateText(node.nodeValue || "");
      if (translated !== node.nodeValue) node.nodeValue = translated;
    }
  }

  translateNode();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const translated = translateText(node.nodeValue || "");
          if (translated !== node.nodeValue) node.nodeValue = translated;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          translateNode(node);
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
