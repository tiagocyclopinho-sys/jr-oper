// SLA dos cards de "Alertas & Pendências Críticas" — 23/08/2026.
//
// O pedido: cada card do painel de alertas mostra a idade da ocorrência mais
// antiga, para a cobrança de cada área ter um número. O defeito que impedia:
// a linha só era desenhada quando a função achava o campo de data exato, e
// sumia calada quando não achava — sem dizer se era "no prazo" ou "não sei".
const fs = require('fs');
global.window = global;
global.document = { addEventListener(){}, getElementById(){ return null; } };

// Extrai da app.js só o bloco das funções de SLA — o arquivo inteiro depende
// de dezenas de globais que não existem aqui.
const app = fs.readFileSync(__dirname + '/../js/app.js', 'utf8');
const ini = app.indexOf('function getSlaBreakdown');
const fim = app.indexOf('function renderDashboardView()');
if (ini < 0 || fim < 0) { console.error('bloco de SLA nao encontrado'); process.exit(1); }
eval(app.slice(ini, fim));

let falhas = 0;
function conferir(nome, ok, detalhe) {
  console.log((ok ? '  PASSOU  ' : '  FALHOU  ') + nome + (!ok && detalhe !== undefined ? ' -> ' + JSON.stringify(detalhe) : ''));
  if (!ok) falhas++;
}
const HORA = 36e5;
const atras = h => new Date(Date.now() - h * HORA).toISOString();

const ADM   = { atencao: 24, estourado: 48 };
const FROTA = { atencao: 4,  estourado: 8  };

console.log('\n== A idade e o nível ==');
let r = getMaisAntigaPendente([{ id: 1, criado_em: atras(3) }], ['criado_em'], ADM);
conferir('3h com meta de 24h: dentro do prazo', r.nivel === 'ok', r);
conferir('e mostra as horas', r.texto === '3h', r.texto);

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

// Id semeado (aquele que decodifica para 2024): NÃO serve de relógio.
r = getMaisAntigaPendente([{ id: 1718000000001 }], ['criado_em'], ADM);
conferir('id semeado de 2024 nao vira SLA inventado', r.nivel === 'indefinido', r);

// Id pequeno (SERIAL do banco) tambem nao e relogio.
r = getMaisAntigaPendente([{ id: 42 }], ['criado_em'], ADM);
conferir('id pequeno nao vira SLA inventado', r.nivel === 'indefinido', r);

console.log('\n== Quando não dá para saber, ele DIZ, em vez de sumir ==');
r = getMaisAntigaPendente([{ id: 42 }, { id: 43 }], ['criado_em'], ADM);
conferir('nivel indefinido', r.nivel === 'indefinido', r.nivel);
conferir('conta quantos ficaram sem data', r.semData === 2, r.semData);
let html = _linhaSla(r, 'Mais antiga');
conferir('a linha AINDA e desenhada', html.length > 0 && html.indexOf('sem data') >= 0, html);

conferir('lista vazia nao quebra', getMaisAntigaPendente([], ['criado_em'], ADM).nivel === 'indefinido');
conferir('lista nula nao quebra', getMaisAntigaPendente(null, ['criado_em'], ADM).nivel === 'indefinido');

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

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} TESTE(S) FALHARAM`);
process.exit(falhas === 0 ? 0 : 1);
