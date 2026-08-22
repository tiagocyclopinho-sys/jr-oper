const fs = require('fs');
const base = process.argv[2] || (__dirname + '/..');   // pasta jr-sac-corrigido

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}

// ---------- ambiente de navegador ----------
const store = {};
let bloquearGravacao = false;
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => {
    if (bloquearGravacao && k === 'jr_sac_db') {
      const e = new Error('QuotaExceededError: cota estourada');
      e.name = 'QuotaExceededError';
      throw e;
    }
    store[k] = String(v);
  },
  removeItem: k => { delete store[k]; }
};
const elementos = {};
global.document = {
  body: { appendChild: el => { elementos[el.id] = el; } },
  createElement: () => ({ id: '', style: { cssText: '' }, innerHTML: '', remove() { delete elementos[this.id]; } }),
  getElementById: id => elementos[id] || null,
  addEventListener() {}
};
global.window = global;
global.JR_CONFIG = { supabase: { url: 'https://exemplo.supabase.co', anonKey: 'x'.repeat(40) } };
global.addEventListener = () => {};
let alertas = [];
global.alert = msg => { alertas.push(String(msg)); };
global.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => '' });

eval(fs.readFileSync(base + '/js/cloudStore.js', 'utf8'));
const cs = window.cloudStore;

// ================= ITEM 5 — janela operacional =================
console.log('\n== ITEM 5 — janela operacional ==');

const DIA = 24 * 60 * 60 * 1000;
const agora = Date.now();
function idNovo(quandoMs) { return quandoMs * 1000; }          // formato gerarIdUnico()
function idAntigo(quandoMs) { return quandoMs; }               // formato Date.now() (até 20/08)

conferir('90 dias é a janela configurada', cs.constructor.JANELA_OPERACIONAL_DIAS.controle_viagens === 90);

function mesclarLimpo(tabela, nuvem) {
  // duas passadas: a primeira registra os hashes (tudo limpo), a segunda é a
  // que interessa
  cs._mapaSync = null;
  for (const k of Object.keys(store)) delete store[k];
  cs._mesclarPorRegistro(tabela, JSON.stringify(nuvem), nuvem);
  return cs._mesclarPorRegistro(tabela, JSON.stringify(nuvem), nuvem);
}

let r = mesclarLimpo('controle_viagens', [
  { id: idNovo(agora - 5 * DIA),   carga: 'RECENTE' },
  { id: idNovo(agora - 120 * DIA), carga: 'VELHA' }
]);
conferir('viagem de 5 dias fica, viagem de 120 dias sai', r.length === 1 && r[0].carga === 'RECENTE', r.map(x => x.carga));

r = mesclarLimpo('controle_viagens', [
  { id: idAntigo(agora - 120 * DIA), carga: 'VELHA_ID_ANTIGO' },
  { id: idAntigo(agora - 5 * DIA),   carga: 'RECENTE_ID_ANTIGO' }
]);
conferir('entende o formato de id antigo (Date.now puro)', r.length === 1 && r[0].carga === 'RECENTE_ID_ANTIGO', r.map(x => x.carga));

r = mesclarLimpo('controle_viagens', [
  { id: idNovo(agora - 120 * DIA), carga: 'ID_VELHO_MAS', criado_em: new Date(agora - 2 * DIA).toISOString() }
]);
conferir('criado_em vale mais que o id', r.length === 1, r.map(x => x.carga));

r = mesclarLimpo('motoristas', [
  { id: idNovo(agora - 900 * DIA), nome: 'MOTORISTA ANTIGO' }
]);
conferir('tabela fora da janela nunca é podada (cadastro mestre)', r.length === 1, r);

// registro velho, mas editado aqui e ainda não enviado.
// (O mapa é montado à mão porque, num fluxo normal, um registro de 200 dias
// já teria saído do aparelho na primeira leitura — o caso só existe se ele
// foi editado ANTES de sair.)
cs._mapaSync = null;
for (const k of Object.keys(store)) delete store[k];
const velhaNuvem = { id: idNovo(agora - 200 * DIA), carga: 'VELHA', obs: 'nuvem' };
cs._mapaSync = { controle_viagens: { [String(velhaNuvem.id)]: cs._hashRegistro(velhaNuvem) } };
const velhaEditada = [{ id: velhaNuvem.id, carga: 'VELHA', obs: 'editei aqui' }];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(velhaEditada), [velhaNuvem]);
conferir('registro velho com edição não enviada NÃO é podado', r.length === 1 && r[0].obs === 'editei aqui', r);

// registro velho que só existe aqui
cs._mapaSync = null;
for (const k of Object.keys(store)) delete store[k];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify([{ id: idNovo(agora - 300 * DIA), carga: 'SO_AQUI' }]), []);
conferir('registro velho que nunca subiu NÃO é podado', r.length === 1, r);

// registro sem data legível
r = mesclarLimpo('controle_viagens', [{ id: 7, carga: 'SEM_RELOGIO' }]);
conferir('id que não é relógio: na dúvida, guarda', r.length === 1, r);

// o mapa de hashes não cresce com o que foi podado
cs._mapaSync = null;
for (const k of Object.keys(store)) delete store[k];
const muitas = [];
for (let i = 0; i < 50; i++) muitas.push({ id: idNovo(agora - (100 + i) * DIA), carga: 'V' + i });
cs._mesclarPorRegistro('controle_viagens', JSON.stringify(muitas), muitas);
cs._mesclarPorRegistro('controle_viagens', '[]', muitas);
conferir('mapa de hashes não guarda o que foi podado', Object.keys(cs._lerMapaSync().controle_viagens || {}).length === 0, Object.keys(cs._lerMapaSync().controle_viagens || {}).length);

// ================= ITEM 6 — alarme de cota =================
console.log('\n== ITEM 6 — alarme de gravação que falha ==');

for (const k of Object.keys(store)) delete store[k];
eval(fs.readFileSync(base + '/js/mockData.js', 'utf8'));
global.INITIAL_DATA = INITIAL_DATA;
eval(fs.readFileSync(base + '/js/store.js', 'utf8'));
const dbApp = window.db;
conferir('store carregou', !!dbApp && typeof dbApp.save === 'function');

alertas = [];
bloquearGravacao = true;
const resultado = dbApp.save();
bloquearGravacao = false;

conferir('save() devolve false quando não consegue gravar', resultado === false);
conferir('registra a falha no objeto do store', !!dbApp.ultimaFalhaDeGravacao, dbApp.ultimaFalhaDeGravacao);
conferir('mostra tarja vermelha na tela', !!elementos['jr-alerta-gravacao'], Object.keys(elementos));
conferir('a tarja diz que NÃO foi salvo', /NÃO foi salvo/.test((elementos['jr-alerta-gravacao'] || {}).innerHTML || ''));
conferir('e dispara um alerta para a pessoa parar', alertas.length === 1, alertas);

alertas = [];
bloquearGravacao = true;
dbApp.save();
bloquearGravacao = false;
conferir('não repete o alerta a cada gravação (1 por minuto)', alertas.length === 0, alertas);

const ok = dbApp.save();
conferir('gravação boa volta a devolver true', ok === true);
conferir('e a tarja some da tela', !elementos['jr-alerta-gravacao'], Object.keys(elementos));
conferir('e a marca de falha é limpa', dbApp.ultimaFalhaDeGravacao === null);

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
