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

function carregarStore(localStorage) {
  const codigo = fs.readFileSync(path.join(RAIZ, 'js/store.js'), 'utf8');
  const sandbox = {
    localStorage,
    console,
    INITIAL_DATA: JSON.parse(JSON.stringify(INITIAL_DATA)),
    setTimeout, clearTimeout,
    alert: msg => { throw new Error('alert() inesperado dentro do store: ' + msg); }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'store.js' });
  return sandbox;
}

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------
secao('1. Motivo de devolução (o bug relatado)');
{
  const ls = novoLocalStorage();
  const { db } = carregarStore(ls);

  const r = db.addMotivoDevolucao('NOTA DENEGADA');
  ok(r && r.success === true, 'addMotivoDevolucao devolve {success:true}', JSON.stringify(r));
  ok(typeof r.message === 'string' && r.message.length > 0, 'traz mensagem legível (não undefined)', JSON.stringify(r));
  ok(db.data.motivos_devolucao.includes('NOTA DENEGADA'), 'motivo entrou na lista');

  const dup = db.addMotivoDevolucao('nota denegada');
  ok(dup.success === false, 'duplicado (case-insensitive) é recusado');
  ok(/já está cadastrado/.test(dup.message), 'mensagem de duplicado é explícita', dup.message);

  const vazio = db.addMotivoDevolucao('   ');
  ok(vazio.success === false && !!vazio.message, 'vazio é recusado com mensagem');

  const del = db.deleteMotivoDevolucao('NOTA DENEGADA');
  ok(del && del.success === true, 'deleteMotivoDevolucao devolve {success:true} (antes: TypeError)', JSON.stringify(del));
  ok(!db.data.motivos_devolucao.includes('NOTA DENEGADA'), 'motivo saiu da lista');
  ok(db.data.motivos_devolucao_inativos.includes('NOTA DENEGADA'), 'lápide criada para propagar a exclusão');

  const delInexistente = db.deleteMotivoDevolucao('NAO EXISTE');
  ok(delInexistente.success === false, 'excluir inexistente devolve erro tratado');

  const readd = db.addMotivoDevolucao('NOTA DENEGADA');
  ok(readd.success === true, 're-cadastro após exclusão é aceito');
  ok(!db.data.motivos_devolucao_inativos.includes('NOTA DENEGADA'), 'lápide removida no re-cadastro');
}

// ---------------------------------------------------------------
secao('2. Persistência: motivo sobrevive ao F5');
{
  const ls = novoLocalStorage();
  const s1 = carregarStore(ls);
  s1.db.addMotivoDevolucao('NOTA DENEGADA');

  const s2 = carregarStore(ls); // simula recarregar a página
  ok(s2.db.data.motivos_devolucao.includes('NOTA DENEGADA'), 'motivo persiste após reload');
}

// ---------------------------------------------------------------
secao('3. Produtos e clientes (o bug silencioso: sumiam no F5)');
{
  const ls = novoLocalStorage();
  const s1 = carregarStore(ls);

  const rp = s1.db.addProduto('9001', 'QUEIJO MUSSARELA', 'Frios', 0);
  ok(rp.success === true, 'addProduto devolve {success:true}', JSON.stringify(rp));

  const rc = s1.db.addCliente({ codigo: '9001', nome: 'PADARIA DO ZE', cidade: 'Araguaína' });
  ok(rc.success === true, 'addCliente devolve {success:true}', JSON.stringify(rc));
  ok(rc.item && rc.item.razao_social === 'PADARIA DO ZE', 'cliente gravado com razao_social (coluna real)');

  const estatico = JSON.parse(ls.getItem('jr_sac_static'));
  ok(estatico.produtos.some(p => p.codigo_produto === '9001'), 'produto foi gravado em jr_sac_static');
  ok(estatico.clientes.some(c => c.razao_social === 'PADARIA DO ZE'), 'cliente foi gravado em jr_sac_static');

  const operacional = JSON.parse(ls.getItem('jr_sac_db'));
  ok(!('clientes' in operacional) && !('produtos' in operacional),
     'catálogo pesado continua FORA da fatia operacional (não estoura a cota)');

  const s2 = carregarStore(ls); // F5
  ok(s2.db.data.produtos.some(p => p.codigo_produto === '9001'), 'produto sobrevive ao reload');
  ok(s2.db.data.clientes.some(c => c.razao_social === 'PADARIA DO ZE'), 'cliente sobrevive ao reload');

  const dupProd = s2.db.addProduto('9001', 'OUTRO NOME', 'Frios', 0);
  ok(dupProd.success === false, 'código de produto duplicado é recusado antes de ir ao banco');
  const dupCli = s2.db.addCliente({ codigo: '9001', nome: 'OUTRA EMPRESA' });
  ok(dupCli.success === false, 'código de cliente duplicado é recusado antes de ir ao banco');
}

// ---------------------------------------------------------------
secao('4. Exclusão de cliente não ressuscita o catálogo da planilha');
{
  const ls = novoLocalStorage();
  const s1 = carregarStore(ls);
  s1.db.addCliente({ codigo: '9001', nome: 'PADARIA DO ZE' });
  const alvo = s1.db.data.clientes.find(c => c.razao_social === 'MERCADO X');
  ok(s1.db.softDelete('clientes', alvo.id) === true, 'softDelete do cliente retorna true');

  const s2 = carregarStore(ls); // F5 — aqui o catálogo era trocado pela planilha
  const mercado = s2.db.data.clientes.find(c => c.razao_social === 'MERCADO X');
  ok(mercado && mercado.is_deleted === true, 'exclusão do cliente sobrevive ao reload');
  ok(s2.db.data.clientes.some(c => c.razao_social === 'PADARIA DO ZE'),
     'cliente cadastrado manualmente NÃO foi apagado pela re-semeadura');
}

// ---------------------------------------------------------------
secao('5. Rotas');
{
  const ls = novoLocalStorage();
  const { db } = carregarStore(ls);
  const r = db.addRota('rota nova');
  ok(r.success === true, 'addRota devolve {success:true}');
  ok(db.data.rotas.includes('ROTA NOVA'), 'rota gravada em maiúsculas');
  const dup = db.addRota('ROTA NOVA');
  ok(dup.success === false && !!dup.message, 'rota duplicada recusada SEM alert() dentro do store');
  const del = db.deleteRota('ROTA NOVA');
  ok(del.success === true, 'deleteRota devolve {success:true}');
  ok(db.data.rotas_inativos.includes('ROTA NOVA'), 'lápide de rota criada');
}

// ---------------------------------------------------------------
secao('6. Motorista / ajudante / veículo — sem alert() dentro do store');
{
  const ls = novoLocalStorage();
  const { db } = carregarStore(ls);

  const m = db.addMotorista('501', 'JOAO DA SILVA', 'ABC123', '', '', '');
  ok(m.success === true, 'addMotorista devolve {success:true}');
  const mDup = db.addMotorista('501', 'OUTRO NOME', 'XYZ999', '', '', '');
  ok(mDup.success === false && /ERP/.test(mDup.message), 'ERP duplicado devolve erro (antes: alert + null)');
  const mCnh = db.addMotorista('502', 'MARIA', 'ABC123', '', '', '');
  ok(mCnh.success === false && /CNH/.test(mCnh.message), 'CNH duplicada devolve erro (antes: alert + null)');

  const a = db.addAjudante('601', 'PEDRO');
  ok(a.success === true, 'addAjudante devolve {success:true}');

  const v = db.addVeiculo('ABC1D23', 'TRUCK', 'Ativo');
  ok(v.success === true, 'addVeiculo devolve {success:true}');
  const vDup = db.addVeiculo('abc1d23', 'TRUCK', 'Ativo');
  ok(vDup.success === false, 'placa duplicada recusada antes de virar 23505 no banco');
}


// ---------------------------------------------------------------
secao('7. Lista esvaziada não ressuscita motivos excluídos');
{
  const ls = novoLocalStorage();
  const s1 = carregarStore(ls);
  s1.db.data.motivos_devolucao.slice().forEach(m => s1.db.deleteMotivoDevolucao(m));
  s1.db.addMotivoDevolucao('Outros');
  s1.db.deleteMotivoDevolucao('OUTROS'); // o store normaliza para maiúsculas ao cadastrar
  ok(s1.db.data.motivos_devolucao.length === 0, 'lista ficou vazia após excluir tudo');

  const s2 = carregarStore(ls); // F5 — dispara a re-semeadura de emergência
  ok(!s2.db.data.motivos_devolucao.includes('Outros'),
     'motivo excluído NÃO voltou pela re-semeadura', JSON.stringify(s2.db.data.motivos_devolucao));
  ok(s2.db.data.motivos_devolucao.length > 0, 'os demais padrões foram repostos (lista não fica vazia)');
}

// ---------------------------------------------------------------
console.log('\n=======================================');
console.log(`  ${passes} passaram, ${falhas} falharam`);
console.log('=======================================');
process.exit(falhas ? 1 : 0);
