// =============================================================================
// VISAO OPERACAO - PARTE COMUM (app e gerador) (28/10/2026, 6.9.4)
//
// Um arquivo so para a tela "Visao Operacao" do app (Visao Geral) e para o
// gerador tools/gerar_visao_operacao.js: carrega a "foto" mensal da nuvem
// (vo_indicadores / vo_quadros, gravados pela Edge Function sync-visao-operacao,
// mais prod_pontuacao, ocorrencias_devolucao e trocas_veiculos), faz a analise
// (pontos positivos, melhoria, custos, metas) e monta a pagina HTML com os
// graficos em SVG e rotulo de dados em todos. Assim a tela e o arquivo .html
// nunca saem diferentes.
//
// No navegador vira window.VisaoOperacao; no Node, require('../js/visaoOperacao.js').
// =============================================================================
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.VisaoOperacao = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const MES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
// Cores das metas no .pptx (hex sem #); a pagina usa as dela (CH)
const COR = { bom: '1B8A4C', ruim: 'C0392B' };

// ---------------------------------------------------------------- formatos
const nf = (casas) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const num = (v, casas = 0) => (v === null || v === undefined || isNaN(v) ? '—' : nf(casas).format(v));
const reais = (v, casas = 0) => (v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}R$ ${num(Math.abs(v), casas)}`);
const mil = (v, casas = 1) => (v === null || v === undefined ? '—' : `${num(v / 1000, casas)} mil`);
const pct = (v, casas = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : `${num(v * 100, casas)}%`);
const dataBr = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const diaMes = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const iso = (a, m, d) => new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10);
const mesAnterior = (am) => (am % 100 === 1 ? am - 89 : am - 1);
const nomeMes = (am) => `${MESES[(am % 100) - 1]}/${Math.floor(am / 100)}`;
const abrev = (am) => `${MES_ABREV[(am % 100) - 1]}/${String(Math.floor(am / 100)).slice(2)}`;
const titulo = (s) => String(s ?? '').toLowerCase().replace(/(^|\s|\/|\()\S/g, (c) => c.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (c) => c.toLowerCase())
  .replace(/\b(Rca|Cd|Jr|Ma|Pa|To)\b/g, (c) => c.toUpperCase());
// % so faz sentido sobre base positiva (saldo de inventario troca de sinal)
const variacao = (atual, base) => (atual === null || base === null || base === undefined || base <= 0 ? null : atual / base - 1);

// Texto de comparacao: "▲ 2,7% vs ano anterior". menorMelhor = custo/devolucao;
// null = so informativo (sem verde/vermelho).
function comparar(atual, base, rotuloBase, menorMelhor = true) {
  const v = variacao(atual, base);
  if (v === null) return null;
  const seta = v > 0 ? '▲' : v < 0 ? '▼' : '=';
  const bom = v === 0 || menorMelhor === null ? null : menorMelhor ? v < 0 : v > 0;
  return { texto: `${seta} ${num(Math.abs(v) * 100, 1)}% vs ${rotuloBase}`, bom };
}

// Horas decimais -> "399:00"
const hhmm = (h) => {
  if (h === null || h === undefined) return '—';
  // trunca os segundos, como o Power BI mostra (56:28:48 -> 56:28)
  const tot = Math.floor(h * 60 + 1e-6);
  return `${num(Math.floor(tot / 60))}:${String(tot % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- dados
// rest(tabela, query) -> linhas: no gerador e fetch com a chave publica; no app,
// o mesmo fetch com a config do cloudStore.
async function carregarDados(rest, am) {
  const a = Math.floor(am / 100), m = am % 100;
  const ant = mesAnterior(am);
  const desde = (a - 1) * 100 + 1;
  const [periodos, ind, quad, pontos, sac, trocas] = await Promise.all([
    rest('vo_periodos', 'select=ano_mes,status,congelado_em&order=ano_mes'),
    rest('vo_indicadores', `select=ano_mes,secao,indicador,valor,valor_atual&ano_mes=gte.${desde}&ano_mes=lte.${am}`),
    rest('vo_quadros', `select=secao,quadro,rotulo,ordem,valor,valor2,valor3&ano_mes=eq.${am}&order=secao,quadro,ordem`),
    rest('prod_pontuacao', `select=nome,cargo,setor,pontuacao,qtd_os,qtd_apanhos,kg_total,kg_entrada&ano_mes=eq.${am}`),
    rest('ocorrencias_devolucao', `select=tipo_erro,status_gestao,valor_reclamado,forma_acerto,data_entrada_cd,sem_itens&or=(is_deleted.is.null,is_deleted.is.false)&criado_em=gte.${iso(a, m - 1, 26)}&criado_em=lt.${iso(a, m, 26)}`),
    rest('trocas_veiculos', `select=data,veiculo_escalado,veiculo_trocado,motivo_resumido,motivo_outro,detalhamento,autorizado_por&or=(is_deleted.is.null,is_deleted.is.false)&data=gte.${iso(a, m, 1)}&data=lte.${iso(a, m + 1, 0)}&order=data.desc`),
  ]);
  const I = {}; // I[secao][indicador][ano_mes] = { valor, valor_atual }
  for (const r of ind) {
    ((I[r.secao] ||= {})[r.indicador] ||= {})[r.ano_mes] = { valor: num0(r.valor), valor_atual: num0(r.valor_atual) };
  }
  const Q = {}; // Q[secao][quadro] = [linhas]
  for (const r of quad) ((Q[r.secao] ||= {})[r.quadro] ||= []).push({ ...r, valor: num0(r.valor), valor2: num0(r.valor2), valor3: num0(r.valor3) });
  const per = periodos.find((p) => p.ano_mes === am);
  return {
    am, ant, ano: a, periodo: per, previa: !per || per.status !== 'fechado',
    statusAnt: (periodos.find((p) => p.ano_mes === ant) || {}).status,
    // valor do mes; v(secao, ind, mes = am)
    v: (sec, k, mes = am) => ((I[sec] || {})[k] || {})[mes]?.valor ?? null,
    atual: (sec, k, mes) => ((I[sec] || {})[k] || {})[mes]?.valor_atual ?? null,
    // meses do ano com valor (para medias)
    serie: (sec, k) => Object.entries((I[sec] || {})[k] || {}).filter(([mes]) => Math.floor(mes / 100) === a && Number(mes) <= am)
      .sort(([x], [y]) => x - y).map(([mes, o]) => ({ mes: Number(mes), valor: o.valor })),
    q: (sec, quadro) => (Q[sec] || {})[quadro] || [],
    pontos, sac, trocas,
  };
}
const num0 = (v) => (v === null || v === undefined ? null : Number(v));
const media = (lista) => { const vs = lista.map((l) => l.valor).filter((v) => v !== null); return vs.length ? vs.reduce((t, v) => t + v, 0) / vs.length : null; };

// ---------------------------------------------------------------- analise
// Regras fixas e explicaveis (nada de "IA" aqui): cada frase cita o numero e a
// referencia usada.
const mediana = (vs) => {
  const x = vs.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  if (!x.length) return null;
  const m = Math.floor(x.length / 2);
  return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2;
};

function analisar(d) {
  const positivos = [], melhorias = [], custos = [], metas = [];
  const v = (sec, k, mes) => d.v(sec, k, mes);
  const hist = (sec, k) => d.serie(sec, k).map((x) => x.valor);
  const mesAnt = nomeMes(d.ant).toLowerCase(), doAno = `a média de ${d.ano}`;

  // Compara o mes com o anterior e com a media do ano; vira ponto positivo ou de melhoria.
  const tendencia = (rot, sec, k, fmt, menorMelhor = true) => {
    const atual = v(sec, k), ant = v(sec, k, d.ant), med = media(d.serie(sec, k));
    const vAnt = variacao(atual, ant), vMed = variacao(atual, med);
    if (vAnt === null || vMed === null) return;
    const melhorAnt = menorMelhor ? vAnt < 0 : vAnt > 0, melhorMed = menorMelhor ? vMed < 0 : vMed > 0;
    const txtAnt = `${vAnt > 0 ? '+' : '−'}${num(Math.abs(vAnt) * 100, 1)}% vs ${mesAnt}`;
    const txtMed = `${vMed > 0 ? '+' : '−'}${num(Math.abs(vMed) * 100, 1)}% vs ${doAno}`;
    if (melhorAnt && melhorMed) positivos.push({ peso: Math.abs(vMed), texto: `${rot}: ${fmt(atual)} (${txtAnt}; ${txtMed}).` });
    else if (!melhorMed && Math.abs(vMed) >= 0.1) melhorias.push({ peso: Math.abs(vMed), texto: `${rot}: ${fmt(atual)}, ${txtMed}${melhorAnt ? '' : ` e ${txtAnt}`}.` });
  };
  tendencia('Hora extra (55%)', 'horas_extras', 'valor', (x) => reais(x));
  tendencia('Valor de cortes', 'cortes', 'valor', (x) => reais(x));
  tendencia('Pedidos cortados', 'cortes', 'pedidos', (x) => num(x));
  tendencia('Devolução', 'devolucao', 'valor', (x) => reais(x));
  tendencia('% devolução sobre faturamento', 'devolucao', 'pct_dev_fat', (x) => pct(x, 2));
  tendencia('Despesas de cartão', 'despesa', 'valor', (x) => reais(x));
  tendencia('Preço médio do combustível', 'abastecimento', 'preco_medio', (x) => `${reais(x, 2)}/L`);
  tendencia('Peso entregue pelos motoristas', 'motoristas', 'peso', (x) => `${num(x)} kg`, false);

  // Despesa e devolucao contra o mesmo mes do ano anterior
  const despLy = variacao(v('despesa', 'valor'), v('despesa', 'valor_ly'));
  const jaTemDespesa = positivos.some((p) => p.texto.startsWith('Despesas de cartão'));
  if (despLy !== null && despLy < 0 && !jaTemDespesa) positivos.push({ peso: Math.abs(despLy), texto: `Despesas ${num(Math.abs(despLy) * 100, 1)}% abaixo do mesmo mês de ${d.ano - 1} (${reais(v('despesa', 'valor'))} contra ${reais(v('despesa', 'valor_ly'))}).` });

  // Inventario: saldo do mes e do ano
  const invMes = (d.q('inventario', 'mes').find((x) => x.rotulo === `${d.ano}-${String(d.am % 100).padStart(2, '0')}`) || {}).valor ?? null;
  const sdAno = v('inventario', 'saldo'), sdLy = v('inventario', 'saldo_ly');
  if (invMes !== null) (invMes >= 0 ? positivos : melhorias).push({ peso: 0.5, texto: `Inventário do mês ${invMes >= 0 ? 'com rendimento' : 'com perda'} de ${reais(Math.abs(invMes))}; saldo no ano em ${reais(sdAno)}${sdLy !== null ? ` (${d.ano - 1}: ${reais(sdLy)} no mesmo período)` : ''}.` });

  // Cortes: dia fora da curva e produto que concentra
  const dias = d.q('cortes', 'dia'), totCorte = v('cortes', 'valor');
  const medDia = mediana(dias.map((x) => x.valor));
  const pico = dias.reduce((b, x) => (x.valor > (b?.valor ?? -1) ? x : b), null);
  if (pico && medDia && pico.valor >= 3 * medDia && totCorte) {
    melhorias.push({ peso: pico.valor / totCorte, texto: `Cortes: só o dia ${diaMes(pico.rotulo)} somou ${reais(pico.valor)} (${pct(pico.valor / totCorte, 0)} do período, ${num(pico.valor / medDia, 0)}× um dia típico). Vale apurar a causa.` });
  }
  const prod = d.q('cortes', 'produto')[0];
  if (prod && totCorte && prod.valor / totCorte >= 0.15) melhorias.push({ peso: prod.valor / totCorte, texto: `Cortes: ${titulo(prod.rotulo)} sozinho respondeu por ${pct(prod.valor / totCorte, 0)} do valor cortado (${reais(prod.valor)}).` });

  // Devolucao: parte que a logistica controla (motorista + carregamento)
  const resp = d.q('devolucao', 'responsavel'), totDev = resp.reduce((t, x) => t + (x.valor || 0), 0);
  const controlavel = resp.filter((x) => /MOTORISTA|CARREGAMENTO/i.test(x.rotulo)).reduce((t, x) => t + (x.valor || 0), 0);
  if (controlavel && totDev) {
    melhorias.push({ peso: controlavel / totDev, texto: `Devolução: ${reais(controlavel)} (${pct(controlavel / totDev, 0)} do valor) é de motorista ou carregamento, a parte que a logística controla.` });
    custos.push({ valor: controlavel / 2, titulo: 'Devolução controlável', texto: `Reduzir pela metade as devoluções de motorista e carregamento (${reais(controlavel)} no mês).` });
  }
  const mot = d.q('devolucao', 'motivo')[0];
  if (mot && totDev) melhorias.push({ peso: mot.valor / totDev * 0.8, texto: `Principal motivo de devolução: ${titulo(mot.rotulo)}, ${reais(mot.valor)} (${pct(mot.valor / totDev, 0)}).` });

  // Abastecimento: posto externo x interno e postos acima da media
  const ie = d.q('abastecimento', 'interno_externo');
  const ext = ie.find((x) => /EXTERNO/i.test(x.rotulo)), int = ie.find((x) => /INTERNO/i.test(x.rotulo));
  const pExt = ext && ext.valor2 ? ext.valor / ext.valor2 : null, pInt = int && int.valor2 ? int.valor / int.valor2 : null;
  if (pExt && pInt && pExt > pInt) {
    custos.push({ valor: (pExt - pInt) * ext.valor2 * 0.3, titulo: 'Abastecer mais no posto interno',
      texto: `Externo saiu a ${reais(pExt, 2)}/L contra ${reais(pInt, 2)}/L no interno (${num(ext.valor2)} L fora). Levar 30% desse volume para o interno.` });
  }
  // Postos externos caros: comparados com a media dos proprios externos (o interno nao serve de regua)
  const caros = pExt ? d.q('abastecimento', 'fornecedor').filter((x) => x.valor3 && x.valor2 >= 300 && x.valor3 > pExt + 0.3 && !/INTERNO/i.test(x.rotulo)) : [];
  if (caros.length) {
    const economia = caros.reduce((t, x) => t + (x.valor3 - pExt) * x.valor2, 0);
    custos.push({ valor: economia, titulo: 'Postos externos mais caros', texto: `${caros.length} posto(s) mais de R$ 0,30/L acima da média dos externos (${reais(pExt, 2)}/L): ${caros.slice(0, 3).map((x) => `${titulo(x.rotulo)} ${reais(x.valor3, 2)}`).join('; ')}. Negociar ou trocar de posto.` });
  }
  const minimo = v('abastecimento', 'preco_min');
  if (minimo !== null && minimo < 3) melhorias.push({ peso: 0.3, texto: `Abastecimento com preço de ${reais(minimo, 2)}/L no mês: quase certamente erro de lançamento, que distorce o preço médio.` });

  // Cortes: o que passou da mediana do ano
  const medCorte = mediana(hist('cortes', 'valor'));
  if (totCorte && medCorte && totCorte > medCorte) custos.push({ valor: totCorte - medCorte, titulo: 'Cortes acima do normal', texto: `Voltar o valor cortado à mediana do ano (${reais(medCorte)}).` });

  // Hora extra: setor que concentra e quanto passou da mediana do ano
  const heSetor = d.q('horas_extras', 'setor'), heTot = v('horas_extras', 'valor');
  if (heSetor[0] && heTot && heSetor[0].valor / heTot >= 0.35) melhorias.push({ peso: heSetor[0].valor / heTot * 0.8, texto: `Hora extra: ${titulo(heSetor[0].rotulo)} concentrou ${pct(heSetor[0].valor / heTot, 0)} do valor (${reais(heSetor[0].valor)}).` });
  const heMed = mediana(hist('horas_extras', 'valor'));
  if (heTot && heMed && heTot > heMed) custos.push({ valor: heTot - heMed, titulo: 'Hora extra acima do normal', texto: `Voltar a hora extra 55% à mediana do ano (${reais(heMed)}).` });

  // Despesa acima do ano anterior
  if (despLy !== null && despLy > 0) custos.push({ valor: v('despesa', 'valor') - v('despesa', 'valor_ly'), titulo: 'Despesa de cartão', texto: `Voltar ao gasto do mesmo mês de ${d.ano - 1} (${reais(v('despesa', 'valor_ly'))}).` });

  // MOOV e motoristas
  const oc = v('rastreamento', 'ocorrencias'), sv = v('rastreamento', 'sem_vinculo');
  if (oc && sv / oc > 0.15) melhorias.push({ peso: sv / oc, texto: `MOOV: ${pct(sv / oc, 0)} das ocorrências estão sem vínculo com viagem (meta ≤ 15%). Sem o vínculo não dá para cobrar o motorista.` });
  const motQ = d.q('motoristas', 'motorista');
  const abaixo = motQ.filter((x) => x.valor3 !== null && x.valor3 < 0.7);
  if (abaixo.length) melhorias.push({ peso: abaixo.length / Math.max(motQ.length, 1), texto: `${abaixo.length} de ${motQ.length} motoristas ficaram abaixo de 70% do garantido de ${num(v('motoristas', 'garantido'))} kg.` });

  // S.A.C.
  const conclu = d.sac.filter((o) => o.status_gestao === 'CONCLUIDO').length;
  if (d.sac.length) {
    const tx = conclu / d.sac.length;
    (tx >= 0.9 ? positivos : melhorias).push({ peso: 0.4, texto: `S.A.C.: ${conclu} de ${d.sac.length} ocorrências concluídas (${pct(tx, 0)}); ${d.sac.length - conclu} ainda aguardam o gestor.` });
  }

  // Metas: mediana dos meses do ano com 5% de melhora, nunca melhor que o melhor mes ja feito
  const meta = (rot, sec, k, fmt, menorMelhor = true, base = null) => {
    const vs = base || hist(sec, k);
    const med = mediana(vs);
    if (med === null) return;
    const melhor = menorMelhor ? Math.min(...vs.filter((x) => x !== null)) : Math.max(...vs.filter((x) => x !== null));
    let alvo = med * (menorMelhor ? 0.95 : 1.05);
    alvo = menorMelhor ? Math.max(alvo, melhor) : Math.min(alvo, melhor);
    const atual = base ? vs[vs.length - 1] : v(sec, k);
    const ok = atual !== null && (menorMelhor ? atual <= alvo : atual >= alvo);
    metas.push([rot, { text: fmt(atual), bold: true }, fmt(med), fmt(melhor), { text: `${menorMelhor ? '≤' : '≥'} ${fmt(alvo)}`, bold: true }, ok ? { text: 'Atingida', cor: COR.bom } : { text: 'Não atingida', cor: COR.ruim }]);
  };
  meta('Hora extra 55% (R$)', 'horas_extras', 'valor', (x) => reais(x));
  meta('Valor de cortes (R$)', 'cortes', 'valor', (x) => reais(x));
  meta('Pedidos cortados', 'cortes', 'pedidos', (x) => num(x));
  meta('Devolução (R$)', 'devolucao', 'valor', (x) => reais(x));
  meta('% devolução / faturamento', 'devolucao', 'pct_dev_fat', (x) => pct(x, 2));
  meta('Despesas de cartão (R$)', 'despesa', 'valor', (x) => reais(x));
  meta('Preço médio combustível (R$/L)', 'abastecimento', 'preco_medio', (x) => reais(x, 2));
  meta('Ocorrências MOOV', 'rastreamento', 'ocorrencias', (x) => num(x));
  if (oc) metas.push(['MOOV sem vínculo', { text: pct(sv / oc, 0), bold: true }, '—', '—', { text: '≤ 15%', bold: true }, sv / oc <= 0.15 ? { text: 'Atingida', cor: COR.bom } : { text: 'Não atingida', cor: COR.ruim }]);

  const ordena = (l) => l.sort((a, b) => b.peso - a.peso).slice(0, 6).map((x) => x.texto);
  return { positivos: ordena(positivos), melhorias: ordena(melhorias), custos: custos.filter((c) => c.valor > 1).sort((a, b) => b.valor - a.valor), metas };
}

// ---------------------------------------------------------------- pagina HTML
const CH = {
  azul: '#2E78D2', laranja: '#EA6A35', verde: '#1BB07B', ambar: '#EFA200', rosa: '#E87FA8', roxo: '#4C3AA8',
  marinho: '#0B3B73', texto: '#1B2A3A', suave: '#5B6B7B', grade: '#E3E8EE', bom: '#1B8A4C', ruim: '#C0392B', neutro: '#8A6D00',
};
const PALETA_H = [CH.azul, CH.laranja, CH.verde, CH.ambar, CH.rosa, CH.roxo, '#1AA3B8', '#7F8C8D'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const corta = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// ---------------------------------------------------------------- graficos SVG
// W = largura do cartao em px (g1 ~1180, g2 ~580, g3 ~340, g3 largo ~430): o
// desenho sai na escala 1:1 e o texto fica do mesmo tamanho na pagina toda.
// Todos recebem itens { rotulo, valor, texto? } — "texto" e o rotulo de dados
// (quando nao vem, usa fmt(valor)). Nenhum grafico sai sem rotulo.

function barrasH(itens, { fmt, cor = CH.azul, cores = null, larguraRot = 190, vazio = 'Sem dados no período', W = 580 } = {}) {
  if (!itens.length) return `<p class="vazio">${vazio}</p>`;
  const hb = 20, gap = 8, top = 6;
  const H = top + itens.length * (hb + gap);
  const max = Math.max(...itens.map((i) => Math.abs(i.valor || 0)), 1);
  const util = Math.max(W - larguraRot - 150, 40);
  const linhas = itens.map((i, k) => {
    const y = top + k * (hb + gap);
    const w = Math.max((Math.abs(i.valor || 0) / max) * util, 2);
    const c = cores ? cores[k % cores.length] : cor;
    return `<g><title>${esc(i.rotulo)}: ${esc(i.texto ?? fmt(i.valor))}</title>
      <text x="${larguraRot - 8}" y="${y + hb / 2 + 4}" class="cat" text-anchor="end">${esc(corta(i.rotulo, 30))}</text>
      <rect x="${larguraRot}" y="${y}" width="${w}" height="${hb}" rx="3" fill="${c}"/>
      <text x="${larguraRot + w + 6}" y="${y + hb / 2 + 4}" class="val">${esc(i.texto ?? fmt(i.valor))}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="graf" role="img">${linhas}</svg>`;
}

// Colunas (uma ou mais series), com valores negativos e rotulo em cada barra.
function colunas(cats, series, { fmt, altura = 280, girar = null, W = 580 } = {}) {
  if (!cats.length) return '<p class="vazio">Sem dados no período</p>';
  const todos = series.flatMap((s) => s.valores.map((v) => v || 0));
  const max = Math.max(0, ...todos), min = Math.min(0, ...todos);
  // com negativos, o rotulo vai abaixo da barra: abre espaco antes do nome do mes
  const topo = 34, base = min < 0 ? 96 : 46, esq = 8, dir = 8;
  const faixa = max - min || 1;
  const altUtil = altura - topo - base;
  const y = (v) => topo + ((max - v) / faixa) * altUtil;
  const larg = (W - esq - dir) / cats.length;
  const nS = series.length;
  const bw = Math.min((larg * 0.78) / nS, 46);
  const rot = girar ?? (larg / nS < 46);
  const fonteVal = cats.length * nS > 24 ? 8 : 9.5;
  let svg = `<line x1="${esq}" x2="${W - dir}" y1="${y(0)}" y2="${y(0)}" stroke="#B8C4D0" stroke-width="1"/>`;
  cats.forEach((c, i) => {
    const x0 = esq + i * larg + (larg - bw * nS) / 2;
    series.forEach((s, k) => {
      const v = s.valores[i] || 0, x = x0 + k * bw;
      const y1 = Math.min(y(v), y(0)), h = Math.max(Math.abs(y(v) - y(0)), 1);
      const txt = s.textos ? s.textos[i] : fmt(v);
      svg += `<g><title>${esc(c)} · ${esc(s.nome || '')}: ${esc(txt)}</title><rect x="${x + 1}" y="${y1}" width="${bw - 2}" height="${h}" rx="2" fill="${s.cor}"/>`;
      if (rot) {
        const yy = v >= 0 ? y1 - 4 : y1 + h + 4;
        svg += `<text class="val" font-size="${fonteVal}" transform="translate(${x + bw / 2 + 3},${yy}) rotate(-90)" text-anchor="${v >= 0 ? 'start' : 'end'}">${esc(txt)}</text>`;
      } else {
        svg += `<text class="val" font-size="${fonteVal}" x="${x + bw / 2}" y="${v >= 0 ? y1 - 5 : y1 + h + 12}" text-anchor="middle">${esc(txt)}</text>`;
      }
      svg += '</g>';
    });
    const xc = esq + i * larg + larg / 2;
    svg += larg < 34
      ? `<text class="cat" font-size="9" transform="translate(${xc + 3},${altura - base + 8}) rotate(-90)" text-anchor="end">${esc(c)}</text>`
      : `<text class="cat" x="${xc}" y="${altura - base + (min < 0 ? 84 : 18)}" text-anchor="middle">${esc(c)}</text>`;
  });
  const leg = nS > 1 ? `<div class="leg">${series.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>` : '';
  // Rotulos girados precisam de folga acima da maior barra
  return `${leg}<svg viewBox="0 ${rot ? -40 : 0} ${W} ${altura + (rot ? 40 : 0) + (larg < 34 ? 10 : 0)}" class="graf" role="img">${svg}</svg>`;
}

function rosca(itens, { fmt } = {}) {
  const lista = itens.filter((i) => (i.valor || 0) > 0);
  if (!lista.length) return '<p class="vazio">Sem dados no período</p>';
  const tot = lista.reduce((t, i) => t + i.valor, 0);
  const R = 92, r = 54, cx = 110, cy = 110;
  let ang = -Math.PI / 2, fatias = '', rotulos = '';
  lista.forEach((i, k) => {
    const frac = i.valor / tot, a2 = ang + frac * 2 * Math.PI, grande = frac > 0.5 ? 1 : 0;
    const p = (rad, ra) => `${cx + ra * Math.cos(rad)},${cy + ra * Math.sin(rad)}`;
    const cor = PALETA_H[k % PALETA_H.length];
    fatias += frac >= 0.999
      ? `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${cor}" stroke-width="${R - r}"/>`
      : `<path d="M${p(ang, R)} A${R},${R} 0 ${grande} 1 ${p(a2, R)} L${p(a2, r)} A${r},${r} 0 ${grande} 0 ${p(ang, r)} Z" fill="${cor}"><title>${esc(i.rotulo)}: ${esc(fmt(i.valor))}</title></path>`;
    if (frac >= 0.04) {
      const meio = (ang + a2) / 2, rm = (R + r) / 2;
      rotulos += `<text x="${cx + rm * Math.cos(meio)}" y="${cy + rm * Math.sin(meio) + 4}" text-anchor="middle" class="fatia">${Math.round(frac * 100)}%</text>`;
    }
    ang = a2;
  });
  const leg = lista.map((i, k) => `<li><i style="background:${PALETA_H[k % PALETA_H.length]}"></i><span class="n">${esc(i.rotulo)}</span><b>${esc(fmt(i.valor))}</b><em>${(i.valor / tot * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</em></li>`).join('');
  return `<div class="rosca"><svg viewBox="0 0 220 220" role="img">${fatias}${rotulos}</svg><ul>${leg}</ul></div>`;
}

// Linhas: a primeira serie leva rotulo em todos os pontos; as outras so no
// maior e no menor valor (com tres linhas de 30 dias, rotular tudo vira borrao).
function linhas(cats, series, { fmt, altura = 260, W = 580 } = {}) {
  if (!cats.length) return '<p class="vazio">Sem dados no período</p>';
  const topo = 24, base = 44, esq = 14, dir = 14;
  const todos = series.flatMap((s) => s.valores.filter((v) => v !== null && v !== undefined));
  const max = Math.max(...todos), min = Math.min(0, ...todos);
  const y = (v) => topo + ((max - v) / ((max - min) || 1)) * (altura - topo - base);
  const x = (i) => esq + (cats.length === 1 ? (W - esq - dir) / 2 : (i / (cats.length - 1)) * (W - esq - dir));
  let svg = `<line x1="${esq}" x2="${W - dir}" y1="${y(min)}" y2="${y(min)}" stroke="#B8C4D0"/>`;
  series.forEach((s, k) => {
    const pts = s.valores.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v), v]));
    svg += `<polyline fill="none" stroke="${s.cor}" stroke-width="2.2" points="${pts.filter(Boolean).map((p) => `${p[0]},${p[1]}`).join(' ')}"/>`;
    const vs = s.valores.filter((v) => v !== null && v !== undefined);
    const mx = Math.max(...vs), mn = Math.min(...vs);
    pts.forEach((p, i) => {
      if (!p) return;
      svg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.8" fill="${s.cor}"><title>${esc(cats[i])} · ${esc(s.nome || '')}: ${esc(fmt(p[2]))}</title></circle>`;
      const rotula = k === 0 || p[2] === mx || p[2] === mn;
      if (rotula) svg += `<text class="val" font-size="${cats.length > 20 ? 8 : 9.5}" x="${p[0]}" y="${p[1] + (k === 2 || (k === 1 && p[2] === mn) ? 13 : -7)}" text-anchor="middle" fill="${k ? s.cor : CH.texto}">${esc(fmt(p[2]))}</text>`;
    });
  });
  cats.forEach((c, i) => {
    svg += cats.length > 16
      ? `<text class="cat" font-size="9" transform="translate(${x(i) + 3},${altura - base + 8}) rotate(-90)" text-anchor="end">${esc(c)}</text>`
      : `<text class="cat" x="${x(i)}" y="${altura - base + 18}" text-anchor="middle">${esc(c)}</text>`;
  });
  const leg = series.length > 1 ? `<div class="leg">${series.map((s) => `<span><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')}</div>` : '';
  return `${leg}<svg viewBox="0 0 ${W} ${altura + (cats.length > 16 ? 10 : 0)}" class="graf" role="img">${svg}</svg>`;
}

// ---------------------------------------------------------------- blocos
const card = (titulo, corpo, classe = '') => `<div class="card ${classe}"><h3>${esc(titulo)}</h3>${corpo}</div>`;

function kpi(valor, rotulo, comp, corValor) {
  const cls = comp ? (comp.bom === true ? 'bom' : comp.bom === false ? 'ruim' : 'neutro') : '';
  return `<div class="kpi"><div class="v"${corValor ? ` style="color:${corValor}"` : ''}>${esc(valor)}</div><div class="r">${esc(rotulo)}</div>${comp && comp.texto ? `<div class="c ${cls}">${esc(comp.texto)}</div>` : ''}</div>`;
}

function secao(id, titulo, sub, corpo) {
  return `<section class="secao" id="${id}"><header><h2>${esc(titulo)}</h2><p>${esc(sub)}</p></header>${corpo}</section>`;
}

// ---------------------------------------------------------------- pagina
function gerarHtml(d, a, opcoes = {}) {
  const ano = d.ano, m = d.am % 100;
  const fech = `${dataBr(iso(ano, m - 1, 26))} a ${dataBr(iso(ano, m, 25))}`;
  const mesCheio = `${dataBr(iso(ano, m, 1))} a ${dataBr(iso(ano, m + 1, 0))}`;
  const v = (sec, k, mes) => d.v(sec, k, mes);
  const R0 = (x) => reais(x), N0 = (x) => num(x);
  const it = (lista, campo = 'valor', rot = (x) => x.rotulo) => lista.map((x) => ({ rotulo: rot(x), valor: x[campo] }));
  const logo = opcoes.logo || '';
  const indice = [];
  const partes = [];
  const add = (id, nome, html) => { indice.push([id, nome]); partes.push(html); };

  // Painel
  const painelItens = [
    ['Hora extra 55%', 'horas_extras', 'valor', R0, true], ['Corte (R$)', 'cortes', 'valor', R0, true], ['Pedidos cortados', 'cortes', 'pedidos', N0, true],
    ['Devolução (R$)', 'devolucao', 'valor', R0, true], ['% devolução / faturamento', 'devolucao', 'pct_dev_fat', (x) => pct(x, 2), true],
    ['Despesas de cartão', 'despesa', 'valor', R0, true], ['Abastecimento (R$)', 'abastecimento', 'valor', R0, true],
    ['Preço médio / L', 'abastecimento', 'preco_medio', (x) => reais(x, 2), true], ['Peso entregue (kg)', 'motoristas', 'peso', N0, false],
    ['Ocorrências MOOV', 'rastreamento', 'ocorrencias', N0, true],
  ];
  const painel = painelItens.map(([rot, sec, k, fmt, menor]) => {
    const at = v(sec, k), c1 = comparar(at, v(sec, k, d.ant), abrev(d.ant).toLowerCase(), menor), c2 = comparar(at, media(d.serie(sec, k)), `média ${ano}`, menor);
    const cls = (c) => (c ? (c.bom === true ? 'bom' : c.bom === false ? 'ruim' : 'neutro') : '');
    return `<div class="kpi"><div class="v">${esc(fmt(at))}</div><div class="r">${esc(rot)}</div>
      ${c1 ? `<div class="c ${cls(c1)}">${esc(c1.texto)}</div>` : ''}${c2 ? `<div class="c ${cls(c2)}">${esc(c2.texto)}</div>` : ''}</div>`;
  }).join('');
  add('painel', 'Painel', secao('painel', 'Painel do mês', `${nomeMes(d.am)} comparado ao mês anterior e à média de ${ano}`, `<div class="kpis k5">${painel}</div>`));

  // Resumo
  const lista = (l) => (l.length ? `<ul class="lista">${l.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="vazio">Nada a destacar no mês.</p>');
  const totCusto = a.custos.reduce((t, c) => t + c.valor, 0);
  const metas = `<table class="tab"><thead><tr><th>Indicador</th><th class="n">${abrev(d.am)}</th><th class="n">Mediana ${ano}</th><th class="n">Melhor mês</th><th class="n">Meta sugerida</th><th>Situação</th></tr></thead><tbody>${
    a.metas.map((r) => `<tr><td>${esc(r[0])}</td><td class="n"><b>${esc(r[1].text ?? r[1])}</b></td><td class="n">${esc(r[2])}</td><td class="n">${esc(r[3])}</td><td class="n"><b>${esc(r[4].text ?? r[4])}</b></td><td class="${/Atingida/.test(r[5].text) ? 'bom' : 'ruim'}">${esc(r[5].text)}</td></tr>`).join('')}</tbody></table>`;
  add('resumo', 'Resumo', secao('resumo', 'Resumo executivo', 'Leitura automática dos números · regras fixas, cada frase cita a referência',
    `<div class="grade g2">${card('Pontos positivos', lista(a.positivos), 'pos')}${card('Pontos de melhoria', lista(a.melhorias), 'neg')}</div>
     <div class="grade g2">${card(`Oportunidades de redução de custo · ${reais(totCusto)}/mês`, barrasH(a.custos.map((c) => ({ rotulo: c.titulo, valor: c.valor })), { fmt: R0, cor: CH.verde, larguraRot: 210 })
       + `<ul class="lista peq">${a.custos.map((c) => `<li><b>${esc(c.titulo)}:</b> ${esc(c.texto)}</li>`).join('')}</ul>`)}${card('Metas sugeridas', metas + '<p class="nota">Mediana do ano com 5% de melhora, nunca além do melhor mês já feito.</p>')}</div>`));

  // Hora extra
  {
    const setor = d.q('horas_extras', 'setor'), meses = d.q('horas_extras', 'mes').slice().sort((x, y) => x.ordem - y.ordem);
    const pessoas = d.q('horas_extras', 'funcionario').slice(0, 15), tot = v('horas_extras', 'valor');
    const v100 = v('horas_extras', 'valor_100');
    add('he', 'Hora extra', secao('he', 'Gestão de hora extra', `Visão ${fech} · Hora Extra 55%`,
      `<div class="kpis">${kpi(hhmm(v('horas_extras', 'horas')), 'Horas extras', comparar(v('horas_extras', 'horas'), v('horas_extras', 'horas', d.ant), 'mês anterior'))}
        ${kpi(reais(tot, 2), 'Valor', comparar(tot, v('horas_extras', 'valor', d.ant), 'mês anterior'))}
        ${kpi(reais(v('horas_extras', 'valor_ly'), 2), `Mesmo mês de ${ano - 1}`, comparar(tot, v('horas_extras', 'valor_ly'), String(ano - 1)))}
        ${kpi(num(v('horas_extras', 'funcionarios')), 'Funcionários com HE', v100 ? { texto: `+ HE 100%: ${reais(v100, 2)}`, bom: false } : null)}</div>
      <div class="grade g3">${card('Valor por setor', rosca(it(setor, 'valor', (x) => titulo(x.rotulo)), { fmt: (x) => reais(x) }))}
        ${card('Horas por setor', barrasH(setor.map((x) => ({ rotulo: titulo(x.rotulo).replace('Carregamento ', 'Carreg. '), valor: x.valor2, texto: `${hhmm(x.valor2)} h` })), { fmt: N0, larguraRot: 130, W: 340 }))}
        ${card('Valor HE por mês (R$)', colunas(meses.map((x) => `${MES_ABREV[Number(x.rotulo.slice(5)) - 1]}/${x.rotulo.slice(2, 4)}`), [{ nome: 'Valor', cor: CH.ambar, valores: meses.map((x) => x.valor) }], { fmt: N0, W: 340 }))}</div>
      <div class="grade g1">${card('Funcionários com mais hora extra (top 15)', barrasH(pessoas.map((x) => { const [st, nome] = x.rotulo.split(' | '); return { rotulo: `${titulo(nome || st)}`, valor: x.valor, texto: `${reais(x.valor, 2)} · ${hhmm(x.valor2)} h · ${pct(tot ? x.valor / tot : null, 1)}` }; }), { fmt: R0, cor: CH.ambar, larguraRot: 260, W: 1180 }))}</div>`));
  }

  // Movimentacao CD
  {
    const op = d.pontos.filter((p) => !/SUPERVISOR|ASSISTENTE/i.test(p.cargo || ''));
    const soma = (l, k) => l.reduce((t, p) => t + Number(p[k] || 0), 0);
    const kgTot = soma(op, 'kg_total');
    const porSetor = ['FRIO', 'SECO'].map((s) => ({ s, l: op.filter((p) => (p.setor || '').toUpperCase() === s) }));
    const topKg = op.filter((p) => p.kg_total).sort((x, y) => y.kg_total - x.kg_total).slice(0, 15);
    const topPt = op.filter((p) => p.pontuacao).sort((x, y) => y.pontuacao - x.pontuacao).slice(0, 15);
    add('mov', 'Movimentação', secao('mov', 'Movimentação CD — produtividade', `${fech} · ${op.length} colaboradores operacionais`,
      `<div class="kpis">${kpi(num(op.length), 'Colaboradores')}${kpi(`${num(kgTot)} kg`, 'Total movimentado')}${kpi(num(soma(op, 'qtd_os')), 'Ordens de serviço')}${kpi(num(soma(op, 'qtd_apanhos')), 'Apanhos')}</div>
      <div class="grade g3">${card('Kg por setor', rosca(porSetor.map((x) => ({ rotulo: x.s, valor: soma(x.l, 'kg_total') })), { fmt: (x) => `${num(x)} kg` }))}
        ${card('Ordens de serviço por setor', barrasH(porSetor.map((x) => ({ rotulo: x.s, valor: soma(x.l, 'qtd_os') })), { fmt: N0, larguraRot: 60, W: 340 }))}
        ${card('Apanhos por setor', barrasH(porSetor.map((x) => ({ rotulo: x.s, valor: soma(x.l, 'qtd_apanhos') })), { fmt: N0, larguraRot: 60, cor: CH.verde, W: 340 }))}</div>
      <div class="grade g2">${card('Quem mais movimentou (kg, top 15)', barrasH(topKg.map((p) => ({ rotulo: titulo(p.nome), valor: p.kg_total, texto: `${num(p.kg_total)} kg · ${pct(kgTot ? p.kg_total / kgTot : null, 1)}` })), { fmt: N0, larguraRot: 200 }))}
        ${card('Maiores pontuações (top 15)', barrasH(topPt.map((p) => ({ rotulo: titulo(p.nome), valor: p.pontuacao, texto: num(p.pontuacao, 1) })), { fmt: N0, cor: CH.roxo, larguraRot: 200 }))}</div>`));
  }

  // Cortes
  {
    const prod = d.q('cortes', 'produto'), dia = d.q('cortes', 'dia'), tot = v('cortes', 'valor');
    const serie = d.serie('cortes', 'valor');
    add('cortes', 'Cortes', secao('cortes', 'Gestão de cortes', fech,
      `<div class="kpis">${kpi(reais(tot), 'Corte (R$)', comparar(tot, v('cortes', 'valor', d.ant), 'mês anterior'))}${kpi(`${num(v('cortes', 'kg'))} kg`, 'Corte (kg)', comparar(v('cortes', 'kg'), v('cortes', 'kg', d.ant), 'mês anterior'))}
        ${kpi(num(v('cortes', 'pedidos')), 'Pedidos cortados', comparar(v('cortes', 'pedidos'), v('cortes', 'pedidos', d.ant), 'mês anterior'))}${kpi(reais(media(serie)), `Média mensal ${ano}`)}</div>
      <div class="grade g2">${card('Cortes por produto (R$, top 15)', barrasH(prod.map((x) => ({ rotulo: x.rotulo, valor: x.valor, texto: `${reais(x.valor)} · ${pct(tot ? x.valor / tot : null, 1)}` })), { fmt: R0, larguraRot: 230 }))}
        ${card('Valor de corte por dia (R$)', colunas(dia.map((x) => diaMes(x.rotulo)), [{ nome: 'Valor', cor: CH.laranja, valores: dia.map((x) => x.valor) }], { fmt: N0 }))}</div>
      <div class="grade g1">${card(`Valor de corte por mês em ${ano} (R$)`, colunas(serie.map((x) => MES_ABREV[(x.mes % 100) - 1]), [{ nome: 'Valor', cor: CH.laranja, valores: serie.map((x) => x.valor) }], { fmt: N0, altura: 230, W: 1180 }))}</div>`));
  }

  // Inventario
  {
    const ms = d.q('inventario', 'mes'), atual = ms.filter((x) => x.rotulo.startsWith(String(ano))), ant = ms.filter((x) => x.rotulo.startsWith(String(ano - 1)));
    const rot = atual.map((x) => MES_ABREV[Number(x.rotulo.slice(5)) - 1]);
    const sd = v('inventario', 'saldo'), ly = v('inventario', 'saldo_ly');
    const corS = (x) => (x === null ? null : x >= 0 ? CH.bom : CH.ruim);
    add('inv', 'Inventário', secao('inv', 'Gestão de inventários', `Acumulado de 01/01/${ano} a ${dataBr(iso(ano, m + 1, 0))}`,
      `<div class="kpis k5">${kpi(reais(sd), 'Saldo no ano', null, corS(sd))}${kpi(reais(ly), `Saldo ${ano - 1}`, null, corS(ly))}${kpi(reais(sd !== null && ly !== null ? sd - ly : null), 'Diferença para o ano anterior', null, corS(sd !== null && ly !== null ? sd - ly : null))}
        ${kpi(reais(v('inventario', 'perda')), 'Perda', null, CH.ruim)}${kpi(reais(v('inventario', 'rendimento')), 'Rendimento', null, CH.bom)}</div>
      <div class="grade g2">${card('Perda e rendimento por mês (R$)', colunas(rot, [{ nome: 'Perda', cor: CH.laranja, valores: atual.map((x) => x.valor2 || 0) }, { nome: 'Rendimento', cor: CH.azul, valores: atual.map((x) => x.valor3 || 0) }], { fmt: N0 }))}
        ${card('Saldo comparativo por mês (R$)', colunas(rot, [{ nome: String(ano - 1), cor: CH.marinho, valores: atual.map((x) => (ant.find((y) => y.rotulo.slice(5) === x.rotulo.slice(5)) || {}).valor || 0) }, { nome: String(ano), cor: CH.ambar, valores: atual.map((x) => x.valor || 0) }], { fmt: N0 }))}</div>`));
  }

  // Devolucao
  {
    const s = (k) => v('devolucao', k), ly = 'ano anterior';
    const resp = d.q('devolucao', 'responsavel'), totR = resp.reduce((t, x) => t + (x.valor || 0), 0);
    add('dev', 'Devolução', secao('dev', 'Acompanhamento de devolução', `${mesCheio} · Power BI (WinThor)`,
      `<div class="kpis k5">${kpi(reais(s('valor')), 'Devolução (R$)', comparar(s('valor'), s('valor_ly'), ly))}${kpi(`${num(s('kg'))} kg`, 'Devolução (kg)', comparar(s('kg'), s('kg_ly'), ly))}
        ${kpi(num(s('qtd')), 'Qtd devoluções', comparar(s('qtd'), s('qtd_ly'), ly))}${kpi(reais(s('ticket'), 2), 'Ticket médio', comparar(s('ticket'), s('ticket_ly'), ly))}
        ${kpi(pct(s('pct_dev_fat'), 2), '% dev / faturamento', { texto: `Faturamento ${reais(s('faturamento'))}`, bom: null })}</div>
      <div class="grade g2">${card('Por setor', rosca(it(d.q('devolucao', 'setor')), { fmt: R0 }))}${card('Responsável (R$)', barrasH(resp.map((x) => ({ rotulo: titulo(x.rotulo), valor: x.valor, texto: `${reais(x.valor)} · ${pct(totR ? x.valor / totR : null, 0)}` })), { fmt: R0, larguraRot: 150 }))}</div>
      <div class="grade g2">${card('Pareto por motivo (R$, top 12)', barrasH(d.q('devolucao', 'motivo').slice(0, 12).map((x) => ({ rotulo: titulo(x.rotulo), valor: x.valor, texto: `${reais(x.valor)} · ${pct(totR ? x.valor / totR : null, 0)}` })), { fmt: R0, cor: CH.ambar, larguraRot: 240 }))}
        ${card('Devolução por dia (R$)', colunas(d.q('devolucao', 'dia').map((x) => diaMes(x.rotulo)), [{ nome: 'Valor', cor: CH.ambar, valores: d.q('devolucao', 'dia').map((x) => x.valor) }], { fmt: N0 }))}</div>`));
  }

  // Despesa
  {
    const s = (k) => v('despesa', k), us = d.q('despesa', 'usuario'), tot = s('valor');
    add('desp', 'Despesas', secao('desp', 'Acompanhamento de despesas', `${mesCheio} · cartões Vólus e ValeCard`,
      `<div class="kpis">${kpi(reais(tot, 2), 'Valor total', comparar(tot, s('valor_ly'), 'ano anterior'))}${kpi(num(s('qtd')), 'Transações', comparar(s('qtd'), s('qtd_ly'), 'ano anterior'))}
        ${kpi(reais(s('ticket'), 2), 'Média por transação', comparar(s('ticket'), s('ticket_ly'), 'ano anterior'))}${kpi(reais(s('por_dia'), 2), 'Gasto por dia', comparar(s('por_dia'), s('por_dia_ly'), 'ano anterior'))}</div>
      <div class="grade g2">${card('Por departamento', rosca(it(d.q('despesa', 'departamento'), 'valor', (x) => titulo(x.rotulo)), { fmt: R0 }))}
        ${card('Usuários (top 15)', barrasH(us.map((x) => ({ rotulo: titulo(x.rotulo), valor: x.valor, texto: `${reais(x.valor)} · ${pct(tot ? x.valor / tot : null, 1)}` })), { fmt: R0, cor: CH.ambar, larguraRot: 210 }))}</div>
      <div class="grade g1">${card('Gasto por dia (R$)', colunas(d.q('despesa', 'dia').map((x) => diaMes(x.rotulo)), [{ nome: 'Valor', cor: CH.ambar, valores: d.q('despesa', 'dia').map((x) => x.valor) }], { fmt: N0, altura: 240, W: 1180 }))}</div>`));
  }

  // Abastecimento
  {
    const s = (k) => v('abastecimento', k), pr = d.q('abastecimento', 'preco_dia'), dia = d.q('abastecimento', 'dia');
    const forn = d.q('abastecimento', 'fornecedor').slice(0, 15), tot = s('valor');
    const fechAnt = v('abastecimento', 'valor', d.ant), atualAnt = d.atual('abastecimento', 'valor', d.ant);
    const ajuste = d.statusAnt === 'fechado' && fechAnt !== null && atualAnt !== null && Math.abs(atualAnt - fechAnt) >= 1
      ? `<p class="nota">Lançado após o fechamento de ${esc(nomeMes(d.ant).toLowerCase())}: ${atualAnt > fechAnt ? '+' : '−'}${esc(reais(Math.abs(atualAnt - fechAnt)))} (notas quinzenais).</p>` : '';
    const minimo = s('preco_min');
    add('abast', 'Abastecimento', secao('abast', 'Gestão de abastecimento', mesCheio,
      `<div class="kpis k5">${kpi(reais(tot), 'Valor total', comparar(tot, s('valor_lm'), 'mês anterior'))}${kpi(`${num(s('litros'))} L`, 'Litros', comparar(s('litros'), s('litros_lm'), 'mês anterior', null))}
        ${kpi(reais(s('preco_medio'), 2), 'Preço médio / L', comparar(s('preco_medio'), s('preco_medio_lm'), 'mês anterior'))}
        ${kpi(reais(minimo, 2), 'Preço mínimo / L', minimo !== null && minimo < 3 ? { texto: '⚠ abaixo de R$ 3: conferir lançamento', bom: false } : comparar(minimo, s('preco_min_lm'), 'mês anterior'))}
        ${kpi(reais(s('preco_max'), 2), 'Preço máximo / L', comparar(s('preco_max'), s('preco_max_lm'), 'mês anterior'))}</div>${ajuste}
      <div class="grade g1">${card('Abastecimento por dia (R$)', colunas(dia.map((x) => diaMes(x.rotulo)), [{ nome: 'Valor', cor: CH.ambar, valores: dia.map((x) => x.valor) }], { fmt: N0, W: 1180, altura: 260 }))}</div>
      <div class="grade g1">${card('Preço por litro por dia (R$)', linhas(pr.map((x) => diaMes(x.rotulo)), [{ nome: 'Médio', cor: CH.azul, valores: pr.map((x) => x.valor) }, { nome: 'Mínimo', cor: CH.verde, valores: pr.map((x) => x.valor2) }, { nome: 'Máximo', cor: CH.laranja, valores: pr.map((x) => x.valor3) }], { fmt: (x) => num(x, 2), W: 1180, altura: 300 }))}</div>
      <div class="grade g3">${card('Postos (R$, top 15)', barrasH(forn.map((x) => ({ rotulo: titulo(x.rotulo), valor: x.valor, texto: `${reais(x.valor)} · ${num(x.valor3, 2)}/L` })), { fmt: R0, cor: CH.ambar, larguraRot: 150, W: 430 }), 'largo')}
        ${card('Por combustível', rosca(it(d.q('abastecimento', 'combustivel')), { fmt: R0 }))}
        ${card('Posto interno x externo', rosca(it(d.q('abastecimento', 'interno_externo'), 'valor', (x) => titulo(x.rotulo)), { fmt: R0 }))}</div>`));
  }

  // Motoristas
  {
    const mot = d.q('motoristas', 'motorista'), aj = d.q('motoristas', 'ajudante');
    const faixa = (l) => [
      { rotulo: '≥ 100% do garantido', valor: l.filter((x) => x.valor3 >= 1).length },
      { rotulo: '70% a 99%', valor: l.filter((x) => x.valor3 >= 0.7 && x.valor3 < 1).length },
      { rotulo: 'Abaixo de 70%', valor: l.filter((x) => x.valor3 !== null && x.valor3 < 0.7).length },
    ].map((f) => ({ ...f, texto: `${f.valor} · ${pct(l.length ? f.valor / l.length : null, 0)}` }));
    const top = (l) => l.slice(0, 15).map((x) => ({ rotulo: titulo(x.rotulo.replace(/^AJD\.?\s*MOT\.?\s*/i, '')), valor: x.valor, texto: `${num(x.valor)} kg · ${pct(x.valor3, 0)}` }));
    const serie = d.serie('motoristas', 'peso');
    add('mot', 'Motoristas', secao('mot', 'Gestão de motoristas & ajudantes', `${mesCheio} · garantido ${num(v('motoristas', 'garantido'))} kg`,
      `<div class="kpis">${kpi(`${num(v('motoristas', 'peso'))} kg`, 'Peso entregue', comparar(v('motoristas', 'peso'), v('motoristas', 'peso', d.ant), 'mês anterior', false))}
        ${kpi(num(v('motoristas', 'viagens')), 'Viagens', comparar(v('motoristas', 'viagens'), v('motoristas', 'viagens', d.ant), 'mês anterior', false))}
        ${kpi(num(v('motoristas', 'motoristas_ativos')), 'Motoristas ativos')}${kpi(num(v('motoristas', 'ajudantes_ativos')), 'Ajudantes ativos')}</div>
      <div class="grade g2">${card('Motoristas por faixa do garantido', barrasH(faixa(mot), { fmt: N0, cores: [CH.bom, CH.ambar, CH.ruim], larguraRot: 170 }))}
        ${card('Ajudantes por faixa do garantido', barrasH(faixa(aj), { fmt: N0, cores: [CH.bom, CH.ambar, CH.ruim], larguraRot: 170 }))}</div>
      <div class="grade g2">${card('Motoristas com mais peso (top 15)', barrasH(top(mot), { fmt: N0, larguraRot: 210 }))}${card('Ajudantes com mais peso (top 15)', barrasH(top(aj), { fmt: N0, cor: CH.laranja, larguraRot: 210 }))}</div>
      <div class="grade g1">${card(`Peso entregue por mês em ${ano} (kg)`, colunas(serie.map((x) => MES_ABREV[(x.mes % 100) - 1]), [{ nome: 'Peso', cor: CH.azul, valores: serie.map((x) => x.valor) }], { fmt: N0, altura: 230, W: 1180 }))}</div>`));
  }

  // Rastreamento
  {
    const oc = v('rastreamento', 'ocorrencias'), sv = v('rastreamento', 'sem_vinculo'), dia = d.q('rastreamento', 'dia');
    const tr = d.trocas;
    const motivoTroca = {};
    for (const t of tr) { const k = titulo(((t.motivo_resumido === 'OUTRO' ? t.motivo_outro : t.motivo_resumido) || 'Sem motivo').replace(/_/g, ' ')); motivoTroca[k] = (motivoTroca[k] || 0) + 1; }
    add('moov', 'Rastreamento', secao('moov', 'Gestão MOOV — rastreamento', `${mesCheio} · parâmetros da plataforma mudaram recentemente: comparar meses com cuidado`,
      `<div class="kpis">${kpi(num(oc), 'Ocorrências', comparar(oc, v('rastreamento', 'ocorrencias', d.ant), 'mês anterior'), CH.laranja)}
        ${kpi(pct(oc ? sv / oc : null, 1), 'Sem vínculo com viagem', { texto: `${num(sv)} sem motorista · meta ≤ 15%`, bom: oc ? sv / oc <= 0.15 : null })}
        ${kpi(num(tr.length), 'Trocas de veículo', null)}</div>
      <div class="grade g3">${card('Por motivo', rosca(it(d.q('rastreamento', 'motivo'), 'valor', (x) => titulo(x.rotulo)), { fmt: N0 }))}${card('Por vínculo', rosca(it(d.q('rastreamento', 'vinculo')), { fmt: N0 }))}
        ${card('Trocas de veículo por motivo', barrasH(Object.entries(motivoTroca).sort((x, y) => y[1] - x[1]).map(([k, n]) => ({ rotulo: k, valor: n })), { fmt: N0, cor: CH.roxo, larguraRot: 130, vazio: 'Nenhuma troca no mês', W: 340 }))}</div>
      <div class="grade g1">${card('Ocorrências por dia', linhas(dia.map((x) => diaMes(x.rotulo)), [{ nome: 'Ocorrências', cor: CH.laranja, valores: dia.map((x) => x.valor) }], { fmt: N0, altura: 230, W: 1180 }))}</div>
      <div class="grade g2">${card('Motorista responsável (top)', barrasH(d.q('rastreamento', 'motorista').filter((x) => x.rotulo !== '(Em branco)').map((x) => ({ rotulo: titulo(x.rotulo), valor: x.valor, texto: `${num(x.valor)} · ${pct(oc ? x.valor / oc : null, 1)}` })), { fmt: N0, cor: CH.laranja, larguraRot: 220 }))}
        ${card('Faixas de horário com mais ocorrências', barrasH(d.q('rastreamento', 'faixa_horaria').slice(0, 10).map((x) => ({ rotulo: x.rotulo, valor: x.valor, texto: `${num(x.valor)} · ${pct(oc ? x.valor / oc : null, 1)}` })), { fmt: N0, cor: CH.laranja, larguraRot: 60 }))}</div>`));
  }

  // S.A.C.
  {
    const oc = d.sac, concl = oc.filter((o) => o.status_gestao === 'CONCLUIDO').length;
    const valor = oc.reduce((t, o) => t + Number(o.valor_reclamado || 0), 0);
    const porTipo = {};
    for (const o of oc) { const t = o.tipo_erro || 'SEM TIPO'; (porTipo[t] ||= { qtd: 0, valor: 0 }); porTipo[t].qtd++; porTipo[t].valor += Number(o.valor_reclamado || 0); }
    const tipos = Object.entries(porTipo).sort((x, y) => y[1].qtd - x[1].qtd);
    const rotT = (t) => t.charAt(0) + t.slice(1).toLowerCase();
    add('sac', 'S.A.C.', secao('sac', 'S.A.C. & monitoramento', `${fech} · ocorrências lançadas no Jr-Oper`,
      `<div class="kpis k5">${kpi(num(oc.length), 'Ocorrências')}${kpi(num(concl), 'Concluídas', { texto: `${pct(oc.length ? concl / oc.length : null, 0)} do total`, bom: null }, CH.bom)}
        ${kpi(num(oc.length - concl), 'Aguardando gestor', null, CH.neutro)}${kpi(num(oc.filter((o) => !o.data_entrada_cd && !o.sem_itens).length), 'Físico pendente', null, CH.neutro)}${kpi(reais(valor), 'Valor reclamado')}</div>
      <div class="grade g2">${card('Ocorrências por tipo de erro', barrasH(tipos.map(([t, o]) => ({ rotulo: rotT(t), valor: o.qtd, texto: `${o.qtd} · ${pct(oc.length ? o.qtd / oc.length : null, 0)}` })), { fmt: N0, cores: PALETA_H, larguraRot: 190 }))}
        ${card('Valor reclamado por tipo de erro', barrasH(tipos.slice().sort((x, y) => y[1].valor - x[1].valor).map(([t, o]) => ({ rotulo: rotT(t), valor: o.valor, texto: `${reais(o.valor)} · ${pct(valor ? o.valor / valor : null, 0)}` })), { fmt: R0, cor: CH.marinho, larguraRot: 190 }))}</div>
      <p class="nota">Valor reclamado é o informado na abertura. Erro industrial e comercial são tratados por outra gerência; desconto de produtividade só cabe a motorista e carregamento.</p>`));
  }

  const hoje = new Date().toLocaleDateString('pt-BR');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visão Operação ${esc(nomeMes(d.am))}</title>
<style>
:root{--marinho:#0B3B73;--azul:#0E5BA8;--texto:#1B2A3A;--suave:#5B6B7B;--fundo:#EEF2F6;--card:#FFFFFF;--borda:#D9E1EA;--bom:#1B8A4C;--ruim:#C0392B;--neutro:#8A6D00}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font-family:"Segoe UI",Arial,sans-serif;font-size:14px}
.topo{background:linear-gradient(120deg,var(--marinho),var(--azul));color:#fff;padding:22px 32px;display:flex;align-items:center;gap:24px}
.topo img{height:58px}.topo h1{margin:0;font-size:26px;letter-spacing:.3px}.topo p{margin:4px 0 0;color:#D6E2F0}
.selo{margin-left:auto;background:${d.previa ? '#EFA200' : 'rgba(255,255,255,.15)'};color:#fff;padding:6px 12px;border-radius:20px;font-weight:600;font-size:12px;white-space:nowrap}
nav{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--borda);display:flex;gap:4px;overflow-x:auto;padding:0 24px}
nav a{color:var(--suave);text-decoration:none;padding:12px 10px;font-weight:600;font-size:13px;white-space:nowrap;border-bottom:3px solid transparent}nav a:hover{color:var(--marinho);border-color:var(--azul)}
main{max-width:1280px;margin:0 auto;padding:8px 24px 40px}
.secao{margin-top:28px}.secao>header{border-left:5px solid var(--azul);padding-left:12px;margin-bottom:14px}
.secao h2{margin:0;font-size:21px;color:var(--marinho)}.secao header p{margin:3px 0 0;color:var(--suave)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}.kpis.k5{grid-template-columns:repeat(5,1fr)}
.kpi{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px 16px}
.kpi .v{font-size:24px;font-weight:700;line-height:1.15}.kpi .r{font-weight:600;margin-top:4px}.kpi .c{font-size:12px;margin-top:3px}
.bom{color:var(--bom)}.ruim{color:var(--ruim)}.neutro{color:var(--suave)}
.grade{display:grid;gap:14px;margin-bottom:14px}.g1{grid-template-columns:1fr}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1.25fr 1fr 1fr}
.card{background:var(--card);border:1px solid var(--borda);border-radius:10px;padding:14px 16px;min-width:0}
.card h3{margin:0 0 10px;font-size:14px;color:var(--marinho)}.card.pos h3{color:var(--bom)}.card.neg h3{color:var(--ruim)}
.graf{width:100%;height:auto;display:block;overflow:visible}.graf .cat{font-size:11px;fill:var(--suave)}.graf .val{font-size:10.5px;fill:var(--texto);font-weight:600}
.rosca{display:flex;align-items:center;gap:12px}.g3 .card:not(.largo) .rosca{flex-direction:column;align-items:stretch}.g3 .card:not(.largo) .rosca svg{width:62%;margin:0 auto}.rosca svg{width:44%;max-width:210px;flex:none}.rosca .fatia{fill:#fff;font-size:12px;font-weight:700}
.rosca ul{list-style:none;margin:0;padding:0;flex:1;min-width:0}.rosca li{display:grid;grid-template-columns:12px 1fr auto auto;gap:6px;align-items:center;font-size:12px;padding:3px 0;border-bottom:1px solid #F0F3F6}
.rosca li i,.leg i{display:inline-block;width:10px;height:10px;border-radius:2px}.rosca li .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rosca li em{color:var(--suave);font-style:normal;min-width:44px;text-align:right}
.leg{display:flex;gap:14px;font-size:12px;color:var(--suave);margin-bottom:4px}.leg span{display:flex;align-items:center;gap:5px}
.lista{margin:0;padding-left:18px}.lista li{margin:6px 0;line-height:1.4}.lista.peq li{font-size:12.5px}
.tab{width:100%;border-collapse:collapse;font-size:12.5px}.tab th{background:var(--marinho);color:#fff;text-align:left;padding:7px 8px;font-weight:600}
.tab td{padding:6px 8px;border-bottom:1px solid #EEF2F6}.tab .n{text-align:right}.nota{color:var(--suave);font-size:12px;font-style:italic;margin:6px 0 0}
.vazio{color:var(--suave);text-align:center;padding:30px 0}
footer{max-width:1280px;margin:0 auto;padding:16px 24px 30px;color:var(--suave);font-size:12px}
@media (max-width:900px){.kpis,.kpis.k5{grid-template-columns:repeat(2,1fr)}.g2,.g3{grid-template-columns:1fr}.topo{flex-wrap:wrap;padding:18px 16px}main{padding:8px 16px 30px}nav{padding:0 8px}.selo{margin-left:0}}
@media print{nav{display:none}body{background:#fff}.secao{break-before:page}.secao:first-of-type{break-before:auto}.card,.kpi{break-inside:avoid}.topo{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="topo">${logo ? `<img src="${logo}" alt="JR Distribuidora">` : ''}<div><h1>Visão Operação · ${esc(nomeMes(d.am))}</h1><p>Logística · gerado em ${hoje} a partir do Power BI e do Jr-Oper</p></div>
<span class="selo">${d.previa ? 'PRÉVIA · números ainda abertos' : 'Mês fechado'}</span></div>
<nav>${indice.map(([id, nome]) => `<a href="#${id}">${esc(nome)}</a>`).join('')}</nav>
<main>${partes.join('\n')}</main>
<footer>JR Distribuidora · Visão Operação ${esc(nomeMes(d.am))}. Cortes, hora extra e S.A.C.: 26 do mês anterior a 25; devolução, despesa, abastecimento, motoristas e MOOV: mês cheio; inventário: acumulado do ano.</footer>
</body></html>`;
}


return {
  MESES, MES_ABREV, nf, num, reais, mil, pct, dataBr, diaMes, iso, mesAnterior, nomeMes, abrev, titulo, variacao,
  comparar, media, mediana, hhmm, carregarDados, analisar, gerarHtml,
};
});
