// =================================================================
// CONFIGURAÇÕES GERAIS DO JR OPER / JR SAC
// Permite alternar entre armazenamento local (gratuito/offline)
// e Banco de Dados na Nuvem (Supabase/PostgreSQL - plano gratuito)
// =================================================================

window.JR_CONFIG = {
  // Nome da Aplicação e Versão
  appName: "JR Oper - Gestão Logística Integrada",
  appVersion: "4.7.0",
  
  // Modo de Operação: 'local' (LocalStorage no navegador) ou 'cloud' (Supabase/Postgres)
  mode: "cloud",

  // PRIORIDADE 7c: Senha mestra de administrador centralizada em um único
  // ponto. Antes, o valor '4533215' estava hardcoded em 6+ lugares
  // diferentes (js/app.js, js/store.js, index.html) — trocar a senha no
  // futuro exigia caçar e editar cada um manualmente. Agora só se edita aqui.
  adminPassword: "4533215",

  // PRIORIDADE 8: data de início do uso real (produção). Antes dessa data,
  // o app exibe o badge "🧪 Modo Treinamento" no cabeçalho; a partir dela,
  // "✅ Modo Produção". Apenas informativo, não bloqueia nada.
  dataInicioProducao: "2026-08-26",

  // Configurações do Banco na Nuvem (Preencher quando criar a conta no Supabase - 100% Gratuito)
  supabase: {
    url: "https://qxipgnkdbzxtfvuyupow.supabase.co",
    anonKey: "sb_publishable_oX9VhXUCTJYqGJ-9MgusuQ_eKF-B0KN",
    syncIntervalMs: 30000 // Sincronização automática a cada 30 segundos
  },

  // Opções do campo "Requisito / Falha" das Ocorrências de Colaborador no
  // CD (modal "Registrar Ocorrência do CD" e apontamento por colaborador
  // no Resumo Diário). Antes esta lista estava duplicada em 2 lugares
  // diferentes no app.js — trocar/adicionar um motivo exigia lembrar de
  // editar os dois. Agora só se edita aqui (pedido de 19/08/2026).
  requisitosFalhaCD: [
    "ERRO DE RECEBIMENTO",
    "ERRO DE SEPARAÇÃO",
    "ERRO DE CONFERÊNCIA",
    "ERRO DE ABASTECIMENTO",
    "FALTA INJUSTIFICADA",
    "SAÍDA ANTECIPADA",
    "ATRASO NA CHEGADA",
    "DESVIO DE CONDUTA",
    "INSUBORDINAÇÃO",
    "AVARIA DE PRODUTO",
    "DANO AO PATRIMÔNIO",
    "OUTRO"
  ],

  // Setores Corporativos Integrados (Atuação Multidepartamental)
  departments: [
    { id: "sac", name: "SAC / Operação", color: "green" },
    { id: "cd", name: "Centro de Distribuição (CD)", color: "amber" },
    { id: "financeiro", name: "Financeiro & Comercial", color: "blue" },
    { id: "frota", name: "Manutenção & Frota", color: "red" }
  ]
};
