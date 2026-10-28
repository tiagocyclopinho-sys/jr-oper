// =============================================================================
// GERADOR DA PLANILHA DE PAGAMENTO DE PRODUTIVIDADE (24/10/2026)
//
// Copia a planilha do mes anterior (o "modelo"), troca a aba BD Funcionario
// pelo cadastro mestre (10 - POWER BI\03 - Produtividade\BD Funcionario\
// Funcionarios.xlsx) e preenche sozinho, direto da nuvem do Jr-Oper (Supabase):
//   - aba Pontos ........ pontuacao geral (prod_pontuacao, vinda do Power BI)
//   - aba Producao ...... Qtd OS, Qtd Peso, Qtd Apanho, Peso Entrada
//   - aba Ocorrencia .... devolucoes ERRO CARREGAMENTO do periodo, todas com
//                         Status PROCEDENTE (decisao de 24/10/2026: quem da o
//                         resultado final e a gerencia geral, que troca para
//                         IMPROCEDENTE se for o caso - a caixinha de desconto
//                         do gestor no app NAO decide o Status)
// e liga a aba Demonstrativo a aba Calculo (antes era colada a mao).
// Pontos e Producao levam so quem tem ELEGIBILIDADE = OK no cadastro;
// INATIVO, EXPERIENCIA e SUPERVISAO ficam fora (seguem so na tela do app).
//
// Ficam para preencher a mao, como combinado:
//   - Ocorrencia, colunas Status e Gravidade (LEVE / MEDIA / GRAVE) - resultado
//     final da gerencia geral
//   - aba Oc. RH - fecha so na 2a feira
//
// Este script NAO calcula valores em R$: so coloca pontos, producao e
// ocorrencias. Tetos, descontos e pagamento continuam nas formulas da propria
// planilha (abas BD Funcionario e Calculo), que o Excel recalcula ao abrir.
// A coluna "Valor Reclamado (R$)" da aba Ocorrencia e o valor da devolucao
// no Jr-Oper (pedido do gerente para medir o impacto ao avaliar a gravidade);
// nao entra em nenhuma conta de pagamento.
//
// Uso (precisa do Node instalado):
//   node tools/gerar_planilha_produtividade.js [AAAAMM] [modelo.xlsx] [saida.xlsx]
//   AAAAMM ...... mes de fechamento (ex.: 202610 = 26/09 a 25/10). Sem ele,
//                 usa o mais recente da nuvem.
//   modelo ...... sem ele, usa a planilha do mes anterior na pasta de pagamento.
//   saida ....... sem ela, grava "AAAA.MM - PAGAMENTO DE PRODUTIVIDADE.xlsx"
//                 (o mesmo mes do fechamento) na mesma pasta do modelo.
//                 Nunca sobrescreve um arquivo que ja existe.
// =============================================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// tar do proprio Windows (o do Git Bash nao entende C:\ nem zip).
const TAR_WIN = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const TAR = process.platform === 'win32' && fs.existsSync(TAR_WIN) ? TAR_WIN : 'tar';
const PASTA_PADRAO = 'S:\\Logistica\\01 - LOGISTICA INFORMATIVO\\00 - PAGAMENTO DE PRODUTIVIDADE\\02 - PAGAMENTO DE PRODUTIVIDADE';
// Cadastro mestre de funcionarios (o mesmo que o Power BI le).
const ARQ_FUNCIONARIOS = 'S:\\Logistica\\01 - LOGISTICA INFORMATIVO\\10 - POWER BI\\03 - Produtividade\\BD Funcionário\\Funcionários.xlsx';

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

// ----------------------------------------------------------------- XML helpers
const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNum = c => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colDe = ref => ref.replace(/\d+/g, '');

function lerLinhas(xml) {
  const ini = xml.indexOf('<sheetData>'), fim = xml.indexOf('</sheetData>');
  const corpo = xml.slice(ini + 11, fim);
  const linhas = new Map();
  const re = /<row r="(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let m;
  while ((m = re.exec(corpo))) {
    const celulas = [];
    const reC = /<c r="([A-Z]+\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = reC.exec(m[4] || ''))) celulas.push({ col: colDe(c[1]), attrs: c[2], xml: c[0] });
    linhas.set(Number(m[1]), { attrs: m[2], celulas });
  }
  return { antes: xml.slice(0, ini), depois: xml.slice(fim + 12), linhas };
}

function montarXml(p) {
  const nums = [...p.linhas.keys()].sort((a, b) => a - b);
  const corpo = nums.map(r => {
    const l = p.linhas.get(r);
    const cel = l.celulas.slice().sort((a, b) => colNum(a.col) - colNum(b.col)).map(c => c.xml).join('');
    return cel ? `<row r="${r}"${l.attrs}>${cel}</row>` : `<row r="${r}"${l.attrs}/>`;
  }).join('');
  return `${p.antes}<sheetData>${corpo}</sheetData>${p.depois}`;
}

const estilo = attrs => (attrs.match(/ s="(\d+)"/) || [])[1];
const formula = xml => (xml.match(/<f>([\s\S]*?)<\/f>/) || [])[1];

function celula(ref, s, v) {
  const st = s ? ` s="${s}"` : '';
  if (v === null || v === undefined || v === '') return `<c r="${ref}"${st}/>`;
  if (typeof v === 'object' && v.f) return `<c r="${ref}"${st}><f>${v.f}</f></c>`;
  if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// Reescreve as linhas [primeira .. ] das colunas cols de uma aba. O estilo e
// as formulas de cada coluna vem da primeira linha do modelo (e da ultima,
// para a ultima linha, que costuma ter borda). Celulas fora de cols (ex.: as
// observacoes ao lado da tabela de Pontos) ficam como estao.
// valores(i) devolve { COL: valor } ou { COL: {f:'formula'} }; null = vazio.
function reescrever(p, { primeira, ultimaModelo, cols, total, minimo = 0, valores }) {
  const dentro = c => cols.includes(c);
  const modelo = r => {
    const out = {};
    (p.linhas.get(r) || { celulas: [] }).celulas.forEach(c => { out[c.col] = { s: estilo(c.attrs), f: formula(c.xml) }; });
    return out;
  };
  const mPrim = modelo(primeira), mSeg = modelo(primeira + 1), mUlt = modelo(ultimaModelo);
  const attrsPrim = (p.linhas.get(primeira) || { attrs: '' }).attrs;
  const attrsUlt = (p.linhas.get(ultimaModelo) || { attrs: attrsPrim }).attrs;
  const linhasNovas = Math.max(total, minimo);
  const ate = Math.max(ultimaModelo, primeira + linhasNovas - 1);
  for (let r = primeira; r <= ate; r++) {
    const i = r - primeira;
    const atual = p.linhas.get(r) || { attrs: attrsPrim, celulas: [] };
    const fora = atual.celulas.filter(c => !dentro(c.col));
    if (i >= linhasNovas) { p.linhas.set(r, { attrs: atual.attrs, celulas: fora }); continue; }
    const ultima = i === linhasNovas - 1;
    const m = ultima ? mUlt : (i % 2 ? mSeg : mPrim);
    const v = i < total ? valores(i) : {};
    const novas = cols.map(col => {
      const mc = m[col] || mPrim[col] || {};
      let val = v[col];
      if (val === undefined && mc.f && i < total) val = { f: mc.f.replace(/<\/?[^>]+>/g, '') };
      return { col, xml: celula(col + r, mc.s, val) };
    });
    const attrs = (ultima ? attrsUlt : atual.attrs).replace(/ spans="[^"]*"/, '');
    p.linhas.set(r, { attrs, celulas: fora.concat(novas) });
  }
  return primeira + total - 1; // ultima linha com dados
}

function ajustarTabela(xmlTabela, ref) {
  return xmlTabela
    .replace(/(<table [^>]*? ref=")[^"]*"/, `$1${ref}"`)
    .replace(/(<autoFilter ref=")[^"]*"/, `$1${ref}"`)
    .replace(/<sortState[\s\S]*?<\/sortState>/, '');
}

// ----------------------------------------------------------------- principal
async function main() {
  const [argMes, argModelo, argSaida] = process.argv.slice(2);
  const cfg = lerConfig();

  const periodos = await rest(cfg, 'prod_periodos', 'select=*&order=ano_mes.desc');
  // Sem AAAAMM: o ultimo mes que ja terminou (fim antes de hoje). O mes
  // seguinte aparece no Power BI logo no dia 26 e nao e o que se fecha agora.
  const hoje = new Date().toISOString().slice(0, 10);
  const per = argMes ? periodos.find(p => String(p.ano_mes) === String(argMes))
    : (periodos.find(p => p.fim < hoje) || periodos[0]);
  if (!per) throw new Error(`Mes de fechamento ${argMes} nao existe na nuvem.`);
  console.log(`Mes de fechamento: ${per.rotulo} (${per.inicio} a ${per.fim}) - status: ${per.status}`);
  if (per.status === 'aberto') console.log('  ATENCAO: mes ainda ABERTO - os pontos sao previa e mudam a cada sincronizacao.');

  // O nome do arquivo e o mes de fechamento: 2026.10 = OUT 26 (26/09 a 25/10).
  // Modelo: a planilha mais recente da pasta ANTERIOR a esse mes.
  const ano = Math.floor(per.ano_mes / 100), mes = per.ano_mes % 100;
  const nomeArq = `${ano}.${String(mes).padStart(2, '0')} - PAGAMENTO DE PRODUTIVIDADE.xlsx`;
  let modelo = argModelo;
  if (!modelo) {
    const cands = [];
    for (const ano of fs.readdirSync(PASTA_PADRAO)) {
      const dir = path.join(PASTA_PADRAO, ano);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) if (/^\d{4}\.\d{2} - PAGAMENTO DE PRODUTIVIDADE\.xlsx$/i.test(f)) cands.push(path.join(dir, f));
    }
    cands.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
    while (cands.length && path.basename(cands[cands.length - 1]).localeCompare(nomeArq) >= 0) cands.pop();
    modelo = cands.pop();
    if (!modelo) throw new Error('Nao achei nenhuma planilha de pagamento para usar de modelo.');
  }
  const pastaAno = path.join(PASTA_PADRAO, `${ano} - PAGAMENTO DE PRODUTIVIDADE`);
  const saida = argSaida || path.join(fs.existsSync(pastaAno) ? pastaAno : path.dirname(modelo), nomeArq);
  if (path.resolve(saida) === path.resolve(modelo)) throw new Error('A saida nao pode ser o proprio modelo.');
  if (fs.existsSync(saida)) throw new Error(`Ja existe: ${saida}\nApague/renomeie antes, ou passe outro nome de saida.`);
  console.log(`Modelo: ${modelo}`);

  // Dados da nuvem.
  const pontos = await rest(cfg, 'prod_pontuacao', `select=*&ano_mes=eq.${per.ano_mes}&order=pontuacao.desc.nullslast&limit=5000`);
  const fimMais1 = new Date(per.fim + 'T00:00:00Z'); fimMais1.setUTCDate(fimMais1.getUTCDate() + 1);
  const devs = (await rest(cfg, 'ocorrencias_devolucao',
    'select=id,numero_protocolo,numero_devolucao,valor_reclamado,cliente_nome,motivo_reclamado,motivo_real_causa_raiz,tipo_erro,' +
    'responsavel_analise,separador_apurado,conferente_apurado,detalhamento_texto,acao_tomada,acao_gestor,' +
    'carga_numero,criado_em,itens,status_gestao,desconto_produtividade_gestor,is_deleted' +
    `&tipo_erro=ilike.*CARREGAMENTO*&criado_em=gte.${per.inicio}&criado_em=lt.${fimMais1.toISOString().slice(0, 10)}` +
    '&order=criado_em.asc&limit=5000'))
    .filter(d => !d.is_deleted && String(d.tipo_erro || '').trim().toUpperCase() === 'ERRO CARREGAMENTO');

  // Itens de cada devolucao (tabela itens_devolucao + descricao do produto),
  // em texto: "16x 11044 - MORTADELA ... (DATA PROXIMA DA VALIDADE) | ...".
  const itensPorDev = {};
  if (devs.length) {
    const itens = (await rest(cfg, 'itens_devolucao',
      `select=ocorrencia_devolucao_id,produto_id,quantidade,motivo_item,is_deleted&ocorrencia_devolucao_id=in.(${devs.map(d => d.id).join(',')})&order=id.asc&limit=5000`))
      .filter(i => !i.is_deleted);
    const ids = [...new Set(itens.map(i => i.produto_id).filter(Boolean))];
    const prods = {};
    if (ids.length) (await rest(cfg, 'produtos', `select=id,codigo_produto,descricao&id=in.(${ids.join(',')})`)).forEach(p => { prods[p.id] = p; });
    itens.forEach(i => {
      const p = prods[i.produto_id] || {};
      const txt = `${i.quantidade || 0}x ${p.codigo_produto || i.produto_id} - ${p.descricao || '?'}${i.motivo_item ? ` (${i.motivo_item})` : ''}`;
      (itensPorDev[i.ocorrencia_devolucao_id] = itensPorDev[i.ocorrencia_devolucao_id] || []).push(txt);
    });
  }

  // Abre o modelo (o .xlsx e um zip) numa pasta temporaria.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-prod-'));
  const zipTmp = path.join(tmp, 'modelo.zip');
  const dir = path.join(tmp, 'x');
  fs.mkdirSync(dir);
  fs.copyFileSync(modelo, zipTmp);
  execFileSync(TAR, ['-xf', zipTmp, '-C', dir]);
  const ler = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const gravar = (f, s) => fs.writeFileSync(path.join(dir, f), s, 'utf8');

  // Localiza cada aba pelo nome (workbook.xml + rels).
  const wb = ler('xl/workbook.xml');
  const rels = ler('xl/_rels/workbook.xml.rels');
  const arqAba = nome => {
    const m = wb.match(new RegExp(`<sheet name="${nome}" sheetId="\\d+" r:id="(rId\\d+)"`));
    if (!m) throw new Error(`Aba "${nome}" nao encontrada no modelo.`);
    return 'xl/' + rels.match(new RegExp(`Id="${m[1]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${m[1]}"`)).slice(1).find(Boolean);
  };
  const arqTabela = (abaArq) => {
    const r = ler(abaArq.replace('worksheets/', 'worksheets/_rels/') + '.rels');
    const t = (r.match(/Target="\.\.\/tables\/(table\d+\.xml)"/) || [])[1];
    return t ? 'xl/tables/' + t : null;
  };
  const refTabela = arq => ler(arq).match(/<table [^>]*? ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);

  // Nomes do cadastro (BD Funcionario). O PROCV da planilha compara o texto
  // exato, e o cadastro as vezes tem espaco sobrando no fim do nome: o nome
  // vai para Pontos/Producao com a grafia do cadastro para o PROCV achar.
  const XLSX = require(path.join(__dirname, '..', 'js', 'xlsx.full.min.js'));
  const wbLido = XLSX.read(fs.readFileSync(modelo), { cellFormula: false });

  // --- BD Funcionario: vem do cadastro mestre (Funcionarios.xlsx, o mesmo que
  // alimenta o Power BI), nao do mes anterior - assim quem entrou no mes ja
  // aparece. Colunas de valores e dados (MAT ... Base, DESCARGA ... TURNO)
  // vem do cadastro; TETO PROD, TETO OCOR. e TOTAL ficam com as formulas da
  // propria planilha (este script nao mexe em R$).
  const funcWb = XLSX.read(fs.readFileSync(ARQ_FUNCIONARIOS));
  const funcAba = funcWb.Sheets['BD Funcionário'] || funcWb.Sheets[funcWb.SheetNames[0]];
  const funcLinhas = XLSX.utils.sheet_to_json(funcAba, { header: 1, defval: '' });
  const cabModelo = (XLSX.utils.sheet_to_json(wbLido.Sheets['BD Funcionário'], { header: 1, defval: '' })[0] || []).slice(0, 16).map(String);
  const cabFunc = (funcLinhas[0] || []).slice(0, 16).map(String);
  if (cabModelo.join('|') !== cabFunc.join('|')) {
    throw new Error(`As colunas do Funcionarios.xlsx nao batem com a aba BD Funcionario do modelo.\n  modelo: ${cabModelo.join(', ')}\n  cadastro: ${cabFunc.join(', ')}`);
  }
  // O modelo usa datas de 1904 e o cadastro de 1900: o numero da data muda.
  const data1904 = /<workbookPr[^>]*date1904="1"/.test(wb);
  const funcData1904 = !!(funcWb.Workbook && funcWb.Workbook.WBProps && funcWb.Workbook.WBProps.date1904);
  const ajusteData = data1904 && !funcData1904 ? -1462 : (!data1904 && funcData1904 ? 1462 : 0);
  const cadastro = funcLinhas.slice(1).filter(r => String(r[1] || '').trim());
  {
    const aba = arqAba('BD Funcionário'), tab = arqTabela(aba), m = refTabela(tab);
    const p = lerLinhas(ler(aba));
    const COLS = 'ABCDEFGHIJKLMNOP'.split('');
    const ult = reescrever(p, {
      primeira: Number(m[2]) + 1, ultimaModelo: Number(m[4]), cols: COLS, total: cadastro.length,
      valores: i => {
        const out = {};
        COLS.forEach((c, k) => {
          if (c === 'J' || c === 'K' || c === 'L') return; // formulas do modelo
          let v = cadastro[i][k];
          if (c === 'F' && typeof v === 'number') v += ajusteData;
          out[c] = v === '' ? null : v;
        });
        return out;
      }
    });
    gravar(aba, montarXml(p));
    gravar(tab, ajustarTabela(ler(tab), `${m[1]}${m[2]}:${m[3]}${ult}`));
  }
  // A tabela dinamica da aba Calculo le a BD: atualiza ao abrir.
  for (const f of fs.readdirSync(path.join(dir, 'xl/pivotCache')).filter(f => /^pivotCacheDefinition\d+\.xml$/.test(f))) {
    const arq = 'xl/pivotCache/' + f;
    const x = ler(arq);
    if (!/refreshOnLoad=/.test(x)) gravar(arq, x.replace(/<pivotCacheDefinition /, '<pivotCacheDefinition refreshOnLoad="1" '));
  }

  const nomesBD = new Map(cadastro.map(r => [String(r[1]).trim(), String(r[1])]));
  const nomeBD = n => nomesBD.get(String(n).trim()) || String(n).trim();

  // So quem tem ELEGIBILIDADE = OK no cadastro vai para Pontos e Producao
  // (decisao de 26/10/2026). INATIVO, EXPERIENCIA e SUPERVISAO ficam fora da
  // planilha de pagamento; no app a pontuacao deles continua aparecendo, para
  // comparacao.
  const elegib = new Map(cadastro.map(r => [String(r[1]).trim(),
    String(r[7]).trim().toUpperCase() === 'INATIVO' ? 'INATIVO' : String(r[6]).trim().toUpperCase()]));
  const elegivel = p => elegib.get(String(p.nome).trim()) === 'OK';
  const foraPorTipo = {};
  pontos.filter(p => !elegivel(p)).forEach(p => {
    const k = elegib.get(String(p.nome).trim()) || 'FORA DO CADASTRO';
    foraPorTipo[k] = (foraPorTipo[k] || 0) + 1;
  });

  // --- Pontos
  const comPontos = pontos.filter(p => p.pontuacao !== null && elegivel(p));
  {
    const aba = arqAba('Pontos'), tab = arqTabela(aba), m = refTabela(tab);
    const p = lerLinhas(ler(aba));
    const ult = reescrever(p, {
      primeira: Number(m[2]) + 1, ultimaModelo: Number(m[4]), cols: ['B', 'C', 'D', 'E'], total: comPontos.length,
      valores: i => ({ B: nomeBD(comPontos[i].nome), C: Number(comPontos[i].pontuacao) })
    });
    gravar(aba, montarXml(p));
    gravar(tab, ajustarTabela(ler(tab), `${m[1]}${m[2]}:${m[3]}${ult}`));
  }

  // --- Producao
  const comProd = pontos.filter(p => (p.qtd_os !== null || p.kg_total !== null || p.qtd_apanhos !== null) && elegivel(p))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  {
    const aba = arqAba('Produção'), tab = arqTabela(aba), m = refTabela(tab);
    const p = lerLinhas(ler(aba));
    const n = v => (v === null || v === undefined ? null : Number(v));
    const ult = reescrever(p, {
      primeira: Number(m[2]) + 1, ultimaModelo: Number(m[4]),
      cols: ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'], total: comProd.length,
      valores: i => ({ B: nomeBD(comProd[i].nome), C: n(comProd[i].qtd_os), D: n(comProd[i].kg_total),
        E: n(comProd[i].qtd_apanhos), F: n(comProd[i].kg_entrada) })
    });
    gravar(aba, montarXml(p).replace(/(sqref="[A-Z]+5:[A-Z]+)\d+"/g, `$1${ult}"`).replace(/sqref="H6:H\d+"/, `sqref="H6:H${ult}"`));
    gravar(tab, ajustarTabela(ler(tab), `${m[1]}${m[2]}:${m[3]}${ult}`));
  }

  // --- Ocorrencia (sem tabela do Excel: linhas 5 a 13 formatadas no modelo)
  {
    const aba = arqAba('Ocorrência');
    // O layout desta aba ja mudou de um mes para outro (a 2026.08 era outra):
    // so preenche se o cabecalho for o esperado (Protocolo ... Status, Gravidade).
    const cab = XLSX.utils.sheet_to_json(wbLido.Sheets['Ocorrência'], { header: 1, defval: '' })[3] || [];
    if (String(cab[0]).trim() !== 'Protocolo Chamado' || String(cab[15]).trim() !== 'Status' || String(cab[16]).trim() !== 'Gravidade') {
      throw new Error('A aba Ocorrencia do modelo nao tem o layout esperado (A4 = Protocolo Chamado, P4 = Status, Q4 = Gravidade). Use como modelo a planilha 2026.09 ou mais nova.');
    }
    const p = lerLinhas(ler(aba));
    const ultimaFmt = Math.max(...[...p.linhas.keys()].filter(r => r >= 5 && p.linhas.get(r).celulas.length), 13);
    const dt = s => { const d = String(s || '').slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : ''; };
    const status = () => 'PROCEDENTE';
    const cols = 'ABCDEFGHIJKLMNOPQ'.split('');
    reescrever(p, {
      primeira: 5, ultimaModelo: ultimaFmt, cols, total: devs.length, minimo: ultimaFmt - 4,
      valores: i => {
        const d = devs[i];
        return { A: d.numero_protocolo || d.numero_devolucao, B: d.cliente_nome, C: d.motivo_reclamado,
          D: d.motivo_real_causa_raiz, E: String(d.tipo_erro).trim(), F: d.responsavel_analise,
          G: (d.separador_apurado || '').trim(), H: (d.conferente_apurado || '').trim(), I: d.detalhamento_texto,
          J: d.acao_tomada, K: d.acao_gestor, L: d.carga_numero,
          M: d.valor_reclamado === null || d.valor_reclamado === undefined ? null : Number(d.valor_reclamado),
          N: dt(d.criado_em), O: (itensPorDev[d.id] || []).join(' | ') || null, P: status(d), Q: null };
      }
    });
    gravar(aba, montarXml(p));
  }

  // --- Demonstrativo: valores passam a vir da aba Calculo pelo NOME.
  {
    const aba = arqAba('Demonstrativo');
    const p = lerLinhas(ler(aba));
    const colCalc = { G: 2, H: 3, I: 4, J: 5, K: 6, L: 7, M: 8, N: 9, O: 10, P: 11 };
    for (const [r, l] of p.linhas) {
      if (r < 6) continue;
      if (!l.celulas.some(c => c.col === 'F')) continue;
      l.celulas = l.celulas.map(c => {
        if (!colCalc[c.col]) return c;
        const f = `IFERROR(VLOOKUP(Tabela3[[#This Row],[NOME]],'Cálculo'!$B:$L,${colCalc[c.col]},0),0)`;
        return { col: c.col, xml: celula(c.col + r, estilo(c.attrs), { f: esc(f) }) };
      });
    }
    gravar(aba, montarXml(p));
  }

  // --- Oc. RH: sai limpa, so o cabecalho e uma linha em branco. As do mes do
  // modelo NAO podem ficar - zerariam o pagamento de quem teve falta no mes
  // anterior. O RH do mes e preenchido a mao (fecha na 2a feira).
  {
    const aba = arqAba('Oc. RH'), tab = arqTabela(aba), m = refTabela(tab);
    const p = lerLinhas(ler(aba));
    const cols = [];
    for (let c = colNum(m[1]); c <= colNum(m[3]); c++) cols.push(String.fromCharCode(64 + c));
    reescrever(p, { primeira: Number(m[2]) + 1, ultimaModelo: Number(m[4]), cols, total: 0, minimo: 1, valores: () => ({}) });
    gravar(aba, montarXml(p));
    gravar(tab, ajustarTabela(ler(tab), `${m[1]}${m[2]}:${m[3]}${Number(m[2]) + 1}`));
  }

  // --- Ultima aba (a folha de assinatura "Prod Mmm AA"): titulo e nome com o
  // mes novo, e o quadro "OCORRENCIA DO RH" limpo (era digitado a mao).
  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const nomesAbas = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map(x => x[1]);
  const abaFolha = nomesAbas[nomesAbas.length - 1];
  if (/^Prod [A-Za-z]{3} \d{2}$/.test(abaFolha)) {
    const arq = arqAba(abaFolha);
    const p = lerLinhas(ler(arq));
    const linhasFolha = XLSX.utils.sheet_to_json(wbLido.Sheets[abaFolha], { header: 1, defval: '', blankrows: true });
    const titulo = String((linhasFolha[0] || [])[0] || '');
    if (/[A-Z]{3} \d{4}\s*$/.test(titulo)) {
      const a1 = (p.linhas.get(1) || { celulas: [] }).celulas.find(c => c.col === 'A');
      if (a1) a1.xml = celula('A1', estilo(a1.attrs), titulo.replace(/[A-Z]{3} \d{4}\s*$/, `${MESES[mes - 1]} ${ano}`));
    }
    const iRH = linhasFolha.findIndex(l => String(l[0]).trim().toUpperCase() === 'OCORRÊNCIA DO RH');
    const iFim = linhasFolha.findIndex((l, i) => i > iRH && /^GESTOR/i.test(String(l[0]).trim()));
    if (iRH >= 0 && iFim > iRH) {
      for (let r = iRH + 3; r <= iFim; r++) { // pula o titulo e o cabecalho NOME/DETALHAMENTO...
        const l = p.linhas.get(r);
        if (l) l.celulas = l.celulas.map(c => ({ col: c.col, xml: celula(c.col + r, estilo(c.attrs), null) }));
      }
    }
    gravar(arq, montarXml(p));
    // Nome da aba: so troca se nenhuma formula de outra aba aponta para ela.
    const novoNome = `Prod ${MESES[mes - 1][0]}${MESES[mes - 1].slice(1).toLowerCase()} ${String(ano).slice(2)}`;
    const usada = fs.readdirSync(path.join(dir, 'xl/worksheets')).filter(f => f.endsWith('.xml'))
      .some(f => ler('xl/worksheets/' + f).includes(abaFolha + '\'!'));
    if (novoNome !== abaFolha && !usada && !nomesAbas.includes(novoNome)) {
      gravar('xl/workbook.xml', ler('xl/workbook.xml').split(abaFolha).join(novoNome));
      if (fs.existsSync(path.join(dir, 'docProps/app.xml'))) gravar('docProps/app.xml', ler('docProps/app.xml').split(abaFolha).join(novoNome));
    }
  }

  // Excel recalcula tudo ao abrir; sem calcChain velho para nao dar aviso de reparo.
  gravar('xl/workbook.xml', ler('xl/workbook.xml').replace(/<calcPr([^>]*?)\/>/, (m0, a) => `<calcPr${a.replace(/ fullCalcOnLoad="\d"/, '')} fullCalcOnLoad="1"/>`));
  if (fs.existsSync(path.join(dir, 'xl/calcChain.xml'))) {
    fs.unlinkSync(path.join(dir, 'xl/calcChain.xml'));
    gravar('xl/_rels/workbook.xml.rels', ler('xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain\.xml"\/>/, ''));
    gravar('[Content_Types].xml', ler('[Content_Types].xml').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
  }

  // Fecha o zip de novo.
  const zipOut = path.join(tmp, 'saida.zip');
  execFileSync(TAR, ['-a', '-cf', zipOut, '-C', dir, ...fs.readdirSync(dir)]);
  fs.copyFileSync(zipOut, saida);
  fs.rmSync(tmp, { recursive: true, force: true });

  // Resumo.
  const semDesc = devs.filter(d => !d.desconto_produtividade_gestor).map(d => d.numero_protocolo || d.numero_devolucao);
  console.log(`\nGerada: ${saida}`);
  console.log(`  Pontos ......... ${comPontos.length} colaboradores`);
  console.log(`  Producao ....... ${comProd.length} colaboradores`);
  console.log(`  Ocorrencias .... ${devs.length} (ERRO CARREGAMENTO), todas como PROCEDENTE`);
  const fora = Object.entries(foraPorTipo).map(([k, n]) => `${n} ${k}`).join(', ');
  if (fora) console.log(`  Fora da planilha (nao elegiveis; seguem so no app) ... ${fora}`);
  const semBD = [...new Set(pontos.map(p => p.nome.trim()))].filter(n => !nomesBD.has(n));
  if (semBD.length) console.log(`  ATENCAO - com pontos no Power BI mas fora do Funcionarios.xlsx (cadastrar): ${semBD.join('; ')}`);
  if (semDesc.length) console.log(`  Para a gerencia olhar - no app o gestor deixou SEM desconto: ${semDesc.join(', ')}`);
  console.log('\nFalta preencher: Status final e Gravidade (aba Ocorrencia, pela gerencia geral) e a aba Oc. RH.');
  console.log('Depois, Dados > Atualizar Tudo (para a tabela dinamica da aba Calculo).');
}

main().catch(e => { console.error('\nERRO: ' + (e.message || e)); process.exit(1); });
