// Detector de resquício de cache — build 4.8.3 (23/08/2026).
//
// Prova, sem navegador e sem encostar na nuvem, o que a conferência de
// camadas enxerga e o que ela deliberadamente NÃO acusa. O caso que deu
// origem a tudo isto está no primeiro bloco: um lançamento salvo por
// db.save() (que grava jr_sac_db e não o espelho) e ainda não enviado —
// o registro que o próximo pull apaga sem dizer nada.
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

eval(fs.readFileSync(__dirname + '/../js/cloudStore.js', 'utf8'));
const cs = window.cloudStore;

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}
function zerar() {
  for (const k of Object.keys(store)) delete store[k];
  cs._mapaSync = null;
  window.db = undefined;
}

const DEV_A = { id: 1001, veiculo_placa: 'TVD0F56', cliente_nome: 'X' };
const DEV_B = { id: 1002, veiculo_placa: 'BRA2E19', cliente_nome: 'Y' };
const DEV_NOVA = { id: 1003, veiculo_placa: 'OLI2E18', cliente_nome: 'Z' };

// Estado de um aparelho em dia: espelho, fatia operacional e mapa de envio
// concordando entre si, como fica logo depois de um pull completo.
function aparelhoEmDia(devs) {
  store['jr_ocorrencias'] = JSON.stringify(devs);
  store['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: devs.slice() });
  cs._mapaSync = null;
  cs._confirmarEnvio('ocorrencias_devolucao', devs);
}

console.log('\n== O caso de 23/08/2026: lançamento salvo, espelho velho ==');
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
// db.save() grava SÓ jr_sac_db (store.js:682). O espelho não é tocado.
store['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [DEV_A, DEV_B, DEV_NOVA] });

let r = cs.conferirCamadas();
conferir('acusa exatamente 1 divergência', r.totalDivergentes === 1, r.totalDivergentes);
conferir('classifica como EM RISCO de sumir', r.totalEmRisco === 1, r.totalEmRisco);
let t = r.tabelas.find(x => x.tabela === 'ocorrencias_devolucao');
conferir('aponta a tabela certa', !!t, r.tabelas.map(x => x.tabela));
conferir('aponta o espelho certo', t && t.espelho === 'jr_ocorrencias', t && t.espelho);
conferir('identifica o registro pela placa', t && t.divergentes[0].rotulo.indexOf('OLI2E18') >= 0, t && t.divergentes[0]);
conferir('mostra a contagem das duas cópias', t && t.contagens.sacDb === 3 && t.contagens.espelho === 2, t && t.contagens);

// E o pull, se rodar agora, confirma o prognóstico: some.
const mesclado = cs._mesclarPorRegistro('ocorrencias_devolucao', store['jr_ocorrencias'], [DEV_A, DEV_B]);
conferir('o prognóstico se confirma: o pull descarta o registro',
  !mesclado.some(x => x.id === 1003), mesclado.map(x => x.id));

console.log('\n== O que NÃO deve acusar ==');
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
r = cs.conferirCamadas();
conferir('aparelho em dia: nenhuma divergência', r.totalDivergentes === 0, r);

// Aparelho que nunca completou um pull não tem espelho. Isso é normal no
// primeiro dia, e acusá-lo transformaria o detector em ruído permanente.
zerar();
store['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [DEV_A, DEV_B] });
r = cs.conferirCamadas();
conferir('espelho inexistente não é divergência', r.totalDivergentes === 0, r);

// Registro que já subiu e foi apagado na nuvem por outro aparelho: a
// exclusão é legítima e o espelho já reflete isso. Divergente, sim — mas
// não "em risco", porque não é trabalho local por enviar.
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
store['jr_ocorrencias'] = JSON.stringify([DEV_A]);
r = cs.conferirCamadas();
conferir('registro já confirmado que sumiu do espelho: acusa mas não é risco',
  r.totalDivergentes === 1 && r.totalEmRisco === 0, { d: r.totalDivergentes, risco: r.totalEmRisco });

console.log('\n== Conteúdo diferente entre as cópias ==');
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
store['jr_sac_db'] = JSON.stringify({
  ocorrencias_devolucao: [Object.assign({}, DEV_A, { cliente_nome: 'EDITADO AQUI' }), DEV_B]
});
r = cs.conferirCamadas();
t = r.tabelas.find(x => x.tabela === 'ocorrencias_devolucao');
conferir('acusa edição que o espelho não tem', r.totalDivergentes === 1, r.totalDivergentes);
conferir('nenhuma cópia "falta" — a diferença é de conteúdo',
  t && t.divergentes[0].onde.sacDb !== 'FALTA' && t.divergentes[0].onde.espelho !== 'FALTA',
  t && t.divergentes[0].onde);

console.log('\n== A memória (o que a tela desenha) entra na conta ==');
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
window.db = { data: { ocorrencias_devolucao: [DEV_A] } };   // tela atrasada
r = cs.conferirCamadas();
conferir('tela sem um registro que está salvo: acusa', r.totalDivergentes === 1, r.totalDivergentes);
t = r.tabelas.find(x => x.tabela === 'ocorrencias_devolucao');
conferir('marca a memória como a que falta', t && t.divergentes[0].onde.memoria === 'FALTA', t && t.divergentes[0].onde);
window.db = undefined;

console.log('\n== Rastreio de um registro pelas cinco camadas ==');
zerar();
aparelhoEmDia([DEV_A, DEV_B]);
store['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [DEV_A, DEV_B, DEV_NOVA] });

// Nuvem de mentira: só conhece as duas antigas.
const naNuvem = { 1001: DEV_A, 1002: DEV_B };
global.fetch = async (url) => {
  const m = String(url).match(/id=eq\.(\d+)/);
  const achou = m && naNuvem[m[1]] ? [naNuvem[m[1]]] : [];
  return { ok: true, status: 200, json: async () => achou };
};

(async () => {
  let res = await cs.rastrearRegistro('OLI2E18');
  conferir('acha o registro pela placa', res.achados.length === 1, res.achados.length);
  let a = res.achados[0];
  conferir('rastreia na tabela certa', a && a.tabela === 'ocorrencias_devolucao', a && a.tabela);
  conferir('salvo: presente', a && a.camadas.sacDb.estado === 'presente', a && a.camadas.sacDb);
  conferir('espelho: ausente', a && a.camadas.espelho.estado === 'ausente', a && a.camadas.espelho);
  conferir('mapa de envio: nunca confirmado', a && a.camadas.hashMap.estado === 'nunca confirmado', a && a.camadas.hashMap);
  conferir('nuvem: ausente', a && a.camadas.nuvem.estado === 'ausente', a && a.camadas.nuvem);
  conferir('veredito CRITICO', a && a.veredito.nivel === 'CRITICO', a && a.veredito);

  res = await cs.rastrearRegistro('TVD0F56');
  a = res.achados[0];
  conferir('registro em dia: veredito OK', a && a.veredito.nivel === 'OK', a && a.veredito);

  res = await cs.rastrearRegistro('  oli2e18  ');
  conferir('busca ignora espaços e maiúsculas', res.achados.length === 1, res.achados.length);

  res = await cs.rastrearRegistro('1003');
  conferir('busca pelo id também funciona', res.achados.length === 1, res.achados.length);

  res = await cs.rastrearRegistro('PLACA-QUE-NAO-EXISTE');
  conferir('termo inexistente devolve lista vazia, sem erro', res.achados.length === 0, res.achados);

  res = await cs.rastrearRegistro('   ');
  conferir('termo vazio devolve aviso em vez de varrer tudo', !!res.erro, res);

  console.log('\n== O mapa de tabelas não pode divergir das listas de sync ==');
  conferir('as 25 tabelas estão na lista estática',
    cs.constructor.MAPA_TABELAS.length === 25, cs.constructor.MAPA_TABELAS.length);
  conferir('toda entrada tem tableName, localKey e dbKey',
    cs.constructor.MAPA_TABELAS.every(m => m.tableName && m.localKey && m.dbKey));

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
})();
