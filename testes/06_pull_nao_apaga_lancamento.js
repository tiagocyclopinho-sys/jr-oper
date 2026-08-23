// A CORREÇÃO de 23/08/2026 — o pull para de apagar lançamento recém-salvo.
//
// O 05 prova que o DETECTOR enxerga o problema. Este prova que ele deixou de
// acontecer: roda o syncCloudToLocal de verdade, com uma nuvem de mentira, e
// confere que o lançamento sobrevive — sem desfazer nenhuma das garantias
// que as ondas anteriores conquistaram, que é o que realmente importa antes
// de um Reset Global.
const fs = require('fs');
const armazem = {};
global.localStorage = {
  getItem: k => (k in armazem ? armazem[k] : null),
  setItem: (k, v) => { armazem[k] = String(v); },
  removeItem: k => { delete armazem[k]; }
};
global.document = { addEventListener(){}, getElementById(){ return null; } };
global.window = global;
global.JR_CONFIG = { supabase: { url: 'https://exemplo.supabase.co', anonKey: 'x'.repeat(40) } };
global.addEventListener = () => {};
global.alert = () => {};
global.setInterval = () => 0;
global.dispatchEvent = () => true;
global.CustomEvent = function(){};

eval(fs.readFileSync(__dirname + '/../js/cloudStore.js', 'utf8'));
const cs = window.cloudStore;

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}

const DEV_A = { id: 1001, veiculo_placa: 'TVD0F56', cliente_nome: 'X' };
const DEV_B = { id: 1002, veiculo_placa: 'BRA2E19', cliente_nome: 'Y' };
const DEV_NOVA = { id: 1003, veiculo_placa: 'OLI2E18', cliente_nome: 'Z' };
const DEV_DE_OUTRO = { id: 1004, veiculo_placa: 'RSE9G33', cliente_nome: 'W' };

// A nuvem de mentira. Só responde pelas tabelas que o teste povoa; para o
// resto devolve lista vazia, como uma base recém-criada.
let nuvem = {};
let epochNuvem = 0;
function ligarNuvem() {
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') return { ok: true, status: 200, text: async () => '' };
    if (u.includes('/sync_control')) {
      return { ok: true, status: 200, json: async () => (epochNuvem ? [{ reset_epoch: epochNuvem }] : []) };
    }
    const tabela = (u.match(/\/rest\/v1\/([a-z_]+)/) || [])[1];
    const linhas = (nuvem[tabela] || []).slice();
    // O getAll pagina com id=gt.N; o cursor precisa andar, senão ele
    // descarta o resultado como leitura truncada.
    const gt = (u.match(/id=gt\.(\d+)/) || [])[1];
    const filtradas = gt ? linhas.filter(r => Number(r.id) > Number(gt)) : linhas;
    return { ok: true, status: 200, json: async () => filtradas };
  };
}
function zerar() {
  for (const k of Object.keys(armazem)) delete armazem[k];
  cs._mapaSync = null;
  nuvem = {};
  epochNuvem = 0;
  window.db = undefined;
}
// Aparelho logo depois de um pull completo: espelho, fatia operacional e
// memória concordando com a nuvem.
function aparelhoEmDia(devs) {
  nuvem.ocorrencias_devolucao = devs.slice();
  armazem['jr_ocorrencias'] = JSON.stringify(devs);
  armazem['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: devs.slice() });
  armazem['jr_sync_ok_ocorrencias_devolucao'] = String(Date.now());
  cs._mapaSync = null;
  cs._confirmarEnvio('ocorrencias_devolucao', devs);
  window.db = { data: { ocorrencias_devolucao: devs.slice() } };
}
function devsSalvas() {
  return JSON.parse(armazem['jr_sac_db']).ocorrencias_devolucao.map(r => r.id).sort();
}

(async () => {
  ligarNuvem();

  console.log('\n== O caso do OLI2E18: pull rodando antes do envio ==');
  //
  // ATENÇÃO para quem for mexer neste teste: o lançamento só é destruído se a
  // mesclagem daquela tabela mudar alguma coisa — ou seja, se OUTRO aparelho
  // tiver mandado algo na mesma tabela nesse meio tempo. Sem isso o resultado
  // da mesclagem é igual ao espelho, nada é gravado por cima, e o registro
  // sobrevive por acidente até no código antigo. Tirar o DEV_DE_OUTRO daqui
  // faz o teste passar sem provar nada.
  //
  // É por isso que o sintoma relatado em 23/08/2026 tem essa forma exata:
  // "os outros lançamentos vieram, no celular e no notebook, e só o OLI2E18
  // não". Os outros chegando É a condição que apaga o daqui.
  zerar();
  aparelhoEmDia([DEV_A, DEV_B]);
  // db.save(): grava a memória e jr_sac_db. O espelho NÃO é tocado — é
  // exatamente essa a assimetria que derrubava o registro.
  window.db.data.ocorrencias_devolucao.push(DEV_NOVA);
  armazem['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: window.db.data.ocorrencias_devolucao.slice() });
  // e, no mesmo intervalo, outro aparelho lançou a devolução dele
  nuvem.ocorrencias_devolucao = [DEV_A, DEV_B, DEV_DE_OUTRO];

  await cs.syncCloudToLocal();

  conferir('o lançamento do outro aparelho chega', devsSalvas().includes(1004), devsSalvas());
  conferir('e o lançamento daqui NÃO é apagado por ele',
    devsSalvas().join() === '1001,1002,1003,1004', devsSalvas());
  conferir('e continua na memória, para a tela desenhar',
    window.db.data.ocorrencias_devolucao.some(r => r.id === 1003),
    window.db.data.ocorrencias_devolucao.map(r => r.id));
  conferir('o espelho fica em dia depois do pull, em vez de continuar atrás',
    JSON.parse(armazem['jr_ocorrencias']).some(r => r.id === 1003),
    JSON.parse(armazem['jr_ocorrencias']).map(r => r.id));
  conferir('e ele segue pendente de envio, não marcado como confirmado',
    cs._separarOQueMudou('ocorrencias_devolucao', [DEV_NOVA]).length === 1);

  console.log('\n== Sem window.db (aparelho carregando): cai em jr_sac_db ==');
  zerar();
  aparelhoEmDia([DEV_A, DEV_B]);
  window.db = undefined;
  armazem['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [DEV_A, DEV_B, DEV_NOVA] });
  await cs.syncCloudToLocal();
  conferir('o lançamento sobrevive mesmo sem a memória', devsSalvas().join() === '1001,1002,1003', devsSalvas());

  console.log('\n== O que a correção NÃO pode ter desfeito ==');

  // Garantia da onda anterior: exclusão feita em outro aparelho tem que
  // entrar, e não pode ser ressuscitada por este.
  zerar();
  aparelhoEmDia([DEV_A, DEV_B]);
  nuvem.ocorrencias_devolucao = [DEV_A];              // alguém apagou a B
  await cs.syncCloudToLocal();
  conferir('exclusão feita em outro aparelho entra', devsSalvas().join() === '1001', devsSalvas());
  await cs.syncCloudToLocal();
  conferir('e não volta no ciclo seguinte', devsSalvas().join() === '1001', devsSalvas());

  // A garantia mais importante antes do Reset Global de verdade: um Reset
  // feito em OUTRO aparelho não pode ser desfeito por este.
  zerar();
  aparelhoEmDia([DEV_A, DEV_B]);
  nuvem.ocorrencias_devolucao = [];                   // Reset Global na nuvem
  epochNuvem = Date.now();
  await cs.syncCloudToLocal();
  conferir('Reset Global remoto zera este aparelho', devsSalvas().length === 0, devsSalvas());
  conferir('e o carimbo do reset fica gravado aqui',
    Number(armazem['jr_reset_epoch']) === epochNuvem, armazem['jr_reset_epoch']);
  await cs.syncCloudToLocal();
  conferir('e nada ressuscita no ciclo seguinte', devsSalvas().length === 0, devsSalvas());

  // Nuvem vazia SEM reset e com tabela que nunca subiu: o dado local é a
  // verdade e tem que ser preservado (senão toda falha de push vira perda).
  zerar();
  armazem['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [DEV_A, DEV_B] });
  window.db = { data: { ocorrencias_devolucao: [DEV_A, DEV_B] } };
  nuvem.ocorrencias_devolucao = [];
  await cs.syncCloudToLocal();
  conferir('nuvem vazia sem reset não apaga o que nunca subiu', devsSalvas().join() === '1001,1002', devsSalvas());
  conferir('e a tabela entra na fila de reenvio',
    cs.getDiagnostico().tabelasComPendencia.includes('ocorrencias_devolucao'),
    cs.getDiagnostico().tabelasComPendencia);

  // Edição local não enviada continua vencendo a versão da nuvem.
  zerar();
  aparelhoEmDia([DEV_A, DEV_B]);
  const editada = Object.assign({}, DEV_A, { cliente_nome: 'EDITADO AQUI' });
  window.db.data.ocorrencias_devolucao = [editada, DEV_B];
  armazem['jr_sac_db'] = JSON.stringify({ ocorrencias_devolucao: [editada, DEV_B] });
  await cs.syncCloudToLocal();
  const depois = JSON.parse(armazem['jr_sac_db']).ocorrencias_devolucao.find(r => r.id === 1001);
  conferir('edição local ainda não enviada sobrevive ao pull',
    depois && depois.cliente_nome === 'EDITADO AQUI', depois);

  console.log('\n== O contador de fantasmas conta o que o aparelho tem ==');
  zerar();
  const FANTASMA = { id: 9001, carga: 'PALMAS 02/07', data_saida: 'INICIADO' };
  const BOA = { id: 9002, carga: 'PALMAS 03/07', data_saida: '2026-08-01' };
  // Fantasma na fatia operacional, espelho limpo: antes o contador dizia
  // "limpo" e a máquina era liberada para operar.
  armazem['jr_controle_viagens'] = JSON.stringify([BOA]);
  armazem['jr_sac_db'] = JSON.stringify({ controle_viagens: [BOA, FANTASMA] });
  window.db = { data: { controle_viagens: [BOA, FANTASMA] } };
  cs._auditarCacheLocal();
  let d = cs.getDiagnostico().bloqueadosNaEscrita;
  conferir('acha o fantasma que só está na fatia operacional', d && d.total === 1, d);

  // E o contrário: espelho com fantasma que o aparelho já não tem mais.
  zerar();
  armazem['jr_controle_viagens'] = JSON.stringify([BOA, FANTASMA]);
  armazem['jr_sac_db'] = JSON.stringify({ controle_viagens: [BOA] });
  window.db = { data: { controle_viagens: [BOA] } };
  cs._auditarCacheLocal();
  d = cs.getDiagnostico().bloqueadosNaEscrita;
  conferir('não acusa fantasma que sobrou só no espelho', d === null, d);

  console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
})();
