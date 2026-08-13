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
  mode: "local",

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
    url: "",      // Ex: "https://xyzcompany.supabase.co"
    anonKey: "",  // Chave pública fornecida pelo Supabase
    syncIntervalMs: 30000 // Sincronização automática a cada 30 segundos
  },

  // Setores Corporativos Integrados (Atuação Multidepartamental)
  departments: [
    { id: "sac", name: "SAC / Operação", color: "green" },
    { id: "cd", name: "Centro de Distribuição (CD)", color: "amber" },
    { id: "financeiro", name: "Financeiro & Comercial", color: "blue" },
    { id: "frota", name: "Manutenção & Frota", color: "red" }
  ]
};
