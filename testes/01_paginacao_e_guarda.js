const fs = require('fs');
// --- stubs de navegador ---
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.document = { addEventListener(){}, getElementById(){ return null; } };
global.window = global;
global.JR_CONFIG = { supabase: { url: 'https://exemplo.supabase.co', anonKey: 'x'.repeat(40) } };
global.addEventListener = () => {};
global.alert = () => {};
let chamadas = [];
global.fetch = async () => { throw new Error('fetch nao esperado'); };

eval(fs.readFileSync(process.argv[2] || (__dirname + '/../js/cloudStore.js'), 'utf8'));
const cs = window.cloudStore;

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (detalhe !== undefined && !ok ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}

function respostaComLinhas(linhas) {
  return { ok: true, json: async () => linhas, status: 200 };
}
function servidor(totalLinhas, opcoes = {}) {
  const cap = opcoes.cap || 1000;
  return async (url) => {
    chamadas.push(url);
    if (opcoes.falharNoBloco !== undefined && chamadas.length === opcoes.falharNoBloco) {
      return { ok: false, status: 500, text: async () => 'erro' };
    }
    if (opcoes.semColunaId) return { ok: false, status: 400, text: async () => 'column id does not exist' };
    const u = new URL(url);
    const limite = Math.min(Number(u.searchParams.get('limit') || cap), cap);
    const gt = u.searchParams.get('id');
    const desde = gt ? Number(String(gt).replace('gt.', '')) : 0;
    const linhas = [];
    for (let id = desde + 1; id <= totalLinhas && linhas.length < limite; id++) linhas.push({ id, carga: 'C' + id });
    return respostaComLinhas(linhas);
  };
}

(async () => {
  console.log('\n== ITEM 4 — paginação por cursor em id ==');

  chamadas = []; global.fetch = servidor(39);
  let r = await cs.getAll('controle_viagens');
  conferir('39 linhas: lê tudo em 1 bloco', r.length === 39 && chamadas.length === 1, { n: r.length, req: chamadas.length });

  chamadas = []; global.fetch = servidor(1200);
  r = await cs.getAll('controle_viagens');
  conferir('1200 linhas (acima do teto de 1.000): lê TODAS', r.length === 1200, { n: r.length });
  conferir('ids únicos e em ordem', new Set(r.map(x => x.id)).size === 1200 && r[0].id === 1 && r[1199].id === 1200);
  conferir('usou cursor id=gt., não offset', chamadas.slice(1).every(u => u.includes('id=gt.')) && !chamadas.some(u => u.includes('offset')), chamadas.map(u => u.split('?')[1]));

  chamadas = []; global.fetch = servidor(1000);
  r = await cs.getAll('controle_viagens');
  conferir('exatamente 1000 (múltiplo do bloco): não perde nem repete', r.length === 1000, { n: r.length });

  chamadas = []; global.fetch = servidor(0);
  r = await cs.getAll('cargas');
  conferir('tabela vazia devolve [] (e não null)', Array.isArray(r) && r.length === 0, r);

  chamadas = []; global.fetch = servidor(2000, { falharNoBloco: 3 });
  r = await cs.getAll('controle_viagens');
  conferir('falha no meio devolve null (não trunca o cache)', r === null, r && r.length);

  chamadas = []; global.fetch = servidor(50, { semColunaId: true });
  r = await cs.getAll('sync_control');
  conferir('tabela sem coluna id: recua para leitura única', r === null && chamadas.length === 2, { req: chamadas.length });

  chamadas = []; global.fetch = servidor(1200);
  r = await cs.getAll('controle_viagens', 'is_deleted=eq.false');
  conferir('filtro do chamador é preservado em todos os blocos', chamadas.every(u => u.includes('is_deleted=eq.false')) && r.length === 1200);

  chamadas = []; global.fetch = servidor(1200);
  r = await cs.getAll('controle_viagens', 'limit=10');
  conferir('chamador com limit próprio: 1 requisição só, sem paginar', chamadas.length === 1, { req: chamadas.length });

  console.log('\n== ITEM 7 — guarda na escrita ==');

  const lote = [
    { id: 1, carga: 'A1', data_saida: '2026-08-22' },
    { id: 2, carga: 'A2', data_saida: '22/08/2026' },
    { id: 3, carga: 'A3', data_saida: '' },
    { id: 4, carga: 'A4', data_saida: null },
    { id: 5, carga: 'A5' },
    { id: 6, carga: 'A6', data_saida: '2026-08-22T10:00:00' },
    { id: 7, carga: 'PALMAS 02/07', data_saida: 'INICIADO' },
    { id: 8, carga: 'PALMAS 03/07', data_saida: 'NÃO INICIADO' }
  ];
  const ok = cs._aplicarGuardaDeEscrita('controle_viagens', lote);
  conferir('deixa passar data ISO, dd/mm/aaaa, vazio, nulo e ausente', ok.length === 6, ok.map(x => x.id));
  conferir('recusa INICIADO e NÃO INICIADO', !ok.some(x => x.id === 7 || x.id === 8), ok.map(x => x.id));
  conferir('registra o bloqueio no diagnóstico', cs.getDiagnostico().bloqueadosNaEscrita.total === 2, cs.getDiagnostico().bloqueadosNaEscrita);

  const outra = [{ id: 1, data_saida: 'INICIADO' }];
  conferir('não mexe em outras tabelas', cs._aplicarGuardaDeEscrita('cargas', outra).length === 1);

  chamadas = [];
  let corpoEnviado = null;
  global.fetch = async (url, opts) => { corpoEnviado = JSON.parse(opts.body); return { ok: true, status: 201, text: async () => '' }; };
  let enviou = await cs.upsert('controle_viagens', lote);
  conferir('upsert envia só os aprovados', enviou === true && corpoEnviado.length === 6, corpoEnviado && corpoEnviado.length);

  corpoEnviado = null;
  let houveFetch = false;
  global.fetch = async () => { houveFetch = true; return { ok: true, status: 201, text: async () => '' }; };
  enviou = await cs.upsert('controle_viagens', [{ id: 9, data_saida: 'INICIADO' }]);
  conferir('lote 100% fantasma: nada vai para a rede', enviou === true && houveFetch === false);

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
})();
