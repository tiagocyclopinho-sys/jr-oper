const fs = require('fs');
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
global.fetch = async () => { throw new Error('fetch nao esperado'); };

eval(fs.readFileSync(process.argv[2] || (__dirname + '/../js/cloudStore.js'), 'utf8'));
const cs = window.cloudStore;

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}
function zerar() {
  for (const k of Object.keys(store)) delete store[k];
  cs._mapaSync = null;
}
function ids(lista) { return lista.map(r => r.id).sort((a, b) => a - b); }

console.log('\n== ITEM 1 — envio só do que mudou ==');

zerar();
const col = [
  { id: 1, carga: 'A', data_saida: '2026-08-01' },
  { id: 2, carga: 'B', data_saida: '2026-08-02' },
  { id: 3, carga: 'C', data_saida: '2026-08-03' }
];
conferir('sem mapa ainda: manda tudo', cs._separarOQueMudou('controle_viagens', col).length === 3);

cs._confirmarEnvio('controle_viagens', col);
conferir('depois de confirmado: não manda nada', cs._separarOQueMudou('controle_viagens', col).length === 0);

const col2 = JSON.parse(JSON.stringify(col));
col2[1].status_viagem = 'FINALIZADO';
let mudados = cs._separarOQueMudou('controle_viagens', col2);
conferir('só o registro editado sobe', mudados.length === 1 && mudados[0].id === 2, ids(mudados));

const col3 = col2.concat([{ id: 4, carga: 'D', data_saida: '2026-08-04' }]);
mudados = cs._separarOQueMudou('controle_viagens', col3);
conferir('registro novo também sobe', ids(mudados).join(',') === '2,4', ids(mudados));

const mesmaOrdemTrocada = [{ data_saida: '2026-08-01', carga: 'A', id: 1 }];
conferir('ordem das propriedades não conta como mudança', cs._separarOQueMudou('controle_viagens', mesmaOrdemTrocada).length === 0);

console.log('\n== ITEM 2 — mesclagem por registro ==');

zerar();
// estado inicial: nuvem e local iguais e confirmados
const nuvem1 = [
  { id: 1, carga: 'A', obs: 'nuvem' },
  { id: 2, carga: 'B', obs: 'nuvem' }
];
let local = JSON.stringify(nuvem1);
let r = cs._mesclarPorRegistro('controle_viagens', local, nuvem1);
conferir('primeira leitura: fica igual à nuvem', JSON.stringify(r) === JSON.stringify(nuvem1));

// agora o aparelho edita o registro 2 e ainda não enviou
const localEditado = JSON.parse(JSON.stringify(nuvem1));
localEditado[1].obs = 'editado aqui';
// e a nuvem, nesse meio tempo, mudou o registro 1
const nuvem2 = [
  { id: 1, carga: 'A', obs: 'mudou na nuvem' },
  { id: 2, carga: 'B', obs: 'nuvem' }
];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(localEditado), nuvem2);
conferir('o que mudou na nuvem entra', r.find(x => x.id === 1).obs === 'mudou na nuvem', r);
conferir('o que foi editado aqui e não subiu é preservado', r.find(x => x.id === 2).obs === 'editado aqui', r);
conferir('o registro preservado continua pendente de envio', cs._separarOQueMudou('controle_viagens', r).length === 1);

console.log('\n== ITEM 3 — exclusão durável ==');

zerar();
// aparelho conhece o registro (limpo, confirmado)
const antes = [{ id: 10, carga: 'X', is_deleted: false }];
cs._mesclarPorRegistro('controle_viagens', JSON.stringify(antes), antes);
// alguém exclui em outro aparelho; a nuvem devolve is_deleted true
const depois = [{ id: 10, carga: 'X', is_deleted: true }];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(antes), depois);
conferir('exclusão feita em outro aparelho entra aqui', r[0].is_deleted === true, r);
conferir('e não volta a subir com is_deleted falso', cs._separarOQueMudou('controle_viagens', r).length === 0);

zerar();
// cenário do Reset Global: registro que a nuvem já confirmou some de lá
const conhecido = [{ id: 20, carga: 'Y' }];
cs._mesclarPorRegistro('controle_viagens', JSON.stringify(conhecido), conhecido);
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(conhecido), []);
conferir('registro apagado na nuvem não é ressuscitado', r.length === 0, r);

zerar();
// registro criado aqui e que nunca subiu: a nuvem não tem, mas não pode sumir
const novoLocal = [{ id: 30, carga: 'Z' }];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(novoLocal), []);
conferir('registro local que nunca subiu é preservado', r.length === 1 && r[0].id === 30, r);
conferir('e continua na fila de envio', cs._separarOQueMudou('controle_viagens', r).length === 1);

console.log('\n== PRIMEIRA EXECUÇÃO — aparelho parado com cache velho ==');

zerar();
// o aparelho tem 3 viagens velhas; a nuvem tem a versão corrigida de uma
// delas e não tem mais as outras duas (foram excluídas por lá)
const cacheVelho = [
  { id: 1, carga: 'A', obs: 'versao velha' },
  { id: 2, carga: 'B', obs: 'velha' },
  { id: 3, carga: 'C', obs: 'velha' }
];
const nuvemHoje = [{ id: 1, carga: 'A', obs: 'versao corrigida' }];
r = cs._mesclarPorRegistro('controle_viagens', JSON.stringify(cacheVelho), nuvemHoje);
conferir('a versão da nuvem vence o cache velho', r.find(x => x.id === 1).obs === 'versao corrigida', r);
conferir('nada da nuvem é sobrescrito na primeira execução', cs._separarOQueMudou('controle_viagens', [r.find(x => x.id === 1)]).length === 0);

(async () => {

console.log('\n== ENVIO RECUSADO CONTINUA PENDENTE ==');

zerar();
store['jr_sac_db'] = JSON.stringify({ controle_viagens: [{ id: 50, carga: 'W', data_saida: '2026-08-10' }] });
store['jr_reset_epoch'] = '0';
let tentativas = 0;
global.fetch = async (url, opts) => {
  if (String(url).includes('sync_control')) return { ok: true, json: async () => [] };
  if (!opts || opts.method !== 'POST') return { ok: true, json: async () => [] };
  tentativas++;
  return { ok: false, status: 400, text: async () => '{"message":"coluna inexistente"}' };
};
await cs.syncLocalToCloud();
const pendenteDepoisDaFalha = cs._separarOQueMudou('controle_viagens', [{ id: 50, carga: 'W', data_saida: '2026-08-10' }]);
conferir('envio recusado não marca como enviado', pendenteDepoisDaFalha.length === 1, pendenteDepoisDaFalha);

console.log('\n== AUDITORIA DO CACHE (diagnóstico da ETAPA 3) ==');

zerar();
store['jr_controle_viagens'] = JSON.stringify([
  { id: 1, carga: 'REAL', data_saida: '2026-08-01' },
  { id: 2, carga: 'PALMAS 02/07', data_saida: 'INICIADO' },
  { id: 3, carga: 'PALMAS 03/07', data_saida: 'NÃO INICIADO' }
]);
cs._auditarCacheLocal();
conferir('acha os contaminados no cache mesmo sem enviar nada', cs.getDiagnostico().bloqueadosNaEscrita.total === 2, cs.getDiagnostico().bloqueadosNaEscrita);

store['jr_controle_viagens'] = JSON.stringify([{ id: 1, carga: 'REAL', data_saida: '2026-08-01' }]);
cs._auditarCacheLocal();
conferir('aparelho limpo volta a null', cs.getDiagnostico().bloqueadosNaEscrita === null);

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);

})();
