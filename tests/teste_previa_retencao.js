// Harness de teste dos cadastros mestres — roda store.js fora do navegador.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

function novoLocalStorage() {
  const mapa = new Map();
  return {
    getItem: k => (mapa.has(k) ? mapa.get(k) : null),
    setItem: (k, v) => mapa.set(k, String(v)),
    removeItem: k => mapa.delete(k),
    get length() { return mapa.size; },
    key: i => [...mapa.keys()][i],
    _mapa: mapa,
    _chaves: () => [...mapa.keys()]
  };
}

const INITIAL_DATA = {
  usuarios: [{ id: 1, nome: 'ADMIN', email: 'a@a.com', senha_hash: '123', role: 'ADMIN', ativo: true }],
  roles_disponiveis: ['ADMIN'],
  departamentos: [], separadores_conferentes: [], colaboradores_cd: [], setores: [],
  motoristas: [], ajudantes: [], veiculos: [],
  rotas: ['ROTA A', 'ROTA B'],
  cargas: [],
  produtos: [
    { id: 567, codigo_produto: '567', descricao: 'ASA DE FRANGO', categoria: 'Frios', valor_unitario_padrao: 0 },
    { id: 568, codigo_produto: '568', descricao: 'FILE DE PEITO', categoria: 'Frios', valor_unitario_padrao: 0 }
  ],
  clientes: [
    { id: '1', codigo: '1', codigo_cliente: '1', nome: 'CONSUMIDOR FINAL', razao_social: 'CONSUMIDOR FINAL', cidade: 'Araguaína', uf: 'TO' },
    { id: '2', codigo: '2', codigo_cliente: '2', nome: 'MERCADO X', razao_social: 'MERCADO X', cidade: 'Palmas', uf: 'TO' }
  ],
  clientes_full: [],
  motivos_devolucao: ['AVARIA', 'PRODUTO VENCIDO'],
  causas_raiz: [], ocorrencias_devolucao: [], itens_devolucao: [], ocorrencias_rota: [],
  relatorios_divergencia: [], auditoria_produtividade: [], controle_viagens: [],
  ocorrencias_viagens: [], motivos_ocorrencia: [], resumo_diario_cd: [], trocas_veiculos: [],
  audit_logs: [], retencoes_frota: [], reentregas: [], registro_versoes: [],
  medidas_disciplinares: [], orientacoes_feedback: [], atestados_medicos: [],
  ausencias_registros: [], sinistros: [], itens_avulsos_destinacao: []
};

INITIAL_DATA.veiculos = [{ id: 7, placa: 'TVD0F56', tipo: 'TOCO', situacao: 'Ativo' }];

function carregarStore(localStorage) {
  const codigo = fs.readFileSync(path.join(RAIZ, 'js/store.js'), 'utf8');
  const sandbox = { agoraIsoBrasilia: () => '2026-11-09T14:30:00', hojeIsoBrasilia: () => '2026-11-09', localStorage, console, INITIAL_DATA: JSON.parse(JSON.stringify(INITIAL_DATA)), setTimeout, clearTimeout,
    alert: msg => { throw new Error('alert() inesperado: ' + msg); } };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'store.js' });
  return sandbox;
}
let falhas = 0;
const ok = (c, t, d) => { console.log((c ? '  PASS  ' : '  FALHA ') + t + (c || !d ? '' : '\n        -> ' + d)); if (!c) falhas++; };

const { db } = carregarStore(novoLocalStorage());
const rota = db.addOcorrenciaRota({ veiculo_id: 7, veiculo_placa: 'tvd0f56', motivo_resumido: 'PNEU FURADO',
  descricao: 'estourou na BR', localizacao: 'KM 120' });
const p = db.criarPreviaRetencaoDaOcorrenciaRota(rota);
ok(p.success && p.retencao.status === 'A_VALIDAR', 'prévia nasce A_VALIDAR', JSON.stringify(p));
ok(p.retencao.ocorrencia_rota_id == rota.id, 'guarda o vínculo com a ocorrência');
ok(p.retencao.placa === 'TVD0F56' && p.retencao.tipo_veiculo === 'TOCO', 'placa e tipo vêm do cadastro');
ok(p.retencao.tipo_os === '' && p.retencao.data_previsao === null && !p.retencao.link_os, 'campos da OS ficam para a oficina');
ok(p.retencao.local === 'KM 120' && /PNEU FURADO - ESTOUROU NA BR/.test(p.retencao.motivo), 'motivo e local da ocorrência', p.retencao.motivo);
ok(db.criarPreviaRetencaoDaOcorrenciaRota(rota).jaExistia === true && db.getPreviasRetencaoFrota().length === 1, 'não duplica');
ok(db.getRetencoesFrota().length === 0, 'prévia fora das telas e KPIs');
ok(db.validarPreviaRetencaoFrota(p.retencao.id, { tipo_os: '' }).success === false, 'validar exige tipo de OS');
const v = db.validarPreviaRetencaoFrota(p.retencao.id, { tipo_os: 'PNEUS', data_previsao: '2026-11-10' });
ok(v.success && v.retencao.status === 'RETIDO' && v.retencao.tipo_os === 'PNEUS', 'validada vira RETIDO', JSON.stringify(v));
ok(db.getRetencoesFrota().length === 1 && db.getPreviasRetencaoFrota().length === 0, 'passa a contar como retida');
ok(db.descartarPreviaRetencaoFrota(p.retencao.id).success === false, 'não descarta o que já foi validado');

const rota2 = db.addOcorrenciaRota({ veiculo_placa: 'TVD0F56', motivo_resumido: 'ELETRICA', localizacao: 'X' });
const p2 = db.criarPreviaRetencaoDaOcorrenciaRota(rota2);
const d = db.descartarPreviaRetencaoFrota(p2.retencao.id);
ok(d.success && d.retencao.status === 'DESCARTADO', 'descartada vira DESCARTADO');
ok(db.getRetencoesFrota().length === 1 && db.getPreviasRetencaoFrota().length === 0, 'descartada some de tudo');
ok(p2.retencao.numero_retencao !== p.retencao.numero_retencao, 'número de retenção sequencial', p2.retencao.numero_retencao);
const semPlaca = db.criarPreviaRetencaoDaOcorrenciaRota({ id: 999, veiculo_placa: '' });
ok(semPlaca.success === false, 'sem placa não cria prévia');

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
process.exit(falhas ? 1 : 0);
