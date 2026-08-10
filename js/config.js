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
