// SLA dos cards de "Alertas & Pendências Críticas" — 23/08/2026.
//
// O pedido: cada card do painel de alertas mostra a idade da ocorrência mais
// antiga, para a cobrança de cada área ter um número. O defeito que impedia:
// a linha só era desenhada quando a função achava o campo de data exato, e
// sumia calada quando não achava — sem dizer se era "no prazo" ou "não sei".
const fs = require('fs');
global.window = global;
global.document = { addEventListener(){}, getElementById(){ return null; } };
const armazem = {};
global.localStorage = {
  getItem: k => (k in armazem ? armazem[k] : null),
  setItem: (k, v) => { armazem[k] = String(v); },
  removeItem: k => { delete armazem[k]; }
};

// Extrai da app.js só o bloco das funções de SLA — o arquivo inteiro depende
// de dezenas de globais que não existem aqui.
const app = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const ini = app.indexOf('function _paraIsoDeComparacao');  // vem logo antes de dataNoPeriodo e do bloco de SLA
const fim = app.indexOf('function renderDashboardView()');
if (ini < 0 || fim < 0) { console.error('bloco de SLA nao encontrado'); process.exit(1); }
eval(app.slice(ini, fim));

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}
const HORA = 36e5;

// RELÓGIO CONGELADO. Sem isto, cada asserção compara uma data montada numa
// linha com um Date.now() lido microssegundos depois, dentro da função — e
// as conferências de texto exato ("3h 0min", "30min") passam a depender de
// a máquina não engasgar entre as duas leituras. Numa das execuções de
// 23/08/2026 o arquivo falhou uma única vez e não repetiu em 21 tentativas
// seguidas; em vez de deixar um teste que às vezes acusa e às vezes não —
// que é pior do que não ter teste, porque ninguém confia nele —, o tempo
// aqui simplesmente não anda. `new Date(iso)` continua funcionando; só o
// "agora" é fixo.
const T0 = Date.now();
Date.now = () => T0;

const atras = h => new Date(T0 - h * HORA).toISOString();

const ADM   = { atencao: 24, estourado: 48 };
const FROTA = { atencao: 4,  estourado: 8  };

console.log('\n== A idade e o nível ==');
let r = getMaisAntigaPendente([{ id: 1, criado_em: atras(3) }], ['criado_em'], ADM);
conferir('3h com meta de 24h: dentro do prazo', r.nivel === 'ok', r);
conferir('e mostra as horas', r.texto === '3h 0min', r.texto);

r = getMaisAntigaPendente([{ id: 1, criado_em: atras(30) }], ['criado_em'], ADM);
conferir('30h: atencao', r.nivel === 'atencao', r.nivel);
conferir('formata dias e horas', r.texto === '1d 6h', r.texto);

r = getMaisAntigaPendente([{ id: 1, criado_em: atras(60) }], ['criado_em'], ADM);
conferir('60h: prazo estourado', r.nivel === 'estourado', r.nivel);

console.log('\n== A frota corre mais rápido que o administrativo ==');
const cincoHoras = [{ id: 1, data_parada: atras(5) }];
conferir('5h na frota (meta 4h): atencao',
  getMaisAntigaPendente(cincoHoras, ['data_parada'], FROTA).nivel === 'atencao');
conferir('as MESMAS 5h no administrativo: dentro do prazo',
  getMaisAntigaPendente([{ id: 1, criado_em: atras(5) }], ['criado_em'], ADM).nivel === 'ok');
conferir('9h na frota: estourado',
  getMaisAntigaPendente([{ id: 1, data_parada: atras(9) }], ['data_parada'], FROTA).nivel === 'estourado');

console.log('\n== Pega a MAIS ANTIGA, não a primeira da lista ==');
r = getMaisAntigaPendente([
  { id: 1, criado_em: atras(2) },
  { id: 2, criado_em: atras(70) },
  { id: 3, criado_em: atras(10) }
], ['criado_em'], ADM);
conferir('escolhe a de 70h', r.item && r.item.id === 2, r.item);
conferir('e o nível é o dela', r.nivel === 'estourado', r.nivel);

console.log('\n== O defeito que fazia a linha sumir ==');
// Registro sem 'criado_em' mas com outro nome de data: antes devolvia
// item:null e o card não desenhava linha nenhuma.
r = getMaisAntigaPendente([{ id: 1, data_abertura: atras(50) }], ['criado_em', 'data_abertura', 'data'], ADM);
conferir('acha a data no campo alternativo', r.item !== null && r.nivel === 'estourado', r);

// Nem data nenhuma: cai no relógio do id (formato gerarIdUnico).
const idComRelogio = (Date.now() - 50 * HORA) * 1000 + 7;
r = getMaisAntigaPendente([{ id: idComRelogio }], ['criado_em'], ADM);
conferir('sem data nenhuma: usa o relógio do id', r.item !== null && r.nivel === 'estourado', r);

// Formato antigo de id (Date.now puro).
r = getMaisAntigaPendente([{ id: Date.now() - 50 * HORA }], ['criado_em'], ADM);
conferir('entende o formato antigo de id', r.item !== null && r.nivel === 'estourado', r);

// Data com OUTRO nome de campo, fora da lista pedida: a varredura ampla
// acha. Cobre o registro que entrou pela planilha ou veio da nuvem com o
// nome de coluna do banco.
r = getMaisAntigaPendente([{ id: 1, data_entrada_cd: atras(50) }], ['criado_em'], ADM);
conferir('varre qualquer campo com cara de data', r.nivel === 'estourado' && !r.estimado, r);

// Entre varias datas, fica com a MAIS ANTIGA — e ignora data futura, que e
// validade de produto ou previsao de entrega, nao idade de pendencia.
r = getMaisAntigaPendente([{
  id: 1,
  data_acao_gestor: atras(10),
  data_entrada_cd: atras(60),
  data_validade: new Date(Date.now() + 90 * 24 * HORA).toISOString()
}], ['criado_em'], ADM);
conferir('escolhe a data mais antiga do registro', r.texto === '2d 12h', r.texto);
conferir('e ignora data no futuro', r.nivel === 'estourado', r.nivel);

console.log('\n== O último recurso: "visto pela primeira vez" ==');
// O pedido de 23/08: saber que nao ha data nao resolve saber quando cobrar.
// Sem nenhuma data e sem id-relogio, conta da primeira vez que o aparelho viu.
r = getMaisAntigaPendente([{ id: 42 }], ['criado_em'], ADM);
conferir('registro sem data nenhuma AINDA recebe SLA', r.item !== null, r);
conferir('e fica marcado como estimado', r.estimado === true, r.estimado);
conferir('contando de agora, comeca perto de zero', r.horas < 0.1, r.horas);

let html = _linhaSla(r, 'Mais antiga');
conferir('a linha diz "pelo menos"', html.indexOf('pelo menos') >= 0, html);
conferir('e explica no title que a idade real e maior', html.indexOf('IGUAL OU MAIOR') >= 0, html);

// O carimbo PERSISTE: na proxima vez, conta desde a primeira.
const armazenado = JSON.parse(armazem['jr_visto_em']);
conferir('o carimbo fica guardado no aparelho', armazenado['42'] !== undefined, armazem['jr_visto_em']);
armazenado['42'] = Date.now() - 60 * HORA;          // simula 60h depois
armazem['jr_visto_em'] = JSON.stringify(armazenado);
r = getMaisAntigaPendente([{ id: 42 }], ['criado_em'], ADM);
conferir('60h depois, o SLA acompanha', r.nivel === 'estourado' && r.estimado, r);
conferir('e nao recarimba (o relogio nao reinicia)', r.texto === '2d 12h', r.texto);

// Id semeado de 2024 nao vira SLA de 804 dias: cai no carimbo, nao no id.
r = getMaisAntigaPendente([{ id: 1718000000001 }], ['criado_em'], ADM);
conferir('id semeado de 2024 nao vira SLA de 804 dias', r.horas < 0.1 && r.estimado, r);

console.log('\n== Os casos em que nao ha nada de onde contar ==');
conferir('lista vazia nao quebra', getMaisAntigaPendente([], ['criado_em'], ADM).nivel === 'indefinido');
conferir('lista nula nao quebra', getMaisAntigaPendente(null, ['criado_em'], ADM).nivel === 'indefinido');
r = getMaisAntigaPendente([{ semId: true }], ['criado_em'], ADM);
conferir('registro sem id nenhum: assume que nao sabe', r.nivel === 'indefinido', r);
conferir('e a linha diz isso, em vez de sumir',
  _linhaSla(r, 'Mais antiga').indexOf('sem referência') >= 0, _linhaSla(r, 'Mais antiga'));

console.log('\n== Minutos, para o card nao parecer quebrado logo apos o lancamento ==');
r = getMaisAntigaPendente([{ id: 1, criado_em: atras(0.5) }], ['criado_em'], ADM);
conferir('30 minutos aparece como minutos', r.texto === '30min', r.texto);
r = getMaisAntigaPendente([{ id: 1, criado_em: atras(2.5) }], ['criado_em'], ADM);
conferir('2h30 aparece com hora e minuto', r.texto === '2h 30min', r.texto);

console.log('\n== A linha que vai para a tela ==');
r = getMaisAntigaPendente([{ id: 1, criado_em: atras(60) }], ['criado_em'], ADM);
html = _linhaSla(r, 'Mais antiga');
conferir('mostra o rotulo e a idade', html.indexOf('Mais antiga: 2d 12h') >= 0, html);
conferir('avisa que o prazo estourou', html.indexOf('prazo estourado') >= 0, html);
conferir('pinta de vermelho', html.indexOf('text-red-400') >= 0, html);
conferir('a meta fica no title, para conferencia', html.indexOf('atenção em 24h') >= 0, html);

r = getMaisAntigaPendente([{ id: 1, criado_em: atras(2) }], ['criado_em'], ADM);
html = _linhaSla(r, 'Mais antiga');
conferir('dentro do prazo pinta de verde', html.indexOf('text-emerald-400') >= 0, html);
conferir('e nao fala em estouro', html.indexOf('prazo estourado') < 0, html);

// Um campo só (string) tem que continuar funcionando: a assinatura antiga
// aceitava isso e quebrar quem chama de fora seria regressao silenciosa.
conferir('aceita um campo em string, como antes',
  getMaisAntigaPendente([{ id: 1, criado_em: atras(60) }], 'criado_em', ADM).nivel === 'estourado');
conferir('sem metas informadas, usa 24h/48h',
  getMaisAntigaPendente([{ id: 1, criado_em: atras(30) }], ['criado_em']).nivel === 'atencao');



console.log('\n== O filtro por período do Dashboard (23/08/2026) ==');
// Provava-se sozinho: os campos que o filtro procurava não existem em
// registro nenhum, e dataNoPeriodo devolve true sem data. Resultado: "Este
// Mês" mostrava o histórico inteiro.
const devolucaoReal = { id: 1787492322138994, numero_protocolo: 'DEV-2026-001',
                        criado_em: '2026-08-23T13:38:42.142', data_abertura: undefined };

conferir('o registro real nao tem os campos que o filtro procurava',
  devolucaoReal.data_abertura === undefined && devolucaoReal.data === undefined);
conferir('sem data, dataNoPeriodo deixa passar (e por isso o filtro era inerte)',
  dataNoPeriodo(devolucaoReal.data_abertura || devolucaoReal.data, '2026-01-01', '2026-01-31') === true);
conferir('com criado_em na cadeia, um mes que NAO contem o registro exclui',
  dataNoPeriodo(devolucaoReal.data_abertura || devolucaoReal.data || devolucaoReal.criado_em,
                '2026-01-01', '2026-01-31') === false);
conferir('e o mes que CONTEM o registro inclui',
  dataNoPeriodo(devolucaoReal.data_abertura || devolucaoReal.data || devolucaoReal.criado_em,
                '2026-08-01', '2026-08-31') === true);
conferir('sem filtro nenhum, continua passando',
  dataNoPeriodo(devolucaoReal.criado_em, '', '') === true);

console.log('\n== Formatos de data que o filtro precisa entender ==');
// A regressao de 23/08: data_saida das viagens vem em dd/mm/aaaa, e a
// comparacao e de TEXTO. "23/08/2026" > "2026-08-23" em ordem alfabetica,
// entao toda viagem caia fora do periodo e "Este Mes" mostrava 0 de 15.
conferir('dd/mm/aaaa vira ISO', _paraIsoDeComparacao('23/08/2026') === '2026-08-23', _paraIsoDeComparacao('23/08/2026'));
conferir('ISO continua ISO', _paraIsoDeComparacao('2026-08-23') === '2026-08-23');
conferir('ISO com hora perde a hora', _paraIsoDeComparacao('2026-08-23T13:38:42.142') === '2026-08-23');
conferir('objeto Date funciona', _paraIsoDeComparacao(new Date('2026-08-23T10:00:00Z')) === '2026-08-23');
conferir('serial do Excel funciona', _paraIsoDeComparacao('46257') === '2026-08-23', _paraIsoDeComparacao('46257'));
conferir('texto sem sentido nao vira data', _paraIsoDeComparacao('INICIADO') === '', _paraIsoDeComparacao('INICIADO'));
conferir('vazio nao vira data', _paraIsoDeComparacao('') === '' && _paraIsoDeComparacao(null) === '');

console.log('\n== A viagem de dd/mm/aaaa volta a entrar no periodo ==');
const viagem = { id: 1, data_saida: '23/08/2026' };
conferir('agosto/2026 INCLUI a viagem',
  dataNoPeriodo(viagem.data_saida, '2026-08-01', '2026-08-23') === true);
conferir('janeiro/2026 exclui a viagem',
  dataNoPeriodo(viagem.data_saida, '2026-01-01', '2026-01-31') === false);
// A viagem fantasma, com estado de checklist no lugar da data: nao da para
// interpretar, entao passa — esconder seria pior do que mostrar.
conferir('viagem com "INICIADO" no lugar da data nao e escondida',
  dataNoPeriodo('INICIADO', '2026-08-01', '2026-08-23') === true);

console.log('\n== Registro sem id: ultimo buraco fechado ==');
r = getMaisAntigaPendente([{ numero_protocolo: 'DEV-2026-001' }], ['criado_em'], ADM);
conferir('sem id, mas com protocolo: ainda recebe SLA', r.item !== null && r.estimado, r);
conferir('e a linha nao diz "sem referencia"',
  _linhaSla(r, 'Mais antiga').indexOf('sem referência') < 0, _linhaSla(r, 'Mais antiga'));
r = getMaisAntigaPendente([{ nada: true }], ['criado_em'], ADM);
conferir('sem id E sem protocolo: ai sim assume que nao sabe', r.nivel === 'indefinido', r);

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
