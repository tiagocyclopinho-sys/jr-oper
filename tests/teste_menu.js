// Testes do menu de navegação agrupado e do filtro por papel.
//
// Mesmo harness dos outros testes: js/app.js toca no DOM durante a carga e
// não dá para carregá-lo inteiro no Node, então extraímos os blocos reais
// pelo nome. Se alguém renomear ou apagar um deles, a extração falha e o
// teste acusa — é de propósito.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ORIGEM = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function extrair(marcadorInicio, marcadorFim) {
  const i = ORIGEM.indexOf(marcadorInicio);
  if (i < 0) throw new Error(`Não encontrei "${marcadorInicio}" em js/app.js — o bloco foi renomeado ou removido?`);
  const j = ORIGEM.indexOf(marcadorFim, i);
  if (j < 0) throw new Error(`Não encontrei o fim "${marcadorFim}" a partir de "${marcadorInicio}".`);
  return ORIGEM.slice(i, j + marcadorFim.length);
}

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext([
  extrair('const NAV_FILTRO_POR_PAPEL = ', ';'),
  extrair('const NAV_GRUPOS = [', '\n];'),
  extrair('function mapDeptToRoleAndCargo(', '\n}'),
  extrair('function navPapelDoUsuario(', '\n}'),
  extrair('function navItemVisivel(', '\n}'),
  'this.NAV_GRUPOS = NAV_GRUPOS;',
  'this.NAV_FILTRO_POR_PAPEL = NAV_FILTRO_POR_PAPEL;'
].join('\n\n'), sandbox);

const { NAV_GRUPOS, NAV_FILTRO_POR_PAPEL, navPapelDoUsuario, navItemVisivel } = sandbox;

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

const PAPEIS = ['SAC', 'CD', 'FINANCEIRO', 'MANUTENCAO', 'GESTOR', 'ADMIN'];
const todosItens = NAV_GRUPOS.reduce((acc, g) => acc.concat(g.itens), []);
function visiveisPara(papel) {
  sandbox.window._navVerTudo = false;
  return todosItens.filter(i => navItemVisivel(i, papel));
}

// ---------------------------------------------------------------
secao('1. Integridade do mapa de navegação');
{
  ok(NAV_GRUPOS.length === 6, 'os 6 grupos existem', 'grupos: ' + NAV_GRUPOS.length);

  const ids = NAV_GRUPOS.map(g => g.id);
  ok(new Set(ids).size === ids.length, 'nenhum id de grupo repetido', ids.join(','));

  const tabs = todosItens.map(i => i.tab);
  ok(new Set(tabs).size === tabs.length, 'nenhuma tela aparece em dois grupos', tabs.join(','));

  // Toda tela do menu precisa ter um `case` correspondente no renderApp(),
  // senão o clique cai no default e abre o Dashboard silenciosamente.
  const semCase = tabs.filter(t => ORIGEM.indexOf(`case '${t}':`) < 0);
  ok(semCase.length === 0, 'toda tela do menu tem um case no renderApp()', 'sem case: ' + semCase.join(', '));

  ok(todosItens.every(i => i.icon && i.label), 'todo item tem ícone e rótulo');
}

// ---------------------------------------------------------------
secao('2. Nenhuma tela ficou órfã (o bug que motivou a mudança)');
{
  // Dossiê do Motorista e Acompanhamento do Funcionário existiam, estavam
  // completos e não tinham NENHUMA entrada no menu antigo: só dava para
  // chegar neles por um link interno.
  const tabs = todosItens.map(i => i.tab);
  ok(tabs.indexOf('dossie_motorista') > -1, 'Dossiê do Motorista está no menu');
  ok(tabs.indexOf('acompanhamento_funcionario') > -1, 'Acompanhamento do Funcionário está no menu');

  // As 14 telas do menu antigo continuam todas presentes — reorganizar não
  // pode ter derrubado nenhuma pelo caminho.
  const MENU_ANTIGO = ['dashboard', 'sac_abertura', 'sac_investigacao', 'gestao_gestor',
    'cd_recepcao', 'controle_viagens', 'disponibilidade_frota', 'resumo_diario_cd',
    'boletim_gerencial', 'cadastros_dados', 'lixeira', 'gestao_usuarios', 'sinistros', 'power_bi'];
  const sumiram = MENU_ANTIGO.filter(t => tabs.indexOf(t) < 0);
  ok(sumiram.length === 0, 'as 14 telas do menu antigo continuam todas no menu', 'sumiram: ' + sumiram.join(', '));
}

// ---------------------------------------------------------------
secao('3. Sub-abas de Controle de Viagens deixaram de ser invisíveis');
{
  const viagens = todosItens.find(i => i.tab === 'controle_viagens');
  ok(!!viagens.sub && viagens.sub.length === 5, 'Controle de Viagens declara as 5 sub-abas',
     viagens.sub ? String(viagens.sub.length) : 'nenhuma');

  // Os valores precisam bater com os que switchViagensSubTab() usa de fato,
  // senão o atalho abre a tela na sub-aba errada.
  const esperados = ['largada', 'operacional', 'frota_rota', 'troca_veiculos', 'reentregas'];
  const declarados = viagens.sub.map(s => s.valor);
  const faltando = esperados.filter(v => declarados.indexOf(v) < 0);
  ok(faltando.length === 0, 'os valores das sub-abas batem com os do switchViagensSubTab()',
     'faltando: ' + faltando.join(', '));

  const semHandler = declarados.filter(v => ORIGEM.indexOf(`switchViagensSubTab('${v}')`) < 0);
  ok(semHandler.length === 0, 'toda sub-aba declarada existe na tela de Controle de Viagens',
     'sem handler: ' + semHandler.join(', '));
}

// ---------------------------------------------------------------
secao('3b. A setinha do grupo não pode fechar a gaveta (bug de 23/08)');
{
  // Sintoma relatado: clicar na setinha que abre/fecha um grupo fechava o
  // menu inteiro.
  //
  // Causa: toggleNavGrupo() chama renderNavMenu(), que reconstrói o
  // innerHTML do menu — dentro do onclick, ou seja, ANTES de o clique
  // terminar de subir até o listener de "clicar fora". Quando ele chega lá,
  // o botão clicado já não existe, e menu.contains(alvo) responde `false`
  // para um nó solto: o clique de dentro vira clique de fora.
  const i = ORIGEM.indexOf("// Fechar menu ao clicar fora ou no overlay");
  const listener = i > -1 ? ORIGEM.slice(i, i + 1800) : '';

  ok(listener.length > 0, 'o listener de clique-fora foi localizado');

  // Duas formas corretas de perguntar "esse nó ainda está no documento?":
  // `!document.contains(e.target)` e `e.target.isConnected === false`. O que
  // importa é a pergunta ser feita e o listener desistir — não qual idioma
  // foi escolhido. Testar a string exata reprovava a correção de 25/08, que
  // usa isConnected.
  const REGEX_GUARDA = /(!document\.contains\(e\.target\)|e\.target\.isConnected === false)/;
  ok(REGEX_GUARDA.test(listener),
     'o listener ignora clique cujo alvo já saiu do documento');

  // A guarda tem que vir ANTES da decisão de fechar, senão não serve.
  const casada = listener.match(REGEX_GUARDA);
  const posGuarda = casada ? listener.indexOf(casada[0]) : -1;
  const posFechar = listener.indexOf('toggleMobileMenu(false)');
  ok(posGuarda > -1 && posFechar > -1 && posGuarda < posFechar,
     'a guarda vem antes do fechamento');

  // E precisa mesmo desistir, não só perguntar.
  const trechoGuarda = posGuarda > -1 ? listener.slice(posGuarda, posGuarda + 60) : '';
  ok(/return;/.test(trechoGuarda), 'a guarda faz o listener desistir do clique', trechoGuarda);

  // O grupo da tela ativa NÃO pode ser forçado a ficar aberto a cada render:
  // isso deixava a setinha dele sem efeito visível, e setinha que não
  // responde parece defeito. A abertura automática acontece só na TROCA de
  // tela, para o item ativo não ficar escondido.
  const j = ORIGEM.indexOf('const aberto = !!window._navGruposAbertos[grupo.id]');
  const linhaAberto = j > -1 ? ORIGEM.slice(j, ORIGEM.indexOf('\n', j)) : '';
  ok(j > -1, 'a decisão de expandir o grupo foi localizada');
  ok(linhaAberto.indexOf('grupoDaTelaAtiva') < 0,
     'o grupo da tela ativa não é forçado aberto a cada render', linhaAberto);
  ok(/_navUltimaTabRenderizada !== activeTab/.test(ORIGEM),
     'a abertura automática só dispara quando a tela muda');
}

// ---------------------------------------------------------------
secao('4. Papel do usuário: role gravado é a autoridade');
{
  ok(navPapelDoUsuario({ role: 'CD', departamento: 'SAC' }) === 'CD',
     'o role gravado vence o departamento');
  ok(navPapelDoUsuario({ role: 'chefao', departamento: 'XPTO' }) === null,
     'role inválido não é aceito — cai no "não sei"');
  ok(navPapelDoUsuario({ departamento: 'FATURAMENTO' }) === 'FINANCEIRO',
     'sem role, deriva o papel do departamento');
  ok(navPapelDoUsuario({ departamento: 'ANALISTA/BI' }) === 'ADMIN',
     'ANALISTA/BI deriva para ADMIN');
  ok(navPapelDoUsuario({}) === null, 'usuário sem role e sem departamento não tem papel');
  ok(navPapelDoUsuario(null) === null, 'usuário nulo não quebra');
}

// ---------------------------------------------------------------
secao('5. As duas listas de departamento não coincidem — e o menu falha aberto');
{
  // DEPARTAMENTOS_PADRAO (autocadastro) usa "GERENTE GERAL"; a lista de
  // db.data.departamentos (tela Logins e Senhas) usa "GERÊNCIA GERAL", que
  // mapDeptToRoleAndCargo() não reconhece e mandaria para o padrão 'SAC'.
  // Enquanto isso não for unificado, esses casos precisam ver o menu
  // INTEIRO — a gerência não pode perder tela por causa de cadastro.
  const naoReconhecidos = ['GERÊNCIA GERAL', 'GERÊNCIA OPERACIONAL', 'SUPERVISÃO', 'COMERCIAL', 'COMPRAS'];
  naoReconhecidos.forEach(dep => {
    const papel = navPapelDoUsuario({ departamento: dep });
    ok(papel === null, `"${dep}" não é forçado a SAC`, 'papel: ' + papel);
    ok(visiveisPara(papel).length === todosItens.length,
       `"${dep}" vê o menu inteiro em vez do menu errado`);
  });

  ok(navPapelDoUsuario({ departamento: 'SAC' }) === 'SAC',
     'quem é do SAC de verdade continua sendo SAC');
}

// ---------------------------------------------------------------
secao('6. Combinado de 26/08: todo mundo vê todas as telas');
{
  // Enquanto não existir a tela de Admin para liberar acesso por usuário, o
  // filtro por papel fica desligado. Ele foi ligado sem essa tela em 23/08 e
  // o SAC passou a abrir o menu com 8 itens a menos, sem ter onde pedir
  // acesso.
  ok(NAV_FILTRO_POR_PAPEL === false,
     'o filtro por papel está desligado', 'valor: ' + NAV_FILTRO_POR_PAPEL);

  PAPEIS.concat([null]).forEach(p => {
    const vis = visiveisPara(p);
    ok(vis.length === todosItens.length,
       `${p || 'sem papel'} vê as ${todosItens.length} telas`, 'viu: ' + vis.length);
  });

  // O caso que motivou a mudança, dito com todas as letras.
  const tabsSac = visiveisPara('SAC').map(i => i.tab);
  const ANTES_OCULTAS_DO_SAC = ['boletim_gerencial', 'gestao_gestor', 'cd_recepcao',
    'resumo_diario_cd', 'disponibilidade_frota', 'sinistros', 'dossie_motorista',
    'acompanhamento_funcionario'];
  const faltamNoSac = ANTES_OCULTAS_DO_SAC.filter(t => tabsSac.indexOf(t) < 0);
  ok(faltamNoSac.length === 0, 'o SAC enxerga as abas que o filtro escondia dele',
     'faltou: ' + faltamNoSac.join(', '));
}

// ---------------------------------------------------------------
secao('6a. Os papéis declarados seguem válidos para a futura tela de Admin');
{
  // O filtro está desligado, mas os `papeis` de cada item continuam sendo a
  // matéria-prima da tela de Admin que ainda vai existir: se apodrecerem
  // agora, ela nasce com o padrão errado. Aqui olhamos o METADADO, não a
  // visibilidade — por isso não passa por navItemVisivel().
  const invalidos = todosItens.filter(i => i.papeis !== null &&
    (!Array.isArray(i.papeis) || i.papeis.some(x => PAPEIS.indexOf(x) < 0)));
  ok(invalidos.length === 0, 'todo item declara papeis null ou uma lista de papéis conhecidos',
     invalidos.map(i => i.tab).join(', '));

  const deve = {
    SAC: ['sac_abertura', 'sac_investigacao'],
    CD: ['cd_recepcao', 'resumo_diario_cd'],
    MANUTENCAO: ['disponibilidade_frota', 'sinistros'],
    FINANCEIRO: ['boletim_gerencial', 'gestao_gestor'],
    GESTOR: ['dossie_motorista', 'acompanhamento_funcionario', 'boletim_gerencial']
  };
  Object.keys(deve).forEach(p => {
    const faltou = deve[p].filter(t => {
      const item = todosItens.find(i => i.tab === t);
      return !item || (item.papeis && item.papeis.indexOf(p) < 0);
    });
    ok(faltou.length === 0, `as telas do setor ${p} continuam declaradas para ${p}`,
       'faltou: ' + faltou.join(', '));
  });

  const semAdmin = todosItens.filter(i => i.papeis && i.papeis.indexOf('ADMIN') < 0);
  ok(semAdmin.length === 0, 'nenhum item exclui o ADMIN', semAdmin.map(i => i.tab).join(', '));
}

// ---------------------------------------------------------------
secao('6b. Administração: quem protege é a senha, não o papel');
{
  // Decisão de 23/08/2026: a área administrativa aparece no menu para
  // QUALQUER usuário. Filtrar por papel daria a impressão de uma trava que
  // o botão "Ver todas as telas" desfaz num clique. A proteção real é a
  // senha de admin, cobrada na entrada de cada uma das quatro telas.
  const ADMIN_TABS = ['cadastros_dados', 'gestao_usuarios', 'lixeira', 'power_bi'];

  ADMIN_TABS.forEach(tab => {
    const item = todosItens.find(i => i.tab === tab);
    ok(!!item, `${tab} está no menu`);
    ok(item && item.papeis === null, `${tab} não é filtrado por papel`, JSON.stringify(item && item.papeis));
    ok(item && item.exigeSenhaAdmin === true, `${tab} está marcado como "exige senha de admin"`);
  });

  PAPEIS.forEach(p => {
    const tabs = visiveisPara(p).map(i => i.tab);
    const faltou = ADMIN_TABS.filter(t => tabs.indexOf(t) < 0);
    ok(faltou.length === 0, `${p} enxerga a porta da Administração`, 'faltou: ' + faltou.join(', '));
  });

  // E continuaria valendo se o filtro por papel voltasse a ser ligado.
  PAPEIS.forEach(p => {
    const faltou = ADMIN_TABS.filter(t => {
      const item = todosItens.find(i => i.tab === t);
      return item && item.papeis && item.papeis.indexOf(p) < 0;
    });
    ok(faltou.length === 0, `${p} veria a Administração mesmo com o filtro ligado`,
       'faltou: ' + faltou.join(', '));
  });

  // A porta tem que estar trancada de verdade: cada tela administrativa
  // precisa devolver o portão quando a área não foi desbloqueada. Sem esta
  // checagem, tornar o item visível teria aberto Cadastros Mestres, Lixeira
  // e Power BI para qualquer pessoa logada — que era o estado real antes,
  // quando só "Logins e Senhas" pedia senha.
  const RENDERS = {
    cadastros_dados: 'renderCadastrosDadosView',
    gestao_usuarios: 'renderGestaoUsuariosView',
    lixeira: 'renderLixeiraView',
    power_bi: 'renderPowerBiView'
  };
  Object.keys(RENDERS).forEach(tab => {
    const fn = RENDERS[tab];
    const i = ORIGEM.indexOf('function ' + fn + '(');
    const corpo = i > -1 ? ORIGEM.slice(i, i + 400) : '';
    ok(/if \(!areaAdminDesbloqueada\(\)\) return renderPortaoAdmin\(/.test(corpo),
       `${fn}() cobra a senha antes de renderizar`, corpo.slice(0, 120));
  });

  ok(ORIGEM.indexOf('window._gestaoUsuariosDesbloqueado = true') < 0,
     'a trava antiga por tela não sobrou em lugar nenhum');
  ok(/function handleLogout\(\)[^\n]*_areaAdminDesbloqueada = false/.test(ORIGEM),
     'sair do sistema tranca a área administrativa de novo');
}

// ---------------------------------------------------------------
secao('7. "Ver todas as telas" devolve o menu inteiro a qualquer papel');
// Hoje o botão nem chega a ser desenhado: renderNavMenu() só o mostra quando
// há item oculto, e com o filtro desligado nunca há. Segue testado porque é a
// rede de segurança de quando o filtro voltar.
{
  PAPEIS.concat([null]).forEach(p => {
    sandbox.window._navVerTudo = true;
    const vis = todosItens.filter(i => navItemVisivel(i, p));
    ok(vis.length === todosItens.length,
       `com "ver tudo" ligado, ${p || 'sem papel'} vê as ${todosItens.length} telas`,
       'viu: ' + vis.length);
  });
  sandbox.window._navVerTudo = false;
}

// ---------------------------------------------------------------
console.log('\n=======================================');
console.log(`  ${passes} passaram, ${falhas} falharam`);
console.log('=======================================\n');
process.exit(falhas === 0 ? 0 : 1);
