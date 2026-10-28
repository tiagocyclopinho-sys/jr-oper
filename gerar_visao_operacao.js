// =============================================================================
// GERADOR DA APRESENTACAO "VISAO OPERACAO" (28/10/2026)
//
// Monta o .pptx mensal que vai para a Gerencia e a Diretoria, no mesmo visual
// da apresentacao feita a mao (fundo azul, divisores de secao e rodape "VOO
// ALTO" exportados da de setembro/2026 para tools/visao_operacao/), mas com
// graficos nativos do PowerPoint no lugar dos prints do Power BI.
//
// De onde vem cada secao (tudo lido da nuvem do Jr-Oper, Supabase):
//   - Cortes, Inventario, Devolucao, Despesa, Abastecimento, Motoristas &
//     Ajudantes e Rastreamento: vo_indicadores / vo_quadros, a "foto" mensal
//     que a Edge Function sync-visao-operacao tira do Power BI (congelada no
//     dia 3 do mes seguinte; antes disso o arquivo sai como PREVIA).
//   - Movimentacao CD: prod_pontuacao (sync-produtividade). Sem valores em R$.
//   - S.A.C.: ocorrencias_devolucao (26 do mes anterior a 25 do mes).
//   - Troca de veiculo: trocas_veiculos (mes cheio).
//   - Horas Extras: tambem vem da foto mensal (secao horas_extras, modelo
//     "Hora Extra - PBI" do workspace GERENCIA). So HE 55%, como a manual.
//
// Uso (precisa do Node; na primeira vez o .bat instala o pptxgenjs):
//   node tools/gerar_visao_operacao.js [AAAAMM] [pasta_de_saida]
//   AAAAMM ...... mes da apresentacao (ex.: 202609). Sem ele, o ultimo mes
//                 congelado na nuvem.
//   Gera tambem "... - resumo.txt" (e-mail) e a versao corporativa em .html.
//   pasta ....... sem ela, "06 - VISAO OPERACAO\AAAA - VISAO OPERACAO".
//                 Nunca sobrescreve: se o arquivo ja existe, grava "(2)", "(3)"...
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const pptxgen = require('pptxgenjs');
// Formatos, carga dos dados, analise e pagina HTML: parte comum com o app
const VO = require('../js/visaoOperacao.js');
const { MESES, MES_ABREV, num, reais, mil, pct, dataBr, diaMes, iso, nomeMes, abrev, titulo, variacao, comparar, media, mediana, hhmm, analisar, gerarHtml } = VO;

const PASTA_PADRAO = 'S:\\Logistica\\01 - LOGISTICA INFORMATIVO\\06 - VISÃO OPERAÇÃO';
const MODELO = path.join(__dirname, 'visao_operacao');

// Cores: as mesmas dos slides de S.A.C. ja usados na apresentacao
const COR = {
  texto: '1B2A3A', suave: '5B6B7B', card: 'F2F5F3', branco: 'FFFFFF', subtitulo: 'D6E2F0',
  azul: '2E78D2', laranja: 'EA6A35', verde: '1BB07B', ambar: 'EFA200', rosa: 'E87FA8', roxo: '4C3AA8',
  bom: '1B8A4C', ruim: 'C0392B', neutro: '8A6D00', grade: 'E3E8EE', cabecalho: '17406F',
};
const PALETA = [COR.azul, COR.laranja, COR.verde, COR.ambar, COR.rosa, COR.roxo, '1AA3B8', '7F8C8D'];
const FONTE = 'Arial';

// ---------------------------------------------------------------- nuvem
// URL e chave publica do Supabase saem do js/config.js do app (mesma chave
// que o navegador usa; leitura liberada para essas tabelas).
function lerConfig() {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const url = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (cfg.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
  if (!url || !key) throw new Error('Nao achei a URL/chave do Supabase em js/config.js');
  return { url, key };
}

async function rest(cfg, tabela, query) {
  const r = await fetch(`${cfg.url}/rest/v1/${tabela}?${query}`, { headers: { apikey: cfg.key } });
  if (!r.ok) throw new Error(`Erro ao ler ${tabela}: ${r.status} ${await r.text()}`);
  return r.json();
}

// ---------------------------------------------------------------- slides base
const W = 13.333, H = 7.5;

function slideConteudo(pres, tituloTxt, subtitulo) {
  const s = pres.addSlide();
  s.background = { path: path.join(MODELO, 'fundo.jpg') };
  s.addImage({ path: path.join(MODELO, 'logo.png'), x: 11.45, y: 0.22, w: 1.55, h: 0.87 });
  s.addText(tituloTxt, { x: 0.6, y: 0.28, w: 10.6, h: 0.62, fontFace: FONTE, fontSize: 26, bold: true, color: COR.branco, margin: 0, isTextBox: true });
  if (subtitulo) s.addText(subtitulo, { x: 0.6, y: 0.92, w: 10.6, h: 0.42, fontFace: FONTE, fontSize: 13, color: COR.subtitulo, margin: 0, isTextBox: true });
  return s;
}

function slideImagem(pres, arquivo) {
  const s = pres.addSlide();
  s.background = { path: path.join(MODELO, arquivo) };
  return s;
}

function caixa(s, x, y, w, h) {
  s.addShape('roundRect', { x, y, w, h, fill: { color: COR.card }, line: { color: COR.card }, rectRadius: 0.08 });
}

// Cartao de indicador: numero grande, rotulo e uma linha de comparacao.
// comp = { texto, bom } (bom: true verde, false vermelho, null neutro)
function cartao(s, x, y, w, h, valor, rotulo, comp, corValor = COR.texto) {
  caixa(s, x, y, w, h);
  s.addText(valor, { x: x + 0.18, y: y + 0.14, w: w - 0.3, h: h * 0.42, fontFace: FONTE, fontSize: h > 1.3 ? 26 : 22, bold: true, color: corValor, margin: 0, valign: 'middle', fit: 'shrink', isTextBox: true });
  s.addText(rotulo, { x: x + 0.18, y: y + h * 0.52, w: w - 0.3, h: 0.3, fontFace: FONTE, fontSize: 11, bold: true, color: COR.texto, margin: 0, isTextBox: true });
  if (comp && comp.texto) {
    const cor = comp.bom === true ? COR.bom : comp.bom === false ? COR.ruim : COR.suave;
    s.addText(comp.texto, { x: x + 0.18, y: y + h * 0.52 + 0.3, w: w - 0.3, h: 0.3, fontFace: FONTE, fontSize: 9, color: cor, margin: 0, isTextBox: true });
  }
}

function nota(s, texto, y = 6.42) {
  s.addText(texto, { x: 0.6, y, w: 12.1, h: 0.42, fontFace: FONTE, fontSize: 10, italic: true, color: 'FFE680', margin: 0, isTextBox: true });
}

// Opcoes comuns dos graficos (objeto novo a cada chamada: o pptxgenjs altera o objeto)
function opcGrafico(extra = {}) {
  return {
    catAxisLabelColor: COR.suave, valAxisLabelColor: COR.suave, catAxisLabelFontFace: FONTE, valAxisLabelFontFace: FONTE,
    catAxisLabelFontSize: 9, valAxisLabelFontSize: 8, valGridLine: { color: COR.grade, size: 0.5 }, catGridLine: { style: 'none' },
    dataLabelColor: COR.texto, dataLabelFontFace: FONTE, dataLabelFontSize: 8, showLegend: false,
    titleColor: COR.texto, titleFontFace: FONTE, titleFontSize: 12, legendFontFace: FONTE, legendFontSize: 9, legendColor: COR.texto,
    ...extra,
  };
}

function grafBarras(s, x, y, w, h, tituloG, rotulos, valores, { horizontal = true, cor = COR.azul, formato = '#,##0', cores = null, rotuloSize = 9 } = {}) {
  caixa(s, x, y, w, h);
  if (!rotulos.length) return semDados(s, x, y, w, h, tituloG);
  s.addChart('bar', [{ name: tituloG, labels: rotulos, values: valores }], opcGrafico({
    x: x + 0.1, y: y + 0.05, w: w - 0.2, h: h - 0.1, barDir: horizontal ? 'bar' : 'col', barGapWidthPct: 45,
    // com mais de 20 barras (um mes por dia) os rotulos de valor se atropelam
    chartColors: cores || [cor], showTitle: true, title: tituloG, showValue: rotulos.length <= 20, dataLabelPosition: 'outEnd',
    dataLabelFormatCode: formato, valAxisHidden: horizontal, valGridLine: horizontal ? { style: 'none' } : { color: COR.grade, size: 0.5 },
    catAxisOrientation: horizontal ? 'maxMin' : 'minMax', catAxisLabelFontSize: rotuloSize, valAxisLabelFormatCode: formato,
  }));
}

function grafRosca(s, x, y, w, h, tituloG, rotulos, valores, formato = '0%') {
  caixa(s, x, y, w, h);
  if (!rotulos.length) return semDados(s, x, y, w, h, tituloG);
  s.addChart('doughnut', [{ name: tituloG, labels: rotulos, values: valores }], opcGrafico({
    x: x + 0.1, y: y + 0.05, w: w - 0.2, h: h - 0.1, holeSize: 55, chartColors: PALETA.slice(0, Math.max(rotulos.length, 1)),
    showTitle: true, title: tituloG, showLegend: true, legendPos: 'r', showPercent: true, showValue: false,
    dataLabelColor: COR.branco, dataLabelFontSize: 9, dataLabelFormatCode: formato,
  }));
}

function grafLinhas(s, x, y, w, h, tituloG, rotulos, series, { formato = '#,##0', cores = PALETA, rotulosValor = false } = {}) {
  caixa(s, x, y, w, h);
  if (!rotulos.length) return semDados(s, x, y, w, h, tituloG);
  s.addChart('line', series.map((se) => ({ name: se.nome, labels: rotulos, values: se.valores })), opcGrafico({
    x: x + 0.1, y: y + 0.05, w: w - 0.2, h: h - 0.1, chartColors: cores.slice(0, series.length), lineSize: 2, lineDataSymbolSize: 5,
    showTitle: true, title: tituloG, showLegend: series.length > 1, legendPos: 'b', showValue: rotulosValor, dataLabelPosition: 't',
    dataLabelFormatCode: formato, valAxisLabelFormatCode: formato, catAxisLabelFontSize: 8, catAxisLabelRotate: rotulos.length > 16 ? 270 : 0,
  }));
}

function grafColunasAgrupadas(s, x, y, w, h, tituloG, rotulos, series, { formato = '#,##0', cores = PALETA } = {}) {
  caixa(s, x, y, w, h);
  if (!rotulos.length) return semDados(s, x, y, w, h, tituloG);
  s.addChart('bar', series.map((se) => ({ name: se.nome, labels: rotulos, values: se.valores })), opcGrafico({
    x: x + 0.1, y: y + 0.05, w: w - 0.2, h: h - 0.1, barDir: 'col', barGrouping: 'clustered', barGapWidthPct: 60,
    chartColors: cores.slice(0, series.length), showTitle: true, title: tituloG, showLegend: true, legendPos: 'b',
    showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: formato, dataLabelFontSize: 7, valAxisLabelFormatCode: formato,
  }));
}

function semDados(s, x, y, w, h, tituloG) {
  s.addText([{ text: tituloG, options: { bold: true, breakLine: true } }, { text: 'Sem dados no período' }], {
    x, y, w, h, align: 'center', valign: 'middle', fontFace: FONTE, fontSize: 12, color: COR.suave, isTextBox: true,
  });
}

// Tabela branca com cabecalho azul escuro. colunas = [{ titulo, w, align }]
function tabela(s, x, y, colunas, linhas, { fonte = 9, alturaLinha = 0.25, destaqueUltima = false } = {}) {
  const cab = colunas.map((c) => ({ text: c.titulo, options: { bold: true, color: COR.branco, fill: { color: COR.cabecalho }, align: c.align || 'left' } }));
  const corpo = linhas.map((l, i) => l.map((v, j) => {
    const cel = typeof v === 'object' && v !== null && 'text' in v ? v : { text: String(v ?? '') };
    const ultima = destaqueUltima && i === linhas.length - 1;
    return { text: cel.text, options: { align: colunas[j].align || 'left', color: cel.cor || COR.texto, bold: ultima || cel.bold, fill: { color: ultima ? 'DCE6F0' : i % 2 ? 'EEF2F6' : COR.branco } } };
  }));
  s.addTable([cab, ...corpo], {
    x, y, w: colunas.reduce((t, c) => t + c.w, 0), colW: colunas.map((c) => c.w), fontFace: FONTE, fontSize: fonte,
    // margem da celula em polegadas (nao em pontos, como nas caixas de texto)
    rowH: alturaLinha, border: { type: 'solid', pt: 0.5, color: 'C9D3DE' }, margin: [0, 0.06, 0, 0.06], valign: 'middle',
  });
}

const fatias = (lista, n) => { const out = []; for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n)); return out.length ? out : [[]]; };

// ---------------------------------------------------------------- secoes
function capa(pres, d) {
  const s = slideImagem(pres, 'capa.jpg');
  s.addText(`VISÃO OPERAÇÃO · ${nomeMes(d.am)}${d.previa ? ' · PRÉVIA' : ''}`, { x: 0.75, y: 5.95, w: 6.4, h: 0.45, fontFace: FONTE, fontSize: 20, bold: true, color: COR.branco, margin: 0, isTextBox: true });
  const hoje = new Date();
  s.addText(`Gerado em ${hoje.toLocaleDateString('pt-BR')}${d.previa ? ' — números ainda abertos, mudam até o fechamento' : ''}`, { x: 0.75, y: 6.4, w: 6.4, h: 0.3, fontFace: FONTE, fontSize: 11, color: 'BFC9D4', margin: 0, isTextBox: true });
}

function painel(pres, d) {
  const s = slideConteudo(pres, 'Painel do mês', `${nomeMes(d.am)} comparado ao mês anterior e à média de ${d.ano}`);
  const linha = (secao, rot, sec, k, fmt, menorMelhor) => {
    const atual = d.v(sec, k), anterior = d.v(sec, k, d.ant), med = media(d.serie(sec, k));
    const c = comparar(atual, anterior, 'mês ant.', menorMelhor);
    const cm = comparar(atual, med, 'média', menorMelhor);
    return [secao, rot, { text: fmt(atual), bold: true }, fmt(anterior), c ? { text: c.texto.replace(' vs mês ant.', ''), cor: c.bom === null ? COR.suave : c.bom ? COR.bom : COR.ruim } : '—',
      fmt(med), cm ? { text: cm.texto.replace(' vs média', ''), cor: cm.bom === null ? COR.suave : cm.bom ? COR.bom : COR.ruim } : '—'];
  };
  const pctFmt = (v) => pct(v, 2);
  // Inventario: saldo DO MES (o indicador e acumulado no ano) e diferenca em R$,
  // porque o saldo troca de sinal e % sobre base negativa nao faz sentido.
  const invMes = (am) => (d.q('inventario', 'mes').find((x) => x.rotulo === `${Math.floor(am / 100)}-${String(am % 100).padStart(2, '0')}`) || {}).valor ?? null;
  const invAno = d.q('inventario', 'mes').filter((x) => x.rotulo.startsWith(String(d.ano)));
  const invMedia = invAno.length ? invAno.reduce((t, x) => t + (x.valor || 0), 0) / invAno.length : null;
  const dif = (a, b) => (a === null || b === null ? '—' : { text: `${a - b >= 0 ? '+' : '−'}${reais(Math.abs(a - b))}`, cor: a - b >= 0 ? COR.bom : COR.ruim });
  const inv = ['Inventário', 'Saldo do mês (R$)', { text: reais(invMes(d.am)), bold: true }, reais(invMes(d.ant)), dif(invMes(d.am), invMes(d.ant)), reais(invMedia), dif(invMes(d.am), invMedia)];
  const linhas = [
    linha('Hora extra', 'Valor HE 55% (R$)', 'horas_extras', 'valor', (v) => reais(v), true),
    linha('Cortes', 'Valor cortado (R$)', 'cortes', 'valor', (v) => reais(v), true),
    linha('Cortes', 'Pedidos cortados', 'cortes', 'pedidos', (v) => num(v), true),
    inv,
    linha('Devolução', 'Valor devolvido (R$)', 'devolucao', 'valor', (v) => reais(v), true),
    linha('Devolução', '% devolução / faturamento', 'devolucao', 'pct_dev_fat', pctFmt, true),
    linha('Despesa', 'Gasto total (R$)', 'despesa', 'valor', (v) => reais(v), true),
    linha('Abastecimento', 'Valor (R$)', 'abastecimento', 'valor', (v) => reais(v), true),
    linha('Abastecimento', 'Preço médio (R$/L)', 'abastecimento', 'preco_medio', (v) => reais(v, 2), true),
    linha('Motoristas', 'Peso entregue (kg)', 'motoristas', 'peso', (v) => num(v), false),
    linha('Rastreamento', 'Ocorrências MOOV', 'rastreamento', 'ocorrencias', (v) => num(v), true),
  ];
  tabela(s, 0.6, 1.55, [
    { titulo: 'Seção', w: 1.8 }, { titulo: 'Indicador', w: 3.0 }, { titulo: abrev(d.am), w: 1.65, align: 'right' },
    { titulo: abrev(d.ant), w: 1.65, align: 'right' }, { titulo: 'Var.', w: 1.15, align: 'right' },
    { titulo: `Média ${d.ano}`, w: 1.65, align: 'right' }, { titulo: 'Var.', w: 1.15, align: 'right' },
  ], linhas, { fonte: 11, alturaLinha: 0.38 });
  nota(s, 'Verde = melhor que a referência; vermelho = pior. Média do ano inclui o mês atual.');
}

function horasExtras(pres, d) {
  slideImagem(pres, 'divisor_horas_extras.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `Visão ${dataBr(iso(a, m - 1, 26))} a ${dataBr(iso(a, m, 25))} · Hora Extra 55% (Power BI GERÊNCIA)`;
  const v = (k, mes) => d.v('horas_extras', k, mes);
  const s = slideConteudo(pres, 'Gestão de hora extra', sub);
  cartao(s, 0.6, 1.5, 2.95, 1.3, hhmm(v('horas')), 'Horas extras', comparar(v('horas'), v('horas', d.ant), 'mês anterior'));
  cartao(s, 3.7, 1.5, 2.95, 1.3, reais(v('valor'), 2), 'Valor (R$)', comparar(v('valor'), v('valor', d.ant), 'mês anterior'));
  cartao(s, 6.8, 1.5, 2.95, 1.3, reais(v('valor_ly'), 2), `Mesmo mês de ${a - 1}`, comparar(v('valor'), v('valor_ly'), `${a - 1}`));
  const v100 = v('valor_100');
  cartao(s, 9.9, 1.5, 2.8, 1.3, num(v('funcionarios')), 'Funcionários com HE',
    v100 ? { texto: `+ HE 100%: ${reais(v100, 2)} (${hhmm(v('horas_100'))} h)`, bom: false } : { texto: 'sem HE 100% no mês', bom: null });
  const setor = d.q('horas_extras', 'setor');
  grafRosca(s, 0.6, 3.0, 4.3, 3.3, 'Valor por setor', setor.map((x) => titulo(x.rotulo)), setor.map((x) => x.valor));
  grafBarras(s, 5.05, 3.0, 3.6, 3.3, 'Horas por setor', setor.map((x) => titulo(x.rotulo).replace('Carregamento ', 'Carreg. ')), setor.map((x) => x.valor2), { cor: COR.azul, formato: '#,##0', rotuloSize: 8 });
  const mes = d.q('horas_extras', 'mes').sort((x, y) => x.ordem - y.ordem);
  grafBarras(s, 8.8, 3.0, 3.9, 3.3, 'Valor HE por mês (R$)', mes.map((x) => `${MES_ABREV[Number(x.rotulo.slice(5)) - 1]}/${x.rotulo.slice(2, 4)}`), mes.map((x) => x.valor), { horizontal: false, cor: COR.ambar, rotuloSize: 7 });

  // Lista por funcionario, do maior valor para o menor
  const pessoas = d.q('horas_extras', 'funcionario');
  const tot = v('valor');
  const paginas = fatias(pessoas, 18);
  paginas.forEach((pag, i) => {
    const s2 = slideConteudo(pres, 'Hora extra por funcionário', `${sub}${paginas.length > 1 ? ` · parte ${i + 1}/${paginas.length}` : ''}`);
    tabela(s2, 0.6, 1.5, [{ titulo: 'Funcionário', w: 4.6 }, { titulo: 'Setor', w: 3.4 }, { titulo: 'Horas', w: 1.3, align: 'right' },
      { titulo: 'Valor (R$)', w: 1.5, align: 'right' }, { titulo: '% do total', w: 1.3, align: 'right' }],
    pag.map((x) => { const [st, nome] = x.rotulo.split(' | '); return [titulo(nome || st), titulo(nome ? st : ''), hhmm(x.valor2), num(x.valor, 2), pct(tot ? x.valor / tot : null, 1)]; }),
    { fonte: 9, alturaLinha: 0.27 });
  });
}

function movimentacao(pres, d) {
  slideImagem(pres, 'divisor_movimentacao.jpg');
  const operacional = d.pontos.filter((p) => !/SUPERVISOR|ASSISTENTE/i.test(p.cargo || ''));
  for (const setor of ['FRIO', 'SECO']) {
    const pessoas = operacional.filter((p) => (p.setor || '').toUpperCase() === setor).sort((x, y) => (x.nome || '').localeCompare(y.nome || ''));
    const tot = (k) => pessoas.reduce((t, p) => t + Number(p[k] || 0), 0);
    const T = { os: tot('qtd_os'), ap: tot('qtd_apanhos'), kg: tot('kg_total'), ent: tot('kg_entrada') };
    const rep = (v, t) => (v === null || v === undefined || !t ? '' : pct(Number(v) / t, 2));
    const paginas = fatias(pessoas, 18);
    paginas.forEach((pag, i) => {
      const s = slideConteudo(pres, `Pontuação por produtividade — ${setor}`,
        `${dataBr(iso(d.ano, (d.am % 100) - 1, 26))} a ${dataBr(iso(d.ano, d.am % 100, 25))} · ${pessoas.length} colaboradores${paginas.length > 1 ? ` · parte ${i + 1}/${paginas.length}` : ''}`);
      const n0 = (v, c = 0) => (v === null || v === undefined ? '' : num(v, c));
      const linhas = pag.map((p) => [titulo(p.nome || ''), titulo(p.cargo || '').replace('De Mercadoria', '').trim(),
        n0(p.qtd_os), rep(p.qtd_os, T.os), n0(p.qtd_apanhos), rep(p.qtd_apanhos, T.ap), n0(p.kg_total, 2), rep(p.kg_total, T.kg),
        p.kg_entrada ? num(p.kg_entrada, 2) : '', p.kg_entrada ? rep(p.kg_entrada, T.ent) : '', num(p.pontuacao, 1)]);
      if (i === paginas.length - 1) linhas.push(['Total', '', num(T.os), '100%', num(T.ap), '100%', num(T.kg, 2), '100%', num(T.ent, 2), T.ent ? '100%' : '', '']);
      tabela(s, 0.6, 1.5, [
        { titulo: 'Nome', w: 3.2 }, { titulo: 'Cargo', w: 1.9 }, { titulo: 'Qtd OS', w: 0.8, align: 'right' }, { titulo: '% OS', w: 0.75, align: 'right' },
        { titulo: 'Apanhos', w: 0.85, align: 'right' }, { titulo: '% Ap.', w: 0.75, align: 'right' }, { titulo: 'Total kg', w: 1.15, align: 'right' },
        { titulo: '% kg', w: 0.75, align: 'right' }, { titulo: 'Kg entrada', w: 1.1, align: 'right' }, { titulo: '% ent.', w: 0.75, align: 'right' },
        { titulo: 'Pontos', w: 0.75, align: 'right' },
      ], linhas, { fonte: 9, alturaLinha: 0.27, destaqueUltima: i === paginas.length - 1 });
    });
  }
}

function cortes(pres, d) {
  slideImagem(pres, 'divisor_cortes.jpg');
  const a = d.ano, m = d.am % 100;
  const s = slideConteudo(pres, 'Gestão de cortes', `${dataBr(iso(a, m - 1, 26))} a ${dataBr(iso(a, m, 25))}`);
  const anterior = (k) => d.v('cortes', k, d.ant);
  cartao(s, 0.6, 1.5, 2.6, 1.35, reais(d.v('cortes', 'valor')), 'Corte (R$)', comparar(d.v('cortes', 'valor'), anterior('valor'), 'mês anterior'));
  cartao(s, 0.6, 3.0, 2.6, 1.35, `${num(d.v('cortes', 'kg'), 0)} kg`, 'Corte (kg)', comparar(d.v('cortes', 'kg'), anterior('kg'), 'mês anterior'));
  cartao(s, 0.6, 4.5, 2.6, 1.35, num(d.v('cortes', 'pedidos')), 'Pedidos cortados', comparar(d.v('cortes', 'pedidos'), anterior('pedidos'), 'mês anterior'));
  const prod = d.q('cortes', 'produto');
  grafBarras(s, 3.4, 1.5, 4.6, 4.35, 'Cortes por produto (R$, top 15)', prod.map((p) => p.rotulo.slice(0, 28)), prod.map((p) => p.valor), { formato: '#,##0', rotuloSize: 8 });
  const dia = d.q('cortes', 'dia');
  grafBarras(s, 8.2, 1.5, 4.5, 4.35, 'Valor de corte por dia (R$)', dia.map((x) => diaMes(x.rotulo)), dia.map((x) => x.valor), { horizontal: false, cor: COR.laranja, rotuloSize: 7 });
  const serie = d.serie('cortes', 'valor');
  nota(s, `Média de ${d.ano}: ${reais(media(serie))} por mês · maior mês: ${(() => { const mx = serie.reduce((b, x) => (x.valor > (b?.valor ?? -1) ? x : b), null); return mx ? `${abrev(mx.mes)} (${reais(mx.valor)})` : '—'; })()}`);
}

function inventario(pres, d) {
  slideImagem(pres, 'divisor_inventario.jpg');
  const s = slideConteudo(pres, 'Gestão de inventários', `Acumulado de 01/01/${d.ano} a ${dataBr(iso(d.ano, (d.am % 100) + 1, 0))}`);
  const sd = d.v('inventario', 'saldo'), ly = d.v('inventario', 'saldo_ly');
  const corSaldo = (v) => (v === null ? COR.texto : v >= 0 ? COR.bom : COR.ruim);
  cartao(s, 0.6, 1.5, 2.35, 1.3, reais(sd), 'Saldo no ano', null, corSaldo(sd));
  cartao(s, 3.1, 1.5, 2.35, 1.3, reais(ly), `Saldo ${d.ano - 1} (mesmo período)`, null, corSaldo(ly));
  cartao(s, 5.6, 1.5, 2.35, 1.3, reais(sd !== null && ly !== null ? sd - ly : null), 'Diferença para o ano anterior', null, corSaldo(sd !== null && ly !== null ? sd - ly : null));
  cartao(s, 8.1, 1.5, 2.25, 1.3, reais(d.v('inventario', 'perda')), 'Perda', null, COR.ruim);
  cartao(s, 10.5, 1.5, 2.2, 1.3, reais(d.v('inventario', 'rendimento')), 'Rendimento', null, COR.bom);
  const meses = d.q('inventario', 'mes');
  const doAno = (ano) => meses.filter((x) => x.rotulo.startsWith(String(ano)));
  const atual = doAno(d.ano);
  grafColunasAgrupadas(s, 0.6, 3.0, 6.0, 3.3, 'Perda / rendimento por mês (R$)', atual.map((x) => MES_ABREV[Number(x.rotulo.slice(5)) - 1]),
    [{ nome: 'Perda', valores: atual.map((x) => x.valor2 ?? 0) }, { nome: 'Rendimento', valores: atual.map((x) => x.valor3 ?? 0) }], { cores: [COR.laranja, COR.azul] });
  const ant = doAno(d.ano - 1);
  const rot = atual.map((x) => MES_ABREV[Number(x.rotulo.slice(5)) - 1]);
  grafColunasAgrupadas(s, 6.75, 3.0, 5.95, 3.3, 'Saldo comparativo por mês (R$)', rot,
    [{ nome: String(d.ano - 1), valores: atual.map((x) => (ant.find((y) => y.rotulo.slice(5) === x.rotulo.slice(5)) || {}).valor ?? 0) },
      { nome: String(d.ano), valores: atual.map((x) => x.valor ?? 0) }], { cores: [COR.cabecalho, COR.ambar] });
}

function devolucao(pres, d) {
  slideImagem(pres, 'divisor_devolucao.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `${dataBr(iso(a, m, 1))} a ${dataBr(iso(a, m + 1, 0))} · Power BI (WinThor)`;
  const s = slideConteudo(pres, 'Acompanhamento de devolução', sub);
  const v = (k) => d.v('devolucao', k);
  const ly = 'ano anterior';
  cartao(s, 0.6, 1.5, 2.3, 1.3, reais(v('valor')), 'Devolução (R$)', comparar(v('valor'), v('valor_ly'), ly));
  cartao(s, 3.05, 1.5, 2.3, 1.3, `${num(v('kg'), 0)} kg`, 'Devolução (kg)', comparar(v('kg'), v('kg_ly'), ly));
  cartao(s, 5.5, 1.5, 2.3, 1.3, num(v('qtd')), 'Qtd devoluções', comparar(v('qtd'), v('qtd_ly'), ly));
  cartao(s, 7.95, 1.5, 2.3, 1.3, reais(v('ticket'), 2), 'Ticket médio', comparar(v('ticket'), v('ticket_ly'), ly));
  cartao(s, 10.4, 1.5, 2.3, 1.3, pct(v('pct_dev_fat'), 2), `% dev / faturamento`, { texto: `Faturamento ${reais(v('faturamento'))}`, bom: null });
  const setor = d.q('devolucao', 'setor');
  grafRosca(s, 0.6, 3.0, 3.8, 3.3, 'Por setor (R$)', setor.map((x) => x.rotulo), setor.map((x) => x.valor));
  const dia = d.q('devolucao', 'dia');
  grafBarras(s, 4.55, 3.0, 8.15, 3.3, 'Devolução por dia (R$)', dia.map((x) => diaMes(x.rotulo)), dia.map((x) => x.valor), { horizontal: false, cor: COR.ambar, rotuloSize: 8 });

  const s2 = slideConteudo(pres, 'Devolução — motivos e responsáveis', sub);
  const mot = d.q('devolucao', 'motivo').slice(0, 12);
  grafBarras(s2, 0.6, 1.5, 7.2, 4.85, 'Pareto por motivo (R$, top 12)', mot.map((x) => titulo(x.rotulo).slice(0, 34)), mot.map((x) => x.valor), { cor: COR.ambar, rotuloSize: 8 });
  const resp = d.q('devolucao', 'responsavel');
  const total = resp.reduce((t, x) => t + (x.valor || 0), 0);
  grafBarras(s2, 7.95, 1.5, 4.75, 4.85, 'Responsável (R$)', resp.map((x) => `${titulo(x.rotulo)} (${pct(total ? x.valor / total : null, 0)})`), resp.map((x) => x.valor), { cor: COR.azul });
}

function despesa(pres, d) {
  slideImagem(pres, 'divisor_despesa.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `${dataBr(iso(a, m, 1))} a ${dataBr(iso(a, m + 1, 0))} · cartões Vólus e ValeCard`;
  const s = slideConteudo(pres, 'Acompanhamento de despesas', sub);
  const v = (k) => d.v('despesa', k);
  cartao(s, 0.6, 1.5, 2.9, 1.3, reais(v('valor'), 2), 'Valor total', comparar(v('valor'), v('valor_ly'), 'ano anterior'));
  cartao(s, 3.65, 1.5, 2.9, 1.3, num(v('qtd')), 'Qtd transações', comparar(v('qtd'), v('qtd_ly'), 'ano anterior'));
  cartao(s, 6.7, 1.5, 2.9, 1.3, reais(v('ticket'), 2), 'Média por transação', comparar(v('ticket'), v('ticket_ly'), 'ano anterior'));
  cartao(s, 9.75, 1.5, 2.95, 1.3, reais(v('por_dia'), 2), 'Gasto por dia', comparar(v('por_dia'), v('por_dia_ly'), 'ano anterior'));
  const dep = d.q('despesa', 'departamento');
  grafRosca(s, 0.6, 3.0, 3.8, 3.3, 'Por departamento (R$)', dep.map((x) => titulo(x.rotulo)), dep.map((x) => x.valor));
  const dia = d.q('despesa', 'dia');
  grafBarras(s, 4.55, 3.0, 8.15, 3.3, 'Gasto por dia (R$)', dia.map((x) => diaMes(x.rotulo)), dia.map((x) => x.valor), { horizontal: false, cor: COR.ambar, rotuloSize: 8 });

  const s2 = slideConteudo(pres, 'Despesas — quem mais gastou', sub);
  const us = d.q('despesa', 'usuario');
  grafBarras(s2, 0.6, 1.5, 7.4, 4.85, 'Usuários (R$, top 15)', us.map((x) => titulo(x.rotulo)), us.map((x) => x.valor), { cor: COR.ambar, formato: '#,##0.00' });
  const tot = v('valor');
  tabela(s2, 8.2, 1.5, [{ titulo: 'Usuário', w: 2.6 }, { titulo: 'Transações', w: 0.95, align: 'right' }, { titulo: '% do total', w: 0.95, align: 'right' }],
    us.map((x) => [titulo(x.rotulo), num(x.valor2), pct(tot ? x.valor / tot : null, 1)]), { fonte: 9, alturaLinha: 0.3 });
}

function abastecimento(pres, d) {
  slideImagem(pres, 'divisor_abastecimento.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `${dataBr(iso(a, m, 1))} a ${dataBr(iso(a, m + 1, 0))}`;
  const s = slideConteudo(pres, 'Gestão de abastecimento', sub);
  const v = (k) => d.v('abastecimento', k);
  cartao(s, 0.6, 1.5, 2.3, 1.3, reais(v('valor')), 'Valor total', comparar(v('valor'), v('valor_lm'), 'mês anterior'));
  cartao(s, 3.05, 1.5, 2.3, 1.3, `${num(v('litros'))} L`, 'Litros', comparar(v('litros'), v('litros_lm'), 'mês anterior', null));
  cartao(s, 5.5, 1.5, 2.3, 1.3, reais(v('preco_medio'), 2), 'Preço médio / L', comparar(v('preco_medio'), v('preco_medio_lm'), 'mês anterior'));
  const minimo = v('preco_min');
  cartao(s, 7.95, 1.5, 2.3, 1.3, reais(minimo, 2), 'Preço mínimo / L', minimo !== null && minimo < 3 ? { texto: '⚠ abaixo de R$ 3: conferir lançamento', bom: false } : comparar(minimo, v('preco_min_lm'), 'mês anterior'));
  cartao(s, 10.4, 1.5, 2.3, 1.3, reais(v('preco_max'), 2), 'Preço máximo / L', comparar(v('preco_max'), v('preco_max_lm'), 'mês anterior'));
  const dia = d.q('abastecimento', 'dia');
  grafBarras(s, 0.6, 3.0, 6.3, 3.3, 'Abastecimento por dia (R$)', dia.map((x) => diaMes(x.rotulo)), dia.map((x) => x.valor), { horizontal: false, cor: COR.ambar, rotuloSize: 7 });
  const pr = d.q('abastecimento', 'preco_dia');
  grafLinhas(s, 7.05, 3.0, 5.65, 3.3, 'Preço por litro por dia (R$)', pr.map((x) => diaMes(x.rotulo)),
    [{ nome: 'Médio', valores: pr.map((x) => x.valor) }, { nome: 'Mínimo', valores: pr.map((x) => x.valor2) }, { nome: 'Máximo', valores: pr.map((x) => x.valor3) }],
    { formato: '#,##0.00', cores: [COR.azul, COR.verde, COR.laranja] });
  // Ajuste do mes anterior: lancamentos que chegaram depois do fechamento (notas quinzenais)
  const fechadoAnt = d.v('abastecimento', 'valor', d.ant), atualAnt = d.atual('abastecimento', 'valor', d.ant);
  if (d.statusAnt === 'fechado' && fechadoAnt !== null && atualAnt !== null && Math.abs(atualAnt - fechadoAnt) >= 1) {
    nota(s, `Lançado após o fechamento de ${nomeMes(d.ant).toLowerCase()}: ${atualAnt > fechadoAnt ? '+' : '−'}${reais(Math.abs(atualAnt - fechadoAnt))} (notas quinzenais). Valor real do mês: ${reais(atualAnt)}.`);
  }

  const s2 = slideConteudo(pres, 'Abastecimento — postos e combustíveis', sub);
  const forn = d.q('abastecimento', 'fornecedor').slice(0, 15);
  tabela(s2, 0.6, 1.5, [{ titulo: 'Posto', w: 3.6 }, { titulo: 'Litros', w: 1.05, align: 'right' }, { titulo: 'Valor (R$)', w: 1.25, align: 'right' }, { titulo: 'R$ / L', w: 0.8, align: 'right' }],
    forn.map((x) => [titulo(x.rotulo).slice(0, 44), num(x.valor2), num(x.valor), num(x.valor3, 2)]), { fonte: 9, alturaLinha: 0.29 });
  const comb = d.q('abastecimento', 'combustivel');
  grafRosca(s2, 7.55, 1.5, 5.15, 2.35, 'Por combustível (R$)', comb.map((x) => x.rotulo), comb.map((x) => x.valor));
  const ie = d.q('abastecimento', 'interno_externo');
  grafRosca(s2, 7.55, 4.0, 5.15, 2.35, 'Posto interno x externo (R$)', ie.map((x) => titulo(x.rotulo)), ie.map((x) => x.valor));
}

function motoristas(pres, d) {
  slideImagem(pres, 'divisor_motoristas.jpg');
  const a = d.ano, m = d.am % 100;
  const mot = d.q('motoristas', 'motorista'), aj = d.q('motoristas', 'ajudante');
  const garantido = d.v('motoristas', 'garantido');
  const status = (p) => (p === null ? '' : p >= 1 ? { text: '●', cor: COR.bom } : p >= 0.7 ? { text: '▲', cor: COR.neutro } : { text: '◆', cor: COR.ruim });
  const n = 19;
  const paginas = Math.max(Math.ceil(mot.length / n), Math.ceil(aj.length / n), 1);
  for (let i = 0; i < paginas; i++) {
    const s = slideConteudo(pres, 'Gestão de motoristas & ajudantes',
      `${dataBr(iso(a, m, 1))} a ${dataBr(iso(a, m + 1, 0))} · garantido ${num(garantido)} kg · ● ≥ 100%  ▲ 70–99%  ◆ < 70%${paginas > 1 ? ` · parte ${i + 1}/${paginas}` : ''}`);
    const cols = (rot) => [{ titulo: rot, w: 3.0 }, { titulo: 'Peso (kg)', w: 1.15, align: 'right' }, { titulo: 'Viagens', w: 0.75, align: 'right' }, { titulo: '% gar.', w: 0.8, align: 'right' }, { titulo: '', w: 0.3, align: 'center' }];
    const linhas = (lista) => lista.slice(i * n, (i + 1) * n).map((x) => [titulo(x.rotulo.replace(/^AJD\.?\s*MOT\.?\s*/i, '')).slice(0, 34), num(x.valor), num(x.valor2), pct(x.valor3, 0), status(x.valor3)]);
    tabela(s, 0.6, 1.5, cols('Motorista'), linhas(mot), { fonte: 9, alturaLinha: 0.255 });
    tabela(s, 6.75, 1.5, cols('Ajudante'), linhas(aj), { fonte: 9, alturaLinha: 0.255 });
  }
  const abaixo = mot.filter((x) => x.valor3 !== null && x.valor3 < 0.7).length;
  const s = slideConteudo(pres, 'Motoristas — resumo do mês', `${num(d.v('motoristas', 'motoristas_ativos'))} motoristas e ${num(d.v('motoristas', 'ajudantes_ativos'))} ajudantes ativos`);
  cartao(s, 0.6, 1.5, 3.9, 1.4, `${num(d.v('motoristas', 'peso'))} kg`, 'Peso total entregue', comparar(d.v('motoristas', 'peso'), d.v('motoristas', 'peso', d.ant), 'mês anterior', false));
  cartao(s, 4.7, 1.5, 3.9, 1.4, num(d.v('motoristas', 'viagens')), 'Viagens', comparar(d.v('motoristas', 'viagens'), d.v('motoristas', 'viagens', d.ant), 'mês anterior', false));
  cartao(s, 8.8, 1.5, 3.9, 1.4, `${abaixo} de ${mot.length}`, 'Motoristas abaixo de 70% do garantido', null, abaixo ? COR.ruim : COR.bom);
  const serie = d.serie('motoristas', 'peso');
  grafBarras(s, 0.6, 3.1, 12.1, 3.2, `Peso entregue por mês em ${d.ano} (kg)`, serie.map((x) => MES_ABREV[(x.mes % 100) - 1]), serie.map((x) => x.valor), { horizontal: false, cor: COR.azul });
}

function rastreamento(pres, d) {
  slideImagem(pres, 'divisor_rastreamento.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `${dataBr(iso(a, m, 1))} a ${dataBr(iso(a, m + 1, 0))} · plataforma MOOV`;
  const s = slideConteudo(pres, 'Gestão MOOV — rastreamento', sub);
  const oc = d.v('rastreamento', 'ocorrencias'), sv = d.v('rastreamento', 'sem_vinculo');
  cartao(s, 0.6, 1.5, 3.0, 1.3, num(oc), 'Ocorrências', comparar(oc, d.v('rastreamento', 'ocorrencias', d.ant), 'mês anterior'), COR.laranja);
  cartao(s, 0.6, 2.95, 3.0, 1.3, pct(oc ? sv / oc : null, 1), 'Sem vínculo com viagem', { texto: `${num(sv)} ocorrências sem motorista`, bom: oc && sv / oc <= 0.15 ? true : false });
  const mot = d.q('rastreamento', 'motivo');
  grafRosca(s, 3.75, 1.5, 4.4, 2.75, 'Por motivo', mot.map((x) => titulo(x.rotulo)), mot.map((x) => x.valor));
  const vin = d.q('rastreamento', 'vinculo');
  grafRosca(s, 8.3, 1.5, 4.4, 2.75, 'Por vínculo', vin.map((x) => x.rotulo), vin.map((x) => x.valor));
  const dia = d.q('rastreamento', 'dia');
  grafLinhas(s, 0.6, 4.4, 12.1, 1.95, 'Ocorrências por dia', dia.map((x) => diaMes(x.rotulo)), [{ nome: 'Ocorrências', valores: dia.map((x) => x.valor) }], { cores: [COR.laranja], rotulosValor: true });
  nota(s, 'A plataforma MOOV mudou recentemente os parâmetros de ocorrência: comparar com meses anteriores à mudança com cuidado.');

  const s2 = slideConteudo(pres, 'MOOV — motoristas e horários', sub);
  const mm = d.q('rastreamento', 'motorista').filter((x) => x.rotulo !== '(Em branco)');
  grafBarras(s2, 0.6, 1.5, 6.6, 4.85, 'Motorista responsável (top)', mm.map((x) => titulo(x.rotulo)), mm.map((x) => x.valor), { cor: COR.laranja });
  const fx = d.q('rastreamento', 'faixa_horaria').slice(0, 10);
  grafBarras(s2, 7.35, 1.5, 5.35, 4.85, 'Faixas de horário com mais ocorrências', fx.map((x) => x.rotulo), fx.map((x) => x.valor), { cor: COR.laranja });

  const tr = d.trocas;
  const pags = fatias(tr, 9);
  pags.forEach((pag, i) => {
    const s3 = slideConteudo(pres, 'Troca de veículo', `${tr.length} troca(s) no mês · registro do Jr-Oper${pags.length > 1 ? ` · parte ${i + 1}/${pags.length}` : ''}`);
    if (!tr.length) return semDados(s3, 0.6, 1.5, 12.1, 4.8, 'Troca de veículo');
    tabela(s3, 0.6, 1.5, [{ titulo: 'Data', w: 1.0 }, { titulo: 'Escalado', w: 1.15 }, { titulo: 'Trocado', w: 1.15 }, { titulo: 'Motivo', w: 2.0 }, { titulo: 'Detalhado', w: 5.0 }, { titulo: 'Autorizado por', w: 1.8 }],
      pag.map((t) => [dataBr(t.data), t.veiculo_escalado || '', t.veiculo_trocado || '', titulo((t.motivo_resumido === 'OUTRO' ? t.motivo_outro : t.motivo_resumido) || '').replace(/_/g, ' '),
        (t.detalhamento || '').slice(0, 160), titulo(t.autorizado_por || '')]), { fonte: 9, alturaLinha: 0.5 });
  });
}

function sac(pres, d) {
  slideImagem(pres, 'divisor_sac.jpg');
  const a = d.ano, m = d.am % 100;
  const sub = `${dataBr(iso(a, m - 1, 26))} a ${dataBr(iso(a, m, 25))} · ocorrências lançadas no Jr-Oper`;
  const oc = d.sac;
  const concl = oc.filter((o) => o.status_gestao === 'CONCLUIDO').length;
  const fisico = oc.filter((o) => !o.data_entrada_cd && !o.sem_itens).length;
  const valor = oc.reduce((t, o) => t + Number(o.valor_reclamado || 0), 0);
  const jrPaga = oc.filter((o) => o.forma_acerto === 'JR_PAGA_DIFERENCA').length;
  const s = slideConteudo(pres, 'Visão geral do período', `${concl} de ${oc.length} ocorrências concluídas; ${oc.length - concl} ainda aguardam o gestor`);
  const w = 2.25, gap = 0.21;
  cartao(s, 0.6, 1.5, w, 1.6, num(oc.length), 'Ocorrências', { texto: 'lançadas no período', bom: null });
  cartao(s, 0.6 + (w + gap), 1.5, w, 1.6, num(concl), 'Concluídas', { texto: `${pct(oc.length ? concl / oc.length : null, 0)} do total`, bom: null }, COR.bom);
  cartao(s, 0.6 + 2 * (w + gap), 1.5, w, 1.6, num(oc.length - concl), 'Aguardando gestor', { texto: 'análise ainda aberta', bom: null }, COR.neutro);
  cartao(s, 0.6 + 3 * (w + gap), 1.5, w, 1.6, num(fisico), 'Físico pendente', { texto: 'mercadoria não recebida no CD', bom: null }, COR.neutro);
  cartao(s, 0.6 + 4 * (w + gap), 1.5, w, 1.6, num(valor / 1000, 1), 'Mil R$ reclamados', { texto: `${oc.length - jrPaga} abatimento · ${jrPaga} JR paga diferença`, bom: null });
  const porTipo = {};
  for (const o of oc) { const t = o.tipo_erro || 'SEM TIPO'; (porTipo[t] ||= { qtd: 0, valor: 0 }); porTipo[t].qtd++; porTipo[t].valor += Number(o.valor_reclamado || 0); }
  const tipos = Object.entries(porTipo).sort((x, y) => y[1].qtd - x[1].qtd);
  const rotTipo = (t) => (t.charAt(0) + t.slice(1).toLowerCase());
  grafRosca(s, 0.6, 3.3, 12.1, 3.0, 'Composição por tipo de erro (quantidade)', tipos.map(([t, o]) => `${rotTipo(t)}  ${o.qtd} (${pct(oc.length ? o.qtd / oc.length : null, 0)})`), tipos.map(([, o]) => o.qtd));

  const maior = tipos.slice().sort((x, y) => y[1].valor - x[1].valor)[0];
  const s2 = slideConteudo(pres, 'Tipo de erro', tipos.length ? `${rotTipo(tipos[0][0])} é o mais frequente; em valor, ${rotTipo(maior[0]).toLowerCase()} pesa mais (${reais(maior[1].valor)})` : 'Sem ocorrências no período');
  grafBarras(s2, 0.6, 1.5, 6.0, 4.85, 'Ocorrências por tipo de erro', tipos.map(([t]) => rotTipo(t)), tipos.map(([, o]) => o.qtd), { cores: PALETA.slice(0, tipos.length) });
  const linhas = tipos.map(([t, o]) => [rotTipo(t), num(o.qtd), pct(oc.length ? o.qtd / oc.length : null, 0), reais(o.valor)]);
  linhas.push(['Total', num(oc.length), '100%', reais(valor)]);
  tabela(s2, 6.8, 1.5, [{ titulo: 'Tipo de erro', w: 2.8 }, { titulo: 'Qtd', w: 0.8, align: 'right' }, { titulo: '%', w: 0.8, align: 'right' }, { titulo: 'Valor reclamado', w: 1.5, align: 'right' }],
    linhas, { fonte: 11, alturaLinha: 0.45, destaqueUltima: true });
  nota(s2, 'Valor reclamado é o valor informado na abertura. Erro industrial e comercial são tratados por outra gerência; desconto de produtividade só cabe a motorista e carregamento.');
}

function listaCard(s, x, y, w, h, tituloL, cor, itens) {
  caixa(s, x, y, w, h);
  s.addText(tituloL, { x: x + 0.25, y: y + 0.15, w: w - 0.5, h: 0.4, fontFace: FONTE, fontSize: 15, bold: true, color: cor, margin: 0, isTextBox: true });
  const corpo = itens.length ? itens.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < itens.length - 1 } })) : [{ text: 'Nada a destacar no mês.' }];
  s.addText(corpo, { x: x + 0.25, y: y + 0.6, w: w - 0.5, h: h - 0.75, fontFace: FONTE, fontSize: 11, color: COR.texto, valign: 'top', paraSpaceAfter: 6, margin: 0, fit: 'shrink', isTextBox: true });
}

function resumo(pres, d, a) {
  const s = slideConteudo(pres, 'Resumo executivo', `${nomeMes(d.am)} · leitura automática dos números`);
  listaCard(s, 0.6, 1.5, 5.95, 4.85, 'Pontos positivos', COR.bom, a.positivos);
  listaCard(s, 6.75, 1.5, 5.95, 4.85, 'Pontos de melhoria', COR.ruim, a.melhorias);

  const s2 = slideConteudo(pres, 'Oportunidades de redução de custo', 'Estimativas por mês, com o critério de cada uma; não são metas aprovadas');
  const total = a.custos.reduce((t, c) => t + c.valor, 0);
  cartao(s2, 0.6, 1.5, 3.2, 1.5, reais(total), 'Potencial estimado / mês', { texto: `${a.custos.length} oportunidade(s)`, bom: null }, COR.bom);
  a.custos.slice(0, 4).forEach((c, i) => {
    const y = 1.5 + i * 1.2;
    caixa(s2, 4.0, y, 8.7, 1.08);
    s2.addText(reais(c.valor), { x: 4.2, y: y + 0.12, w: 1.9, h: 0.8, fontFace: FONTE, fontSize: 18, bold: true, color: COR.bom, margin: 0, valign: 'middle', isTextBox: true });
    s2.addText([{ text: c.titulo, options: { bold: true, breakLine: true } }, { text: c.texto }], { x: 6.15, y: y + 0.08, w: 6.4, h: 0.92, fontFace: FONTE, fontSize: 10.5, color: COR.texto, margin: 0, valign: 'middle', fit: 'shrink', isTextBox: true });
  });
  if (!a.custos.length) semDados(s2, 4.0, 1.5, 8.7, 4.6, 'Nenhuma oportunidade calculada');

  const s3 = slideConteudo(pres, 'Metas sugeridas', `Mediana dos meses de ${d.ano} com 5% de melhora, nunca além do melhor mês já feito`);
  tabela(s3, 0.6, 1.5, [{ titulo: 'Indicador', w: 3.4 }, { titulo: abrev(d.am), w: 1.6, align: 'right' }, { titulo: `Mediana ${d.ano}`, w: 1.7, align: 'right' },
    { titulo: 'Melhor mês', w: 1.7, align: 'right' }, { titulo: 'Meta sugerida', w: 2.0, align: 'right' }, { titulo: 'Situação', w: 1.7, align: 'center' }],
  a.metas, { fonte: 11, alturaLinha: 0.45 });
  nota(s3, 'Sugestão para discussão. Ocorrências MOOV dependem dos parâmetros da plataforma; ajustar a meta quando a nova régua estabilizar.');
}

// Texto simples para colar no e-mail de envio
function resumoTexto(d, a) {
  const l = [`VISÃO OPERAÇÃO — ${nomeMes(d.am)}${d.previa ? ' (PRÉVIA)' : ''}`, ''];
  l.push('PONTOS POSITIVOS', ...a.positivos.map((t) => `- ${t}`), '');
  l.push('PONTOS DE MELHORIA', ...a.melhorias.map((t) => `- ${t}`), '');
  l.push(`OPORTUNIDADES DE REDUÇÃO DE CUSTO (estimativa ${reais(a.custos.reduce((t, c) => t + c.valor, 0))}/mês)`, ...a.custos.map((c) => `- ${c.titulo}: ${reais(c.valor)}. ${c.texto}`), '');
  l.push('METAS SUGERIDAS', ...a.metas.map((m) => `- ${m[0]}: meta ${m[4].text} (mês: ${m[1].text}; ${m[5].text.toLowerCase()})`), '');
  return l.join('\r\n');
}

// ---------------------------------------------------------------- principal
async function main() {
  const [arg1, arg2] = process.argv.slice(2);
  const cfg = lerConfig();
  let am = Number(arg1);
  if (!am) {
    const fechados = await rest(cfg, 'vo_periodos', 'select=ano_mes&status=eq.fechado&order=ano_mes.desc&limit=1');
    if (!fechados.length) throw new Error('Nenhum mes congelado na nuvem. Informe o mes: gerar_visao_operacao.bat 202610');
    am = fechados[0].ano_mes;
  }
  if (!(am > 202000 && am % 100 >= 1 && am % 100 <= 12)) throw new Error(`Mes invalido: ${arg1} (use AAAAMM, ex.: 202609)`);

  console.log(`Lendo os dados de ${nomeMes(am)}...`);
  const d = await VO.carregarDados((tabela, query) => rest(cfg, tabela, query), am);
  if (!d.periodo) throw new Error(`${nomeMes(am)} ainda nao tem foto na nuvem (vo_periodos). A sincronizacao roda todo dia as 06h20.`);

  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = `Visão Operação ${nomeMes(am)}`;
  pres.company = 'JR Distribuidora';
  pres.author = 'Jr-Oper';

  const analise = analisar(d);
  capa(pres, d);
  painel(pres, d);
  resumo(pres, d, analise);
  horasExtras(pres, d);
  movimentacao(pres, d);
  cortes(pres, d);
  inventario(pres, d);
  devolucao(pres, d);
  despesa(pres, d);
  abastecimento(pres, d);
  motoristas(pres, d);
  rastreamento(pres, d);
  sac(pres, d);
  slideImagem(pres, 'fim.jpg');

  const ano = Math.floor(am / 100), mes = String(am % 100).padStart(2, '0');
  const pasta = arg2 || path.join(PASTA_PADRAO, `${ano} - VISÃO OPERAÇÃO`);
  fs.mkdirSync(pasta, { recursive: true });
  const base = `${ano}.${mes} - Visão Operação${d.previa ? ' (prévia)' : ''}`;
  let saida = path.join(pasta, `${base}.pptx`);
  for (let n = 2; fs.existsSync(saida); n++) saida = path.join(pasta, `${base} (${n}).pptx`);
  await pres.writeFile({ fileName: saida });
  const txt = saida.replace(/\.pptx$/, ' - resumo.txt');
  fs.writeFileSync(txt, '﻿' + resumoTexto(d, analise), 'utf8');
  console.log(`\nPronto: ${saida}`);
  console.log(`Resumo para o e-mail: ${txt}`);
  // Versao corporativa em HTML (mesmos dados; abre no navegador, sem internet)
  const html = saida.replace(/.pptx$/, '.html');
  fs.writeFileSync(html, gerarHtml(d, analise, { logo: `data:image/png;base64,${fs.readFileSync(path.join(MODELO, 'logo.png')).toString('base64')}` }), 'utf8');
  console.log(`Versão HTML: ${html}`);
  if (d.previa) console.log('ATENCAO: o mes ainda nao foi congelado (congela no dia 3 do mes seguinte). Os numeros podem mudar.');
}

// exitCode em vez de process.exit: no Windows o exit com fetch aberto derruba o Node (libuv)
main().catch((e) => { console.error(`\nERRO: ${e.message}`); process.exitCode = 1; });
