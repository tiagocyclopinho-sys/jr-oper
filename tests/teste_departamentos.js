// Testes do cadastro de Departamentos & Papéis de Acesso.
//
// Mesmo harness do teste_cadastros.js: roda js/store.js fora do navegador,
// com um localStorage falso. A parte que vive no app.js (a função
// mapDeptToRoleAndCargo, que passou a consultar o cadastro) é extraída pelo
// nome, como nos outros testes de app.
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
    _mapa: mapa
  };
}

// INITIAL_DATA com a lista ANTIGA de departamentos (strings), que é o estado
// real de qualquer aparelho que já usou o sistema antes desta mudança.
const INITIAL_DATA = {
  usuarios: [{ id: 1, nome: 'ADMIN', email: 'a@a.com', senha_hash: '123', role: 'ADMIN', ativo: true }],
  roles_disponiveis: ['SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'GESTOR', 'ADMIN'],
  departamentos: ['SAC', 'FATURAMENTO', 'GERÊNCIA GERAL', 'SUPERVISÃO', 'COMERCIAL'],
  separadores_conferentes: [], colaboradores_cd: [], setores: [],
  motoristas: [], ajudantes: [], veiculos: [], rotas: [], cargas: [],
  produtos: [], clientes: [], clientes_full: [], motivos_devolucao: [],
  causas_raiz: [], ocorrencias_devolucao: [], itens_devolucao: [], ocorrencias_rota: [],
  relatorios_divergencia: [], auditoria_produtividade: [], controle_viagens: [],
  ocorrencias_viagens: [], motivos_ocorrencia: [], resumo_diario_cd: [], trocas_veiculos: [],
  audit_logs: [], retencoes_frota: [], reentregas: [], registro_versoes: [],
  medidas_disciplinares: [], orientacoes_feedback: [], atestados_medicos: [],
  ausencias_registros: [], sinistros: [], itens_avulsos_destinacao: []
};

function carregarStore(localStorage, dadosIniciais) {
  const codigo = fs.readFileSync(path.join(RAIZ, 'js/store.js'), 'utf8');
  const sandbox = {
    localStorage, console,
    INITIAL_DATA: JSON.parse(JSON.stringify(dadosIniciais || INITIAL_DATA)),
    setTimeout, clearTimeout,
    alert: msg => { throw new Error('alert() inesperado dentro do store: ' + msg); }
  };
  vm.createContext(sandbox);
  vm.runInContext(codigo, sandbox, { filename: 'store.js' });
  return sandbox;
}

// mapDeptToRoleAndCargo real, extraída do app.js e ligada a um `db` de teste.
function carregarMapeamento(db) {
  const app = fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8');
  const i = app.indexOf('function mapDeptToRoleAndCargo(');
  if (i < 0) throw new Error('mapDeptToRoleAndCargo não encontrada em js/app.js');
  const j = app.indexOf('\n}', i);
  const sandbox = { db, console };
  vm.createContext(sandbox);
  vm.runInContext(app.slice(i, j + 2), sandbox);
  return sandbox.mapDeptToRoleAndCargo;
}

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

// ---------------------------------------------------------------
secao('1. O bug: gerência e supervisão eram rebaixadas para SAC');
{
  const { db } = carregarStore(novoLocalStorage());

  // Estes são os nomes que só existiam na lista de "Logins e Senhas" e que
  // a heurística por nome do app não reconhecia — caíam no padrão 'SAC'.
  ok(db.getRoleDoDepartamento('GERÊNCIA GERAL') === 'GESTOR',
     'GERÊNCIA GERAL agora é GESTOR (antes: SAC)', db.getRoleDoDepartamento('GERÊNCIA GERAL'));
  ok(db.getRoleDoDepartamento('GERÊNCIA OPERACIONAL') === 'GESTOR',
     'GERÊNCIA OPERACIONAL agora é GESTOR (antes: SAC)');
  ok(db.getRoleDoDepartamento('SUPERVISÃO') === 'GESTOR',
     'SUPERVISÃO agora é GESTOR (antes: SAC)');

  // Estes já funcionavam e não podem ter mudado.
  ok(db.getRoleDoDepartamento('FATURAMENTO') === 'FINANCEIRO', 'FATURAMENTO continua FINANCEIRO');
  ok(db.getRoleDoDepartamento('SAC') === 'SAC', 'SAC continua SAC');
  ok(db.getRoleDoDepartamento('ANALISTA/BI') === 'ADMIN', 'ANALISTA/BI continua ADMIN');
  ok(db.getRoleDoDepartamento('CENTRO DE DISTRIBUIÇÃO') === 'CD', 'CENTRO DE DISTRIBUIÇÃO continua CD');
  ok(db.getRoleDoDepartamento('SUPERVISOR CD') === 'CD', 'SUPERVISOR CD continua CD (é chão de CD, não gestão)');

  // COMERCIAL e COMPRAS ficam como estão hoje: conceder acesso novo sem
  // alguém decidir seria pior do que manter.
  ok(db.getRoleDoDepartamento('COMERCIAL') === 'SAC', 'COMERCIAL mantém o papel de hoje (SAC)');
  ok(db.getRoleDoDepartamento('COMPRAS') === 'SAC', 'COMPRAS mantém o papel de hoje (SAC)');
}

// ---------------------------------------------------------------
secao('2. Migração: as duas listas antigas viram um cadastro só');
{
  const { db } = carregarStore(novoLocalStorage());
  const deps = db.getDepartamentos();
  const nomes = deps.map(d => d.nome);

  ok(deps.length >= 19, 'a união das duas listas foi semeada', 'total: ' + deps.length);
  ok(nomes.includes('GERENTE GERAL') && nomes.includes('GERÊNCIA GERAL'),
     'os dois nomes concorrentes convivem — nenhum usuário fica órfão');
  ok(nomes.includes('MONTAGEM CARGA') && nomes.includes('MONTAGEM DE CARGA'),
     'idem para MONTAGEM CARGA / MONTAGEM DE CARGA');
  ok(deps.every(d => d.role && d.nome), 'todo departamento tem nome e papel');
  ok(deps.every(d => ['SAC','CD','FINANCEIRO','MANUTENCAO','GESTOR','ADMIN'].includes(d.role)),
     'nenhum papel inválido foi semeado');

  const ordenado = nomes.slice().sort((a, b) => a.localeCompare(b, 'pt-BR'));
  ok(JSON.stringify(nomes) === JSON.stringify(ordenado), 'a lista sai ordenada para a tela');
}

// ---------------------------------------------------------------
secao('3. Migração é idempotente e não atropela o admin');
{
  const ls = novoLocalStorage();
  const { db } = carregarStore(ls);

  // Admin muda o papel de COMERCIAL e desativa COMPRAS.
  db.updateDepartamento('COMERCIAL', { role: 'GESTOR' });
  db.setDepartamentoAtivo('COMPRAS', false);
  const antes = db.getDepartamentos({ incluirInativos: true }).length;

  // Recarrega o app no mesmo aparelho: a migração roda de novo.
  const { db: db2 } = carregarStore(ls);

  ok(db2.getRoleDoDepartamento('COMERCIAL') === 'GESTOR',
     'a mudança do admin sobrevive ao reload (não volta para SAC)', db2.getRoleDoDepartamento('COMERCIAL'));
  ok(db2.getDadosDepartamento('COMPRAS').ativo === false,
     'o departamento desativado não é ressuscitado pela semeadura');
  ok(db2.getDepartamentos({ incluirInativos: true }).length === antes,
     'rodar de novo não duplica nada', `antes ${antes}, depois ${db2.getDepartamentos({incluirInativos:true}).length}`);
}

// ---------------------------------------------------------------
secao('4. CRUD do admin');
{
  const { db } = carregarStore(novoLocalStorage());

  const novo = db.addDepartamento({ nome: 'expedição', role: 'CD', cargo: 'Conferente' });
  ok(novo.success === true, 'cadastra departamento novo', JSON.stringify(novo));
  ok(db.getRoleDoDepartamento('EXPEDIÇÃO') === 'CD', 'nome é normalizado para maiúscula');

  const dup = db.addDepartamento({ nome: 'EXPEDIÇÃO', role: 'SAC' });
  ok(dup.success === false && /já está cadastrado/.test(dup.message),
     'duplicado é recusado com mensagem explícita', dup.message);

  const vazio = db.addDepartamento({ nome: '   ' });
  ok(vazio.success === false, 'nome vazio é recusado');

  // Sem role informado, sugere pelo nome.
  const auto = db.addDepartamento({ nome: 'GERÊNCIA DE FROTA' });
  ok(auto.success === true && auto.item.role === 'GESTOR',
     'sem papel informado, sugere pelo nome', auto.item && auto.item.role);

  const upd = db.updateDepartamento('EXPEDIÇÃO', { role: 'GESTOR', cargo: 'Líder' });
  ok(upd.success === true && db.getRoleDoDepartamento('EXPEDIÇÃO') === 'GESTOR',
     'altera o papel de um departamento');
  ok(db.getDadosDepartamento('EXPEDIÇÃO').cargo === 'Líder', 'altera o cargo sugerido');

  const inexistente = db.updateDepartamento('NÃO EXISTE', { role: 'SAC' });
  ok(inexistente.success === false, 'editar inexistente devolve erro tratado (não estoura)');

  const off = db.setDepartamentoAtivo('EXPEDIÇÃO', false);
  ok(off.success === true, 'desativa departamento sem usuários');
  ok(db.getDepartamentos().every(d => d.nome !== 'EXPEDIÇÃO'), 'desativado sai da lista das telas');
  ok(db.getDepartamentos({ incluirInativos: true }).some(d => d.nome === 'EXPEDIÇÃO'),
     'mas continua no cadastro, para o admin reativar');

  // Recadastrar um desativado reativa em vez de duplicar — senão o envio
  // mandaria a mesma chave primária duas vezes.
  const revive = db.addDepartamento({ nome: 'EXPEDIÇÃO', role: 'CD' });
  ok(revive.success === true && /reativado/.test(revive.message), 'recadastrar reativa', revive.message);
  ok(db.getDepartamentos({ incluirInativos: true }).filter(d => d.nome === 'EXPEDIÇÃO').length === 1,
     'não duplicou a linha');
}

// ---------------------------------------------------------------
secao('5. Não dá para desativar departamento com gente dentro');
{
  const { db } = carregarStore(novoLocalStorage());
  db.data.usuarios.push({ id: 9, nome: 'FULANO', email: 'f@f.com', departamento: 'FATURAMENTO', role: 'FINANCEIRO', ativo: true });

  const res = db.setDepartamentoAtivo('FATURAMENTO', false);
  ok(res.success === false, 'desativação é bloqueada');
  ok(/FULANO/.test(res.message), 'a mensagem diz quem ainda está lá', res.message);
  ok(db.getDadosDepartamento('FATURAMENTO').ativo !== false, 'o departamento continua ativo');

  // Usuário inativo não deve bloquear.
  db.data.usuarios.find(u => u.id === 9).ativo = false;
  const res2 = db.setDepartamentoAtivo('FATURAMENTO', false);
  ok(res2.success === true, 'usuário desativado não bloqueia mais a desativação');
}

// ---------------------------------------------------------------
secao('6. O app consulta o cadastro antes da heurística');
{
  const { db } = carregarStore(novoLocalStorage());
  const mapDeptToRoleAndCargo = carregarMapeamento(db);

  const g = mapDeptToRoleAndCargo('GERÊNCIA GERAL');
  ok(g.role === 'GESTOR', 'GERÊNCIA GERAL resolve para GESTOR pelo cadastro', g.role);
  ok(g.origem === 'cadastro', 'a resposta se identifica como vinda do cadastro', JSON.stringify(g));

  // O admin muda o papel pela tela: o app tem de passar a responder o novo.
  db.updateDepartamento('COMERCIAL', { role: 'GESTOR' });
  ok(mapDeptToRoleAndCargo('COMERCIAL').role === 'GESTOR',
     'mudança feita pelo admin vale imediatamente no app');

  // Departamento digitado à mão no autocadastro (opção "OUTRO") não está no
  // cadastro — aí a heurística por nome continua valendo.
  const outro = mapDeptToRoleAndCargo('MANUTENÇÃO PREDIAL');
  ok(outro.role === 'MANUTENCAO', 'departamento fora do cadastro cai na heurística', outro.role);
  ok(outro.origem !== 'cadastro', 'e não se apresenta como vindo do cadastro');

  ok(mapDeptToRoleAndCargo('').role === 'SAC', 'departamento vazio não quebra');
  ok(mapDeptToRoleAndCargo(null).role === 'SAC', 'departamento nulo não quebra');
}

// ---------------------------------------------------------------
secao('7. O cadastro sincroniza (senão vive num aparelho só)');
{
  const cloud = fs.readFileSync(path.join(RAIZ, 'js/cloudStore.js'), 'utf8');

  const push = cloud.indexOf("{ dbKey: 'departamentos'");
  ok(push > -1, 'departamentos está na lista de ENVIO do cloudStore');

  const pull = cloud.indexOf("{ tableName: 'departamentos'");
  ok(pull > -1, 'departamentos está na lista de LEITURA do cloudStore');

  // A whitelist de colunas precisa levar o `role` — é ele que precisa viajar.
  const trecho = cloud.slice(push, push + 400);
  ok(/colunas:.*'role'/.test(trecho), 'a whitelist de colunas inclui role', trecho.slice(0, 200));
  ok(/colunas:.*'ativo'/.test(trecho), 'a whitelist inclui ativo (é como a exclusão viaja)');

  // usuarios sobe ANTES de departamentos: uma FK entre eles faria o Postgres
  // recusar todo usuário cujo departamento ainda não chegou. Ver migração 22.
  const posUsuarios = cloud.indexOf("{ dbKey: 'usuarios'");
  ok(posUsuarios > -1 && posUsuarios < push,
     'usuarios sobe antes — por isso a migração 26 não cria FK para departamentos');

  const sql = fs.readFileSync(path.join(RAIZ, 'database/migration_26_departamentos.sql'), 'utf8');
  ok(/CREATE TABLE IF NOT EXISTS departamentos/.test(sql), 'a migração 26 cria a tabela');
  ok(/ON CONFLICT \(nome\) DO NOTHING/.test(sql), 'a semeadura é idempotente');
  ok(!/REFERENCES\s+departamentos/.test(sql), 'nenhuma FK aponta para departamentos');
  ok(/departamentos_role_check/.test(sql), 'o papel é validado por CHECK no banco');

  // Todo papel semeado no SQL tem de existir no CHECK e no store.
  const papeisNoSql = [...sql.matchAll(/'(SAC|CD|FINANCEIRO|MANUTENCAO|GESTOR|ADMIN)',\s+'/g)].length;
  ok(papeisNoSql > 0, 'a semeadura do SQL usa papéis válidos');
}

// ---------------------------------------------------------------
secao('8. O SQL e o JavaScript semeiam a mesma coisa');
{
  const { db } = carregarStore(novoLocalStorage());
  const sql = fs.readFileSync(path.join(RAIZ, 'database/migration_26_departamentos.sql'), 'utf8');

  // Extrai os pares (nome, role) do INSERT da migração.
  const bloco = sql.slice(sql.indexOf('INSERT INTO departamentos'), sql.indexOf('ON CONFLICT (nome)'));
  const doSql = [...bloco.matchAll(/\('([^']+)',\s*'([^']+)',/g)].map(m => ({ nome: m[1], role: m[2] }));

  ok(doSql.length >= 19, 'o INSERT do SQL foi lido', 'linhas: ' + doSql.length);

  const divergentes = doSql.filter(l => db.getRoleDoDepartamento(l.nome) !== l.role);
  ok(divergentes.length === 0,
     'todo departamento tem o MESMO papel no SQL e no JavaScript',
     divergentes.map(d => `${d.nome}: sql=${d.role} js=${db.getRoleDoDepartamento(d.nome)}`).join(' | '));

  const soNoJs = db.getDepartamentos().filter(d => !doSql.some(l => l.nome === d.nome));
  ok(soNoJs.length === 0, 'nenhum departamento existe só no JavaScript',
     soNoJs.map(d => d.nome).join(', '));
}

// ---------------------------------------------------------------
secao('9. Base vazia: o primeiro usuário NÃO é promovido a ADMIN');
{
  const { db } = carregarStore(novoLocalStorage(), Object.assign({}, INITIAL_DATA, { usuarios: [] }));
  const mapDeptToRoleAndCargo = carregarMapeamento(db);
  const app = fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8');

  ok(db.data.usuarios.length === 0, 'a base começa sem nenhum usuário');

  // Existiu por algumas horas um "bootstrap" que promovia o primeiro
  // cadastro a ADMIN. Ele resolvia um problema do desenho anterior: o menu
  // escondia a Administração de quem não fosse ADMIN, e quem instalasse o
  // sistema ficava trancado do lado de fora. Com a Administração aberta a
  // todos e protegida por senha, promover no cadastro não resolve nada e
  // ainda daria à pessoa um papel que não é a função real dela.
  ok(app.indexOf('baseVazia') < 0, 'o bootstrap de ADMIN não sobrou no código');

  const r = db.addUsuario({ nome: 'TIAGO', email: 't@jr.com', senha: '1234',
                            role: mapDeptToRoleAndCargo('GERÊNCIA OPERACIONAL').role,
                            departamento: 'GERÊNCIA OPERACIONAL', cargo: 'Gestor Operacional' });
  ok(r.success === true, 'o primeiro usuário é criado sem erro', JSON.stringify(r && r.message));
  ok(r.user.role === 'GESTOR', 'entra com o papel do próprio departamento, não ADMIN', r.user.role);
  ok(r.user.departamento === 'GERÊNCIA OPERACIONAL', 'o departamento é preservado');

  // E mesmo sem papel ADMIN, ele alcança a Administração: o portão é a senha.
  ok(app.indexOf("{ tab: 'gestao_usuarios', icon: '🔐', label: 'Logins e Senhas', papeis: null") > -1,
     'Logins e Senhas está no menu sem filtro de papel');
  const iDesbloqueio = app.indexOf('function desbloquearAreaAdmin()');
  const trechoDesbloqueio = iDesbloqueio > -1 ? app.slice(iDesbloqueio, iDesbloqueio + 600) : '';
  ok(/pwd !== db\.getAdminPassword\(\)/.test(trechoDesbloqueio),
     'e o desbloqueio confere a senha de administrador', trechoDesbloqueio.slice(0, 100));
}

// ---------------------------------------------------------------
console.log('\n=======================================');
console.log(`  ${passes} passaram, ${falhas} falharam`);
console.log('=======================================\n');
process.exit(falhas === 0 ? 0 : 1);
