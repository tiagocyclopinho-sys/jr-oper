const fs = require('fs');
const base = process.argv[2] || (__dirname + '/..');

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(String(detalhe).slice(0, 300)) : ''));
  if (!ok) falhas++;
}

const armazem = {};
global.localStorage = {
  getItem: k => (k in armazem ? armazem[k] : null),
  setItem: (k, v) => { armazem[k] = String(v); },
  removeItem: k => { delete armazem[k]; }
};
global.document = { addEventListener() {}, getElementById() { return null; }, body: null };
global.window = global;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36' }, configurable: true, writable: true });
global.JR_CONFIG = { supabase: { url: 'https://exemplo.supabase.co', anonKey: 'x'.repeat(40) } };
global.addEventListener = () => {};
global.alert = () => {};
global.sessionStorage = global.localStorage;
let requisicoes = [];
global.fetch = async (url, opts) => {
  requisicoes.push({ url: String(url), opts });
  return { ok: true, status: 200, json: async () => [], text: async () => '' };
};
global.renderApp = () => {};

eval(fs.readFileSync(base + '/js/cloudStore.js', 'utf8'));
const cs = window.cloudStore;
global.CloudStore = cs.constructor;

// extrai da app.js só o bloco da tela de Aparelhos
const app = fs.readFileSync(base + '/js/app.js', 'utf8');
const ini = app.indexOf('// TELA DE APARELHOS');
const fim = app.indexOf('function renderConflitosContent(');
if (ini < 0 || fim < 0) { console.error('bloco da tela de Aparelhos nao encontrado'); process.exit(1); }
eval(app.slice(ini, fim));

console.log('\n== ITEM 12 — identidade do aparelho ==');
const id1 = CloudStore.idDoAparelho();
const id2 = CloudStore.idDoAparelho();
conferir('id do aparelho é estável', id1 === id2 && /^ap-/.test(id1), id1);
conferir('e fica guardado no navegador', armazem['jr_device_id'] === id1);
const carimbo = CloudStore.carimboDoAparelho();
conferir('carimbo é um número de 0 a 999', Number.isInteger(carimbo) && carimbo >= 0 && carimbo <= 999, carimbo);
conferir('plataforma é detectada', cs._plataformaDoAparelho() === 'Windows / Chrome', cs._plataformaDoAparelho());
conferir('apelido cai na plataforma quando ninguém nomeou', cs.apelidoDoAparelho() === 'Windows / Chrome');
cs.nomearAparelho('CCO 1');
conferir('e passa a valer o nome dado', cs.apelidoDoAparelho() === 'CCO 1');

console.log('\n== ITEM 9 — ids de aparelhos diferentes não colidem ==');
// simula dois aparelhos gerando ids no mesmo milissegundo
function geradorDeIds(carimbo) {
  let ultimo = 0;
  return () => {
    const agora = 1756000000000;                 // mesmo milissegundo para os dois
    const proximo = Math.max(agora, ultimo + 1);
    ultimo = proximo;
    return proximo * 1000 + carimbo;
  };
}
const apA = geradorDeIds(123), apB = geradorDeIds(456);
const idsA = [], idsB = [];
for (let i = 0; i < 500; i++) { idsA.push(apA()); idsB.push(apB()); }
conferir('500 ids seguidos no mesmo aparelho, nenhum repetido', new Set(idsA).size === 500);
conferir('nenhum id de um aparelho bate com o do outro', idsA.filter(x => idsB.includes(x)).length === 0);
conferir('id continua dentro do limite seguro do JavaScript', Math.max(...idsA) < Number.MAX_SAFE_INTEGER);

console.log('\n== ITEM 12 — tela de Aparelhos ==');

window._aparelhosCache = { estado: 'ok', lista: [], semTabela: true };
let html = renderAparelhosContent();
conferir('sem a tabela no banco, explica a ETAPA 2b', /ETAPA 2b/.test(html) && /migration_25a/.test(html));

window._aparelhosCache = { estado: 'ok', lista: [], semTabela: false };
html = renderAparelhosContent();
conferir('lista vazia orienta a abrir o app nas máquinas', /Nenhum aparelho registrado/.test(html));

const buildAtual = cs.getDiagnostico().buildSync;
window._aparelhosCache = {
  estado: 'ok',
  semTabela: false,
  lista: [
    { id: CloudStore.idDoAparelho(), apelido: 'CCO 1', plataforma: 'Windows / Chrome', build: buildAtual, ultimo_usuario: 'THIAGO', ultimo_acesso: new Date().toISOString(), registros_recusados: 0 },
    { id: 'ap-velho', apelido: 'PC da Expedição', plataforma: 'Windows / Chrome', build: 'sync-4.7.9', ultimo_usuario: 'MARIA', ultimo_acesso: new Date(Date.now() - 3 * 86400000).toISOString(), registros_recusados: 247 }
  ]
};
html = renderAparelhosContent();
conferir('marca qual é o aparelho em que estou', /\(este\)/.test(html));
conferir('avisa quantos estão em versão antiga', /<b>1<\/b> aparelho\(s\) em versão antiga/.test(html));
// Números DIFERENTES entre aparelhos (0 e 247): é aparelho destoante, e a
// tarja tem que mandar atualizar aquele aparelho.
conferir('números que não batem apontam o aparelho destoante',
  /não batem entre si/.test(html) && /ETAPA 3/.test(html));

// Números IGUAIS em todos: os registros estão no BANCO, não num aparelho.
// Mandar limpar cache aqui era o texto errado — limpar não resolve, porque
// o pull baixa os mesmos registros de volta no ciclo seguinte. A correção
// de 22/08/2026 fez a tarja apontar a ETAPA 1 (migration_25) nesse caso.
window._aparelhosCache.lista = [
  { id: CloudStore.idDoAparelho(), apelido: 'CCO 1', plataforma: 'Windows / Chrome', build: buildAtual, ultimo_usuario: 'THIAGO', ultimo_acesso: new Date().toISOString(), registros_recusados: 247 },
  { id: 'ap-2', apelido: 'Celular', plataforma: 'Android / Chrome', build: buildAtual, ultimo_usuario: 'MARIA', ultimo_acesso: new Date().toISOString(), registros_recusados: 247 }
];
const htmlIguais = renderAparelhosContent();
conferir('números iguais apontam o banco, não o aparelho',
  /Todos os aparelhos marcam/.test(htmlIguais) && /ETAPA 1/.test(htmlIguais));
conferir('e não manda limpar cache nesse caso',
  /Limpar cache não resolve/.test(htmlIguais));

// Volta o fixture original para os testes seguintes.
window._aparelhosCache.lista = [
  { id: CloudStore.idDoAparelho(), apelido: 'CCO 1', plataforma: 'Windows / Chrome', build: buildAtual, ultimo_usuario: 'THIAGO', ultimo_acesso: new Date().toISOString(), registros_recusados: 0 },
  { id: 'ap-velho', apelido: 'PC da Expedição', plataforma: 'Windows / Chrome', build: 'sync-4.7.9', ultimo_usuario: 'MARIA', ultimo_acesso: new Date(Date.now() - 3 * 86400000).toISOString(), registros_recusados: 247 }
];
html = renderAparelhosContent();
conferir('mostra o número de recusados', />247</.test(html));
conferir('aponta o roteiro de conferência', /CONFERIR_APARELHO\.md/.test(html));
conferir('mostra tempo relativo em vez de data crua', /há 3 dias/.test(html), html.match(/há [^<]*/g));

console.log('\n== ITEM 11 — auto-atualização ==');

requisicoes = [];
global.fetch = async (url, opts) => {
  requisicoes.push({ url: String(url), opts });
  if (String(url).includes('version.json')) {
    return { ok: true, status: 200, json: async () => ({ build: buildAtual }) };
  }
  return { ok: true, status: 200, json: async () => [], text: async () => '' };
};
let recarregou = 0;
global.location = { reload: () => { recarregou++; } };
let r = null;
(async () => {
  r = await window.jrConferirVersaoPublicada();
  conferir('versão igual: não recarrega nada', recarregou === 0 && r === buildAtual, { recarregou, r });

  // agora a nuvem publica uma versão nova
  global.fetch = async (url, opts) => {
    requisicoes.push({ url: String(url), opts });
    if (String(url).includes('version.json')) {
      return { ok: true, status: 200, json: async () => ({ build: 'sync-9.9.9' }) };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '' };
  };
  requisicoes = [];
  delete armazem['jr_update_tentado'];
  await window.jrConferirVersaoPublicada();
  conferir('versão nova: recarrega o app', recarregou === 1, recarregou);
  const recarregados = requisicoes.filter(q => q.opts && q.opts.cache === 'reload').map(q => q.url);
  conferir('e rebaixa as cópias guardadas dos arquivos do app', recarregados.includes('./js/app.js') && recarregados.includes('./index.html'), recarregados);
  conferir('sem query string nos arquivos (senão seria outro endereço)', recarregados.every(u => !u.includes('?')), recarregados);

  // segunda tentativa para a mesma versão: não entra em laço
  recarregou = 0;
  await window.jrConferirVersaoPublicada();
  conferir('não recarrega em laço se a atualização não pegar', recarregou === 0, recarregou);

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
})();
