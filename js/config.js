// =================================================================
// CONFIGURAÇÕES GERAIS DO JR OPER / JR SAC
// Permite alternar entre armazenamento local (gratuito/offline)
// e Banco de Dados na Nuvem (Supabase/PostgreSQL - plano gratuito)
// =================================================================

window.JR_CONFIG = {
  // Nome da Aplicação e Versão
  appName: "JR Oper - Gestão Logística Integrada",
  appVersion: "5.2.0",
  
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

// =================================================================
// FUSO HORARIO OFICIAL DO SISTEMA - America/Sao_Paulo
//
// Toda pergunta de CALENDARIO ("que dia e hoje?", "de que dia e este
// registro?") tem de ser respondida no fuso de Brasilia, porque e nele que a
// operacao acontece. Antes o app respondia em UTC - a expressao
// new Date().toISOString().split('T')[0] aparecia em 30 lugares - e o Brasil
// e UTC-3.
//
// O efeito pratico so aparecia depois das 21h, justamente no 3o turno do CD:
//   - o campo "Data" dos formularios ja abria preenchido com AMANHA;
//   - o que fosse registrado as 22h era gravado com a data do dia seguinte;
//   - e o Dashboard, filtrado em "Hoje", nao mostrava esses lancamentos.
//
// Nada disso aparece de dia, e e isso que torna o defeito caro: ele so se
// manifesta no turno da noite, para quem tem menos gente por perto para
// conferir.
//
// IMPORTANTE: o INSTANTE continua gravado em UTC (criado_em, via
// new Date().toISOString()). Isso esta certo e nao muda - instante e
// absoluto, e o banco guarda TIMESTAMP. O que passa a sair daqui e apenas a
// DATA DE CALENDARIO derivada desse instante.
// =================================================================
window.JR_FUSO = 'America/Sao_Paulo';

// Converte um instante (ms) para a data de calendario em Brasilia,
// no formato 'AAAA-MM-DD'. Sem argumento, usa agora.
function dataIsoBrasilia(ms) {
  const d = (ms === undefined || ms === null) ? new Date() : new Date(ms);
  if (isNaN(d.getTime())) return '';
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: window.JR_FUSO,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
    if (p.year && p.month && p.day) return p.year + '-' + p.month + '-' + p.day;
  } catch (e) { /* cai no plano B */ }
  // Plano B, para aparelho sem a base de fusos do Intl: o Brasil nao usa
  // mais horario de verao desde 2019, entao -03:00 e constante.
  return new Date(d.getTime() - 3 * 3600000).toISOString().split('T')[0];
}

// "Que dia e hoje?" em Brasilia.
function hojeIsoBrasilia() {
  return dataIsoBrasilia();
}

// Soma (ou subtrai) dias de uma data 'AAAA-MM-DD'. A conta e feita ao
// meio-dia UTC para que nenhum fuso empurre o resultado para o dia vizinho.
function somaDiasIso(iso, dias) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const p = iso.split('-').map(Number);
  const base = Date.UTC(p[0], p[1] - 1, p[2], 12);
  return new Date(base + dias * 86400000).toISOString().split('T')[0];
}

// CARIMBO DE INSTANTE ('AAAA-MM-DDTHH:MM:SS'), em hora de parede de Brasilia.
//
// E o que vai para criado_em, recebido_cd_em, despachado_em e afins. Substitui
// new Date().toISOString(), que gravava UTC.
//
// Por que hora de parede e nao UTC: as colunas sao TIMESTAMP WITHOUT TIME ZONE
// - o tipo diz "sem fuso". Guardar UTC ali obriga TODO consumidor a conhecer a
// convencao, e os consumidores de SQL nao conhecem: schema_views.sql entrega
// `criado_em AS data_abertura` cru para o Power BI. Gravando Brasilia,
// criado_em::date ja e a data certa em SQL, view, Power BI e exportacao, sem
// conversao em lugar nenhum.
//
// O banco foi alinhado junto (migration 29): os DEFAULT das 25 colunas
// TIMESTAMP passaram a ser (NOW() AT TIME ZONE 'America/Sao_Paulo').
//
// TERMINA COM '-03:00', e isso e essencial: a mesma string precisa servir a
// DOIS tipos de coluna que convivem no banco.
//
//   criado_em      TIMESTAMP WITHOUT TIME ZONE  (56 colunas)
//   atualizado_em  TIMESTAMP WITH TIME ZONE     (12 colunas)
//
// Com o offset explicito:
//   - a coluna SEM fuso ignora o offset e guarda a hora de parede -> 22:30
//   - a coluna COM fuso converte e guarda o instante certo
//
// Uma string sem offset estaria certa so para a primeira: a segunda a leria no
// fuso da SESSAO (UTC no Supabase) e gravaria 3h adiantado. Foi por isso que
// nao bastou tirar o 'Z'.
function agoraIsoBrasilia() {
  const d = new Date();
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: window.JR_FUSO,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }).formatToParts(d).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
    if (p.year && p.hour) {
      // hour12:false devolve '24' a meia-noite em alguns motores.
      const hh = p.hour === '24' ? '00' : p.hour;
      return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}-03:00`;
    }
  } catch (e) { /* cai no plano B */ }
  // Plano B: desloca 3h, corta o 'Z' e os milissegundos, e recoloca o offset.
  return new Date(d.getTime() - 3 * 3600000).toISOString().split('.')[0] + '-03:00';
}
