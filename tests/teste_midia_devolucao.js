// Testes da exclusão de mídia da ocorrência de devolução e da poda de mídia no
// histórico de versões (mudanças de 26/08/2026).
//
// Mesmo harness dos outros: store.js roda num sandbox com localStorage falso.
// Para o pedaço que vive em js/app.js (renderGaleriaMidia e a coleta de mídia
// do modal de detalhes) os blocos são extraídos pelo nome, como em
// teste_menu.js — app.js toca no DOM na carga e não sobe inteiro no Node.
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
    key: i => [...mapa.keys()][i]
  };
}

const INITIAL_DATA = {
  usuarios: [{ id: 1, nome: 'ADMIN', email: 'a@a.com', senha_hash: '123', role: 'ADMIN', ativo: true }],
  roles_disponiveis: ['ADMIN'],
  departamentos: [], separadores_conferentes: [], colaboradores_cd: [], setores: [],
  motoristas: [], ajudantes: [], veiculos: [], rotas: [], cargas: [], produtos: [],
  clientes: [], clientes_full: [],
  motivos_devolucao: ['AVARIA'], causas_raiz: [],
  ocorrencias_devolucao: [], itens_devolucao: [], ocorrencias_rota: [],
  relatorios_divergencia: [], auditoria_produtividade: [], controle_viagens: [],
  ocorrencias_viagens: [], motivos_ocorrencia: [], resumo_diario_cd: [], trocas_veiculos: [],
  audit_logs: [], retencoes_frota: [], reentregas: [], registro_versoes: [],
  medidas_disciplinares: [], orientacoes_feedback: [], atestados_medicos: [],
  ausencias_registros: [], sinistros: [], itens_avulsos_destinacao: []
};

// config.js entra ANTES de store.js: e de la que vem agoraIsoBrasilia() /
// hojeIsoBrasilia(), usados por addDevolucao e saveVersion. Sem ele o teste
// morre com ReferenceError antes da primeira assercao.
function carregarStore() {
  const sandbox = {
    localStorage: novoLocalStorage(),
    console,
    INITIAL_DATA: JSON.parse(JSON.stringify(INITIAL_DATA)),
    setTimeout, clearTimeout, Intl, navigator: { userAgent: 'node-teste' },
    alert: msg => { throw new Error('alert() inesperado dentro do store: ' + msg); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8'), sandbox, { filename: 'config.js' });
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/store.js'), 'utf8'), sandbox, { filename: 'store.js' });
  return sandbox;
}

const ORIGEM_APP = fs.readFileSync(path.join(RAIZ, 'js', 'app.js'), 'utf8');
function extrairApp(inicio, fim) {
  const i = ORIGEM_APP.indexOf(inicio);
  if (i < 0) throw new Error('Nao encontrei "' + inicio + '" em js/app.js — o bloco foi renomeado ou removido?');
  const j = ORIGEM_APP.indexOf(fim, i);
  if (j < 0) throw new Error('Nao encontrei o fim "' + fim + '" a partir de "' + inicio + '".');
  return ORIGEM_APP.slice(i, j + fim.length);
}

let falhas = 0, passes = 0;
function ok(cond, titulo, detalhe) {
  if (cond) { passes++; console.log('  PASS  ' + titulo); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '\n        -> ' + detalhe : '')); }
}
function secao(t) { console.log('\n=== ' + t + ' ==='); }

const FOTO_A = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
const FOTO_B = 'data:image/jpeg;base64,' + 'B'.repeat(4000);
const VIDEO_URL = 'https://qxipgnkdbzxtfvuyupow.supabase.co/storage/v1/object/public/evidencias-videos/ocorrencias/9/abertura/1-abc.mp4';

function devolucaoDeTeste(db) {
  db.currentUser = { id: 1, nome: 'ANALISTA SAC' };
  return db.addDevolucao({
    carga_numero: '1', veiculo_id: '1', veiculo_placa: 'ABC1D23', rota_nome: 'ROTA A',
    motorista_id: '1', ajudante_id: '', cliente_id: '1', cliente_nome: 'MERCADO X',
    nota_fiscal: '999', motivo_reclamado: 'AVARIA', valor_reclamado: '100',
    detalhamento_texto: 'TESTE',
    fotos_abertura: [FOTO_A, FOTO_B],
    videos_abertura: [VIDEO_URL],
    foto_url: FOTO_A, video_url: VIDEO_URL,
    forma_acerto: 'DESCONTO', sem_itens: true, observacao_sem_itens: 'TESTE'
  }, []);
}

// ---------------------------------------------------------------
secao('1. Exclusao de midia da ocorrencia');
{
  const { db } = carregarStore();
  const dev = devolucaoDeTeste(db);

  ok(dev.fotos_abertura.length === 2, 'ocorrencia nasce com 2 fotos');
  ok(dev.foto_url === FOTO_A, 'alias foto_url espelha a 1a foto');

  const r = db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', 0);
  ok(r.success === true, 'excluirMidiaDevolucao devolve {success:true}', JSON.stringify(r && r.message));
  ok(db.data.ocorrencias_devolucao[0].fotos_abertura.length === 1, 'sobrou 1 foto');
  ok(db.data.ocorrencias_devolucao[0].fotos_abertura[0] === FOTO_B, 'a foto que sobrou e a certa (removeu o indice pedido)');

  // Esta e a regressao que mais importa: sem re-sincronizar o alias, a foto
  // "excluida" volta a aparecer em qualquer tela que leia foto_url.
  ok(db.data.ocorrencias_devolucao[0].foto_url === FOTO_B,
     'alias foto_url deixou de apontar para a foto excluida', db.data.ocorrencias_devolucao[0].foto_url.slice(0, 40));
  ok(r.ehArquivo === false, 'base64 e sinalizado como "nao e arquivo no Storage"');

  const rv = db.excluirMidiaDevolucao(dev.id, 'videos_abertura', 0);
  ok(rv.success === true && rv.ehArquivo === true, 'video com URL http e sinalizado como arquivo no Storage');
  ok(db.data.ocorrencias_devolucao[0].video_url === '', 'alias video_url foi limpo junto');
}

// ---------------------------------------------------------------
secao('2. Recusas e casos de borda');
{
  const { db } = carregarStore();
  const dev = devolucaoDeTeste(db);

  ok(db.excluirMidiaDevolucao(dev.id, 'itens', 0).success === false, 'campo fora da lista branca e recusado');
  ok(db.excluirMidiaDevolucao(999999, 'fotos_abertura', 0).success === false, 'ocorrencia inexistente e recusada');
  ok(db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', 7).success === false, 'indice fora da faixa e recusado');
  ok(db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', -1).success === false, 'indice negativo e recusado');
  ok(db.data.ocorrencias_devolucao[0].fotos_abertura.length === 2, 'nenhuma recusa mexeu no registro');

  // Registro legado: nunca teve o array, so o alias. A galeria mostra o alias
  // como item 0, entao a exclusao precisa enxergar o mesmo.
  const legado = db.data.ocorrencias_devolucao[0];
  delete legado.videos_investigacao;
  legado.video_investigacao_url = VIDEO_URL;
  const rl = db.excluirMidiaDevolucao(legado.id, 'videos_investigacao', 0);
  ok(rl.success === true, 'midia legada (so alias, sem array) pode ser excluida', JSON.stringify(rl && rl.message));
  ok(legado.video_investigacao_url === '', 'alias legado foi limpo');
}

// ---------------------------------------------------------------
secao('3. Trilha de auditoria (e o que autoriza "todos podem excluir")');
{
  const { db } = carregarStore();
  const dev = devolucaoDeTeste(db);
  db.data.audit_logs = [];

  db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', 0);
  const log = db.data.audit_logs.find(l => l.acao === 'EXCLUSAO_MIDIA');
  ok(!!log, 'exclusao gera entrada EXCLUSAO_MIDIA em audit_logs');
  ok(log.usuario_nome === 'ANALISTA SAC', 'registra QUEM excluiu', log && log.usuario_nome);
  ok(!!log.data_hora, 'registra QUANDO');
  ok(log.diff.campo === 'fotos_abertura' && log.diff.indice === 0, 'registra QUAL item');
  ok(log.diff.restantes === 1, 'registra quantos sobraram');
  // O log nao pode virar o novo esconderijo do base64 que a exclusao tirou.
  ok(!String(log.diff.referencia).startsWith('data:'), 'o log NAO guarda o base64 excluido', String(log.diff.referencia).slice(0, 60));
  ok(/KB/.test(String(log.diff.referencia)), 'o log guarda o tamanho, como impressao digital');

  db.excluirMidiaDevolucao(dev.id, 'videos_abertura', 0);
  const logVideo = db.data.audit_logs.find(l => l.acao === 'EXCLUSAO_MIDIA' && l.diff.campo === 'videos_abertura');
  ok(logVideo.diff.referencia === VIDEO_URL, 'para arquivo no Storage, o log guarda o endereco inteiro');
}

// ---------------------------------------------------------------
secao('4. Exclusao nao reabre a tratativa do gestor');
{
  const { db } = carregarStore();
  const dev = devolucaoDeTeste(db);
  db.data.ocorrencias_devolucao[0].status_gestao = 'CONCLUIDO';
  db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', 0);
  ok(db.data.ocorrencias_devolucao[0].status_gestao === 'CONCLUIDO',
     'apagar um anexo nao devolve a ocorrencia para o gestor',
     db.data.ocorrencias_devolucao[0].status_gestao);
  ok(db.data.ocorrencias_devolucao[0].atualizado_por === 'ANALISTA SAC', 'mas marca quem mexeu por ultimo');
}

// ---------------------------------------------------------------
secao('5. Poda de midia no historico de versoes');
{
  const { db } = carregarStore();
  devolucaoDeTeste(db);
  db.data.registro_versoes = [];

  db.saveVersion('ocorrencias_devolucao', db.data.ocorrencias_devolucao[0]);
  const versao = db.data.registro_versoes[0];
  const bruto = JSON.stringify(versao.dados_json);

  ok(!bruto.includes('A'.repeat(4000)), 'o base64 da foto NAO foi copiado para a versao');
  ok(/n.o versionada/.test(bruto), 'ficou o marcador dizendo que havia midia');
  ok(versao.dados_json.fotos_abertura.length === 2, 'a QUANTIDADE de fotos e preservada na versao');
  ok(versao.dados_json.videos_abertura[0] === VIDEO_URL, 'endereco no Storage (~120 bytes) e preservado inteiro');
  ok(versao.dados_json.numero_protocolo === db.data.ocorrencias_devolucao[0].numero_protocolo, 'os campos normais continuam versionados');

  const tamanhoVersao = JSON.stringify(versao).length;
  ok(tamanhoVersao < 4000, 'a versao inteira ficou menor que UMA das fotos originais', tamanhoVersao + ' bytes');
}

// ---------------------------------------------------------------
secao('6. Rollback preserva a midia atual');
{
  const { db } = carregarStore();
  const dev = devolucaoDeTeste(db);
  db.data.ocorrencias_devolucao[0].acao_tomada = 'PRIMEIRA ACAO';
  db.saveVersion('ocorrencias_devolucao', db.data.ocorrencias_devolucao[0]);
  const versaoId = db.data.registro_versoes[0].id;

  db.data.ocorrencias_devolucao[0].acao_tomada = 'SEGUNDA ACAO';
  db.excluirMidiaDevolucao(dev.id, 'fotos_abertura', 0);

  const r = db.rollbackVersion('ocorrencias_devolucao', dev.id, versaoId, db.getAdminPassword());
  ok(r.success === true, 'rollback executa', JSON.stringify(r && r.message));
  const atual = db.data.ocorrencias_devolucao[0];
  ok(atual.acao_tomada === 'PRIMEIRA ACAO', 'o campo de texto voltou para a versao anterior');
  ok(atual.fotos_abertura.length === 1, 'a foto excluida NAO ressuscitou pelo rollback');
  ok(atual.fotos_abertura[0] === FOTO_B, 'e a foto que restou continua sendo a real (nao o marcador)');
  ok(!String(atual.fotos_abertura[0]).includes('versionada'), 'o marcador de poda nao vazou para o registro vivo');
}

// ---------------------------------------------------------------
secao('7. Galeria com botao de exclusao (js/app.js)');
{
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(extrairApp('function renderGaleriaMidia(dev, opcoes = {}) {', '\n}'), sandbox);
  const { renderGaleriaMidia } = sandbox;

  const dev = { id: 42, fotos_abertura: [FOTO_A, FOTO_B], videos_investigacao: [VIDEO_URL] };
  const html = renderGaleriaMidia(dev);

  ok(html.indexOf("confirmarExclusaoMidia('42', 'fotos_abertura', 0, 'foto')") > -1, 'foto 0 tem botao de exclusao com o indice certo');
  ok(html.indexOf("confirmarExclusaoMidia('42', 'fotos_abertura', 1, 'foto')") > -1, 'foto 1 tambem');
  ok(html.indexOf("confirmarExclusaoMidia('42', 'videos_investigacao', 0, 'video')") > -1, 'video da investigacao tem botao, no campo certo');
  ok(html.indexOf('event.stopPropagation()') > -1, 'o clique no lixo nao abre o lightbox por baixo');

  const semExcluir = renderGaleriaMidia(dev, { permitirExcluir: false });
  ok(semExcluir.indexOf('confirmarExclusaoMidia') === -1, 'permitirExcluir:false remove os botoes');
  ok(semExcluir.indexOf('abrirMidiaLightbox') > -1, 'mas a visualizacao continua');

  const semId = renderGaleriaMidia({ fotos_abertura: [FOTO_A] });
  ok(semId.indexOf('confirmarExclusaoMidia') === -1, 'registro sem id nao oferece exclusao (nao ha o que apagar)');

  // O marcador e o que permite atualizar a galeria sem renderApp() — sem ele,
  // excluir uma foto apagaria o formulario de apuracao que estivesse aberto.
  ok(html.indexOf('data-galeria-dev="42"') > -1, 'galeria carrega o marcador da ocorrencia');
  ok(html.indexOf('data-galeria-op=') > -1, 'galeria carrega as proprias opcoes para poder se redesenhar');

  const vazia = renderGaleriaMidia({ id: 42 });
  ok(vazia.indexOf('data-galeria-dev="42"') > -1,
     'o marcador sobrevive ao estado vazio (senao a galeria "some" ao excluir o ultimo item)');

  // As opcoes tem de voltar intactas do atributo, ou a galeria se redesenha
  // diferente do que era (titulo somindo, exclusao reaparecendo onde nao devia).
  const comOpcoes = renderGaleriaMidia(dev, { titulo: '📎 Mídia Anexada', permitirExcluir: false });
  const bruto = comOpcoes.match(/data-galeria-op="([^"]*)"/)[1];
  const voltou = JSON.parse(decodeURIComponent(bruto));
  ok(voltou.titulo === '📎 Mídia Anexada', 'titulo com emoji e acento sobrevive a ida e volta pelo atributo', voltou.titulo);
  ok(voltou.permitirExcluir === false, 'permitirExcluir sobrevive a ida e volta');
}

// ---------------------------------------------------------------
secao('8. Modal de detalhes enxerga TODA a midia (bug de 26/08/2026)');
{
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  // So o trecho de coleta, embrulhado numa funcao — o modal inteiro depende do DOM.
  const trecho = extrairApp('  // Coleta todas as mídias (fotos e vídeos)', '\n  }\n');
  vm.runInContext('function coletar(registro) {\n' + trecho + '\n return { fotos: fotos, videos: videos }; }', sandbox);

  const registro = {
    id: 7,
    fotos_abertura: [FOTO_A, FOTO_B],
    fotos_investigacao: ['data:image/jpeg;base64,CCCC'],
    videos_abertura: [VIDEO_URL],
    videos_investigacao: ['https://x/storage/v1/object/public/evidencias-videos/b.mp4'],
    foto_url: FOTO_A,       // alias do 1o item
    video_url: VIDEO_URL    // idem
  };
  const res = sandbox.coletar(registro);

  ok(res.fotos.length === 3, 'as 3 fotos aparecem (antes: 1)', 'veio ' + res.fotos.length);
  ok(res.videos.length === 2, 'os 2 videos aparecem (antes: 1)', 'veio ' + res.videos.length);
  ok(res.fotos.indexOf(FOTO_B) > -1, 'a 2a foto da abertura deixou de sumir');
  ok(res.fotos.some(f => f.endsWith('CCCC')), 'a foto da investigacao deixou de sumir');
  ok(res.fotos.filter(f => f === FOTO_A).length === 1, 'o alias foto_url nao duplica a foto que ja veio do array');
  ok(res.videos.filter(v => v === VIDEO_URL).length === 1, 'o alias video_url tambem nao duplica');

  const vazio = sandbox.coletar({ id: 8 });
  ok(vazio.fotos.length === 0 && vazio.videos.length === 0, 'registro sem midia nenhuma nao quebra');
}

console.log('\n----------------------------------------');
console.log(passes + ' passaram, ' + falhas + ' falharam');
process.exit(falhas > 0 ? 1 : 0);
