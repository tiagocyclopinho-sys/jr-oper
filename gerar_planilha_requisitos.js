// =============================================================================
// GERADOR DA PLANILHA DE REQUISITOS - MOTORISTAS E AJUDANTES (26/10/2026)
//
// Copia a planilha do mes anterior (o "modelo") e preenche sozinho, direto da
// nuvem do Jr-Oper (Supabase), o mes de fechamento (26 do mes anterior a 25):
//   - aba Ocorrencias ...... uma linha por ocorrencia, TODAS com o Requisito
//                            preenchido (decisao de 26/10/2026: contabiliza
//                            todas; quem abona e o Victor Hugo, na planilha)
//       * Motor ocioso confirmado pela CCO (Oc. Operacional, motivo MOTOR
//         OCIOSO) ....................... Media Consumo, uma linha por evento
//       * Checklist nao realizado (Controle de Viagens) .. Manut. Veiculo /
//         Aparelho, uma linha por motorista com o total (saida + chegada)
//       * Fusion nao iniciado (Controle de Viagens) ...... Fusion / FALTA,
//         uma linha por motorista com o total de viagens
//       * Sinistro (Investigacao de Sinistro) ............ Sinistro & Conservacao
//       * Devolucao ERRO MOTORISTA (todas, analisadas ou nao) .. Devolucao, uma linha
//         para o motorista e uma para cada ajudante da carga
//       * Falta de ajudante (Oc. Operacional, vale o nome) .. Pontualidade
//   - abas de apoio, com o detalhe que gerou cada linha: OCORRENCIAS PLN,
//     Folgas-Falta (faltas do Oc. Operacional, todas DESCONTADO), Checklist,
//     Fusion NA, Devolucao e Tempo de Rota
//   - aba Motor Ocioso: todos os alertas do rastreador no periodo (Power BI,
//     modelo CCO, copiado para cco_motor_ocioso pela Edge Function sync-cco),
//     ja sem as linhas repetidas do Power BI. Isencoes continuam a mao.
//   - aba Prazo Rota sai limpa (lancamento manual)
//
// Checklist e Fusion "nao iniciado" com observacao de falta de aparelho,
// inconsistencia, senha etc. (ver JUSTIFICADO) contam como SISTEMA INOPERANTE
// / IMPROCEDENTE e nao entram na contagem - mesma regra das planilhas de 2026.
//
// NAO mexe nas abas Motorista, Ajudante e BD (ficam por conta do usuario), nem
// em Media de Consumo, Fusion NF e Fusion Desvio. Nenhum valor em R$ entra.
// Os nomes vao como estao no app: quem nao estiver na aba BD aparece com #N/D
// no Cod. ERP / Funcao - o resumo no fim lista quem e.
//
// Uso (precisa do Node instalado):
//   node tools/gerar_planilha_requisitos.js [AAAAMM] [modelo.xlsx] [saida.xlsx]
//   AAAAMM ...... mes de fechamento (ex.: 202610 = 26/09 a 25/10). Sem ele: do
//                 dia 26 em diante, o mes que acabou de fechar; antes, o mes
//                 em andamento (previa).
//   modelo ...... sem ele, usa a planilha do mes anterior na pasta REQUISITOS.
//   saida ....... sem ela, grava "REQUISITOS MOTORISTAS E AJUDANTES - MM.AAAA.xlsx"
//                 na mesma pasta. Nunca sobrescreve um arquivo que ja existe.
// =============================================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TAR_WIN = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const TAR = process.platform === 'win32' && fs.existsSync(TAR_WIN) ? TAR_WIN : 'tar';
const PASTA_PADRAO = 'S:\\Logistica\\01 - LOGISTICA INFORMATIVO\\20 - VICTOR HUGO\\REQUISITOS';
const nomeArquivo = (ano, mes) => `REQUISITOS MOTORISTAS E AJUDANTES - ${String(mes).padStart(2, '0')}.${ano}.xlsx`;

// Observacao da viagem que justifica checklist/Fusion nao feito (o celular
// nao estava com o motorista ou o aplicativo falhou).
const JUSTIFICADO = /SEM (TELEFONE|APARELHO|CELULAR)|INCONSIST|CELULAR (NA|SE ENCONTRA)|PROBLEMA NO APLICATIVO|SENHA DE ACESSO|IMPOSSIBILIT/;

// Placas que o relatorio da CCO no Power BI deixa fora do grafico de motor
// ocioso (conferido em 26/10/2026 contra o grafico "Motorista Resp"). A aba
// Motor Ocioso sai sem elas, e a tabela dinamica dela sem filtro de veiculo,
// para os totais baterem com o Power BI.
const VEICULOS_FORA_MOTOR_OCIOSO = ['OLH8E48', 'OLI0E88', 'OLI2E18', 'OLI2E91', 'QWA2318', 'TVD0F56'];

// Textos que as formulas das abas Motorista/Ajudante procuram (COUNTIFS).
const REQ = {
  checklist: 'Manut. Veiculo / Aparelho', sinistro: 'Sinistro & Conservação', motorOcioso: 'Média Consumo',
  devolucao: 'Devolução', fusion: 'Fusion', pontualidade: 'Pontualidade'
};

function lerConfig() {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const url = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (cfg.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
  if (!url || !key) throw new Error('Nao achei a URL/chave do Supabase em js/config.js');
  return { url, key };
}

// Le tudo, de 1000 em 1000 (o Supabase devolve no maximo 1000 linhas por chamada).
async function rest(cfg, tabela, query) {
  const q = query.replace(/&limit=d+/, '');
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${cfg.url}/rest/v1/${tabela}?${q}`, { headers: { apikey: cfg.key, Range: `${de}-${de + 999}` } });
    if (!r.ok) throw new Error(`Erro ao ler ${tabela}: ${r.status} ${await r.text()}`);
    const lote = await r.json();
    tudo.push(...lote);
    if (lote.length < 1000) return tudo;
  }
}

// ----------------------------------------------------------------- datas
// As colunas de data do app sao texto: 'AAAA-MM-DD' (quase todas) ou 'DD/MM/AAAA'.
function isoDe(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
// Data do Supabase (timestamptz) no dia de Brasilia.
const isoBrasilia = ts => (ts ? new Date(new Date(ts).getTime() - 3 * 3600000).toISOString().slice(0, 10) : '');
const horaFracao = h => { const m = String(h || '').match(/^(\d{1,2}):(\d{2})/); return m ? (Number(m[1]) * 60 + Number(m[2])) / 1440 : null; };
const ddmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');

// ----------------------------------------------------------------- XML helpers
const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNum = c => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetra = n => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const colDe = ref => ref.replace(/\d+/g, '');

function lerLinhas(xml) {
  const ini = xml.indexOf('<sheetData>'), fim = xml.indexOf('</sheetData>');
  if (ini < 0) return { antes: xml.replace('<sheetData/>', '<sheetData></sheetData>').split('<sheetData></sheetData>')[0], depois: xml.split('<sheetData/>')[1] || '', linhas: new Map() };
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
  const ult = nums.length ? nums[nums.length - 1] : 1;
  // A dimensao da aba acompanha a ultima linha.
  return `${p.antes.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/, `<dimension ref="$1:$2${ult}"/>`)}<sheetData>${corpo}</sheetData>${p.depois}`;
}

const estilo = attrs => (attrs.match(/ s="(\d+)"/) || [])[1];
// Formula da celula, inclusive a "mestra" de formula compartilhada (<f t="shared" ...>).
const formula = xml => (xml.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/) || [])[1];

function celula(ref, s, v) {
  const st = s ? ` s="${s}"` : '';
  if (v === null || v === undefined || v === '') return `<c r="${ref}"${st}/>`;
  if (typeof v === 'object' && v.f) return `<c r="${ref}"${st}><f>${v.f}</f></c>`;
  if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// Reescreve as linhas [primeira ..] das colunas cols. Estilo (e formula de
// coluna calculada, quando nao vier valor) de cada coluna vem da primeira
// linha de dados do modelo. Celulas fora de cols (tabelas dinamicas ao lado)
// ficam como estao. valores(i, r) devolve { COL: valor | {f:'formula'} }.
function reescrever(p, { primeira, ultimaModelo, cols, total, minimo = 0, valores, formulas = {} }) {
  const dentro = c => cols.includes(c);
  const mPrim = {};
  (p.linhas.get(primeira) || { celulas: [] }).celulas.forEach(c => { mPrim[c.col] = { s: estilo(c.attrs) }; });
  const attrsPrim = ((p.linhas.get(primeira) || { attrs: '' }).attrs).replace(/ spans="[^"]*"/, '');
  const linhasNovas = Math.max(total, minimo);
  const ate = Math.max(ultimaModelo, primeira + linhasNovas - 1);
  for (let r = primeira; r <= ate; r++) {
    const i = r - primeira;
    const atual = p.linhas.get(r) || { attrs: attrsPrim, celulas: [] };
    const fora = atual.celulas.filter(c => !dentro(c.col));
    if (i >= linhasNovas) {
      if (fora.length) p.linhas.set(r, { attrs: atual.attrs, celulas: fora }); else p.linhas.delete(r);
      continue;
    }
    const v = i < total ? valores(i, r) : {};
    const novas = cols.map(col => {
      let val = v[col];
      if (val === undefined && formulas[col] && i < total) val = { f: formulas[col] };
      return { col, xml: celula(col + r, (mPrim[col] || {}).s, val) };
    });
    p.linhas.set(r, { attrs: (atual.attrs || attrsPrim).replace(/ spans="[^"]*"/, ''), celulas: fora.concat(novas) });
  }
  return primeira + Math.max(total, 1) - 1;
}

// ----------------------------------------------------------------- principal
async function main() {
  const [argMes, argModelo, argSaida] = process.argv.slice(2);
  const cfg = lerConfig();

  // Mes de fechamento: AAAAMM = 26 do mes anterior a 25 do mes.
  let ano, mes;
  if (argMes) {
    if (!/^\d{6}$/.test(argMes)) throw new Error('Mes de fechamento no formato AAAAMM (ex.: 202610).');
    ano = Number(argMes.slice(0, 4)); mes = Number(argMes.slice(4));
  } else {
    // O mes de fechamento MM vai de 26/(MM-1) a 25/MM: no dia 26 em diante e o
    // que acabou de fechar; antes disso, o que esta em andamento.
    const hoje = new Date(Date.now() - 3 * 3600000);
    ano = hoje.getUTCFullYear(); mes = hoje.getUTCMonth() + 1;
  }
  const pad = n => String(n).padStart(2, '0');
  const [anoAnt, mesAnt] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
  const inicio = `${anoAnt}-${pad(mesAnt)}-26`, fim = `${ano}-${pad(mes)}-25`;
  const noPeriodo = iso => iso && iso >= inicio && iso <= fim;
  console.log(`Mes de fechamento: ${pad(mes)}.${ano} (${ddmm(inicio)}/${anoAnt} a ${ddmm(fim)}/${ano})`);

  let modelo = argModelo;
  if (!modelo) {
    modelo = path.join(PASTA_PADRAO, String(anoAnt), nomeArquivo(anoAnt, mesAnt));
    if (!fs.existsSync(modelo)) throw new Error(`Modelo nao encontrado: ${modelo}\nPasse o caminho do modelo no 2o argumento.`);
  }
  const saida = argSaida || path.join(PASTA_PADRAO, String(ano), nomeArquivo(ano, mes));
  if (path.resolve(saida) === path.resolve(modelo)) throw new Error('A saida nao pode ser o proprio modelo.');
  if (fs.existsSync(saida)) throw new Error(`Ja existe: ${saida}\nApague/renomeie antes, ou passe outro nome de saida.`);
  console.log(`Modelo: ${modelo}`);

  // ---- Dados da nuvem (as colunas de data sao texto: filtra aqui)
  const naoApagado = x => !x.is_deleted;
  const viagens = (await rest(cfg, 'controle_viagens', 'select=*&order=data_saida.asc,hora_saida.asc&limit=20000'))
    .filter(naoApagado).map(v => ({ ...v, iso: isoDe(v.data_saida) })).filter(v => noPeriodo(v.iso));
  const ocv = (await rest(cfg, 'ocorrencias_viagens', 'select=*&order=data.asc&limit=20000'))
    .filter(naoApagado).map(o => ({ ...o, iso: isoDe(o.data) })).filter(o => noPeriodo(o.iso));
  const fimMais1 = new Date(Date.UTC(ano, mes - 1, 26)).toISOString().slice(0, 10);
  const devs = (await rest(cfg, 'ocorrencias_devolucao',
    'select=id,numero_protocolo,numero_devolucao,carga_numero,rota_nome,motorista_id,detalhamento_texto,motivo_real_causa_raiz,' +
    'tipo_erro,motivo_reclamado,acao_gestor,responsavel_analise,desconto_produtividade_gestor,status_gestao,criado_em,is_deleted' +
    `&tipo_erro=ilike.*MOTORISTA*&criado_em=gte.${inicio}T03:00:00Z&criado_em=lt.${fimMais1}T03:00:00Z&order=criado_em.asc&limit=5000`))
    .filter(d => naoApagado(d) && String(d.tipo_erro || '').trim().toUpperCase() === 'ERRO MOTORISTA');
  const sinistros = (await rest(cfg, 'sinistros', 'select=*&limit=5000'))
    .filter(s => naoApagado(s) && noPeriodo(isoDe(s.data_acidente)));
  const motoristas = await rest(cfg, 'motoristas', 'select=id,nome&limit=5000');
  const alertas = await rest(cfg, 'cco_motor_ocioso',
    `select=*&data=gte.${inicio}&data=lte.${fim}&order=data.asc,hora.asc,veiculo.asc`);
  const alertasAba = alertas.filter(a => !VEICULOS_FORA_MOTOR_OCIOSO.includes(a.veiculo));
  const ultimoSync = (await rest(cfg, 'cco_sync_log', 'select=finalizado_em&status=eq.ok&order=id.desc&limit=1'))[0];
  const nomeMotorista = Object.fromEntries(motoristas.map(m => [String(m.id), m.nome]));

  // Equipe de cada carga pelo Controle de Viagens (todas as datas: a
  // devolucao pode abrir dias depois da viagem). Mesmo caminho do app.
  const todasViagens = (await rest(cfg, 'controle_viagens', 'select=carga,rota,motorista,ajudante,ajudante_2,is_deleted&limit=20000')).filter(naoApagado);
  const chaveCarga = c => String(c || '').trim().toUpperCase();
  const equipePorCarga = new Map(todasViagens.map(v => [chaveCarga(v.carga), v]));

  const nome = n => String(n || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const valido = n => n && !/^(N\/A|-+|—)$/.test(n);

  // ---- Linhas de Ocorrencias
  const oc = [];
  const add = (iso, prestador, requisito, motivo, complemento) => {
    if (valido(nome(prestador))) oc.push({ iso, prestador: nome(prestador), requisito, motivo, complemento: complemento || null });
  };

  // Motor ocioso confirmado pela CCO: uma linha por evento. Registro de
  // isencao ("ISENTAR 15 ALERTAS ... FALHA MECANICA") nao e ocorrencia.
  const isencao = o => /ISENT/.test(nome(`${o.causa} ${o.ocorrencia} ${o.acao}`));
  ocv.filter(o => nome(o.motivo) === 'MOTOR OCIOSO' && !isencao(o))
    .forEach(o => add(o.iso, o.funcionario, REQ.motorOcioso, 'MOTOR OCIOSO - COM CONTATO E CONFIRMAÇÃO DA CCO',
      [o.carga && `CARGA ${o.carga}`, o.causa].filter(Boolean).join(' - ')));

  // Checklist e Fusion: uma linha por (viagem, tipo) nao iniciado.
  const justificado = v => JUSTIFICADO.test(String(v.observacao || '').toUpperCase());
  const checklists = [];
  const fusions = [];
  viagens.forEach(v => {
    if (v.checklist_saida === 'NÃO INICIADO') checklists.push({ v, tipo: 'CHECKLIST SAÍDA' });
    if (v.checklist_chegada === 'NÃO INICIADO') checklists.push({ v, tipo: 'CHECKLIST CHEGADA' });
    if (v.fusion === 'NÃO INICIADO') fusions.push({ v });
  });
  const porMotorista = (lista) => {
    const m = new Map();
    lista.forEach(x => {
      const k = nome(x.v.motorista);
      if (!valido(k)) return;
      const t = m.get(k) || { conta: 0, justif: 0 };
      if (justificado(x.v)) t.justif++; else t.conta++;
      m.set(k, t);
    });
    return [...m.entries()].sort((a, b) => b[1].conta - a[1].conta || a[0].localeCompare(b[0]));
  };
  porMotorista(checklists).filter(([, t]) => t.conta).forEach(([mot, t]) =>
    add(fim, mot, REQ.checklist, `DEIXOU DE REALIZAR ${t.conta} CHECKLIST, EM SAÍDA OU CHEGADA`,
      t.justif ? `+${t.justif} justificado(s) (sem aparelho / inconsistência) não contado(s)` : null));
  porMotorista(fusions).filter(([, t]) => t.conta).forEach(([mot, t]) =>
    add(fim, mot, REQ.fusion, 'FALTA', `MOTORISTA DEIXOU DE ABRIR O FUSION EM ${t.conta} VIAGEM(NS)`));

  // Sinistro.
  sinistros.forEach(s => add(isoDe(s.data_acidente), s.motorista_nome, REQ.sinistro,
    `SINISTRO ${s.numero_sinistro || ''}`.trim(),
    [s.responsabilidade_motorista && `RESPONSABILIDADE DO MOTORISTA: ${s.responsabilidade_motorista}`, s.status_geral].filter(Boolean).join(' - ')));

  // Devolucao ERRO MOTORISTA: motorista e ajudantes da carga.
  const linhasDev = devs.map(d => {
    const eq = equipePorCarga.get(chaveCarga(d.carga_numero)) || {};
    return { d, iso: isoBrasilia(d.criado_em), rota: d.rota_nome || eq.rota || '',
      motorista: nome(eq.motorista) || nome(nomeMotorista[String(d.motorista_id)]),
      ajudante: nome(eq.ajudante), ajudante2: nome(eq.ajudante_2) };
  });
  // Todas contam, com ou sem analise/desconto do gestor (decisao de 26/10/2026:
  // a devolucao ocorreu). Sem causa raiz ainda, vai o motivo reclamado.
  const motivoDev = d => d.motivo_real_causa_raiz || d.motivo_reclamado;
  const complDev = d => `${d.numero_protocolo || d.numero_devolucao}${String(d.status_gestao || '').startsWith('PENDENTE') ? ' (sem análise do gestor)' : ''}`;
  linhasDev.forEach(x => add(x.iso, x.motorista, REQ.devolucao, motivoDev(x.d), complDev(x.d)));
  linhasDev.forEach(x => [x.ajudante, x.ajudante2].forEach(a => add(x.iso, a, REQ.devolucao, motivoDev(x.d), complDev(x.d))));

  // Falta (de ajudante ou de motorista): o dia descontado vai na Folgas-Falta;
  // a de ajudante tambem e Pontualidade. Vale o nome do registro, mesmo que a
  // funcao lancada no app nao bata com o motivo.
  const faltas = ocv.filter(o => /^FALTA (AJUDANTE|MOTORISTA)$/.test(nome(o.motivo)));
  faltas.filter(o => nome(o.motivo) === 'FALTA AJUDANTE')
    .forEach(o => add(o.iso, o.funcionario, REQ.pontualidade, 'FALTA DO COLABORADOR, GEROU ATRASO NA PONTUALIDADE', o.causa));

  // ---- Abre o modelo
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-req-'));
  const zipTmp = path.join(tmp, 'modelo.zip');
  const dir = path.join(tmp, 'x');
  fs.mkdirSync(dir);
  fs.copyFileSync(modelo, zipTmp);
  execFileSync(TAR, ['-xf', zipTmp, '-C', dir]);
  const ler = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const gravar = (f, s) => fs.writeFileSync(path.join(dir, f), s, 'utf8');

  const wb = ler('xl/workbook.xml');
  const rels = ler('xl/_rels/workbook.xml.rels');
  // Numero de serie da data no sistema do arquivo (estas planilhas usam o de 1904).
  const base = /<workbookPr[^>]*date1904="(1|true)"/.test(wb) ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const serial = iso => (iso ? (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - base) / 86400000 : null);

  const nomesAbas = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map(x => x[1]);
  const acharAba = nomeAba => nomesAbas.find(n => n.trim().toUpperCase() === nomeAba.toUpperCase());
  const arqAba = nomeAba => {
    const real = acharAba(nomeAba);
    if (!real) throw new Error(`Aba "${nomeAba}" nao encontrada no modelo.`);
    const id = wb.match(new RegExp(`<sheet name="${real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" sheetId="\\d+" r:id="(rId\\d+)"`))[1];
    return 'xl/' + rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${id}"`)).slice(1).find(Boolean).replace(/^\/?xl\//, '');
  };
  const arqTabela = abaArq => {
    const f = abaArq.replace('worksheets/', 'worksheets/_rels/') + '.rels';
    if (!fs.existsSync(path.join(dir, f))) return null;
    const t = (ler(f).match(/Target="\.\.\/tables\/(table\d+\.xml)"/) || [])[1];
    return t ? 'xl/tables/' + t : null;
  };

  // Preenche uma aba que tem tabela do Excel (cabecalho na linha 1).
  // colunas: lista de letras em ordem; linha(x) devolve array na mesma ordem
  // (undefined = usa a formula da coluna calculada da tabela).
  function preencherTabela(nomeAba, colunas, dados, linha) {
    const aba = arqAba(nomeAba), tab = arqTabela(aba);
    const xmlTab = ler(tab);
    const m = xmlTab.match(/<table [^>]*? ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/);
    const formulas = {};
    let iCol = colNum(m[1]);
    for (const tc of xmlTab.match(/<tableColumn [\s\S]*?(\/>|<\/tableColumn>)/g)) {
      const f = (tc.match(/<calculatedColumnFormula>([\s\S]*?)<\/calculatedColumnFormula>/) || [])[1];
      if (f) formulas[colLetra(iCol)] = f;
      iCol++;
    }
    const p = lerLinhas(ler(aba));
    const ult = reescrever(p, {
      primeira: Number(m[2]) + 1, ultimaModelo: Number(m[4]), cols: colunas, total: dados.length, minimo: 1, formulas,
      valores: i => Object.fromEntries(linha(dados[i]).map((v, k) => [colunas[k], v]).filter(([, v]) => v !== undefined))
    });
    const ref = `${m[1]}${m[2]}:${m[3]}${ult}`;
    gravar(aba, montarXml(p).replace(/<autoFilter ref="[^"]*"/, `<autoFilter ref="${m[1]}${m[2]}:${m[3]}${ult}"`));
    gravar(tab, xmlTab.replace(/(<table [^>]*? ref=")[^"]*"/, `$1${ref}"`)
      .replace(/(<autoFilter ref=")[^"]*"/, `$1${ref}"`).replace(/<sortState[\s\S]*?<\/sortState>/, ''));
    return dados.length;
  }
  const letras = (de, ate) => { const r = []; for (let c = colNum(de); c <= colNum(ate); c++) r.push(colLetra(c)); return r; };

  // --- Ocorrencias
  preencherTabela('Ocorrências', letras('A', 'H'), oc,
    o => [serial(o.iso), o.prestador, undefined, undefined, o.requisito, o.motivo, o.complemento, null]);

  // --- OCORRENCIAS PLN (Oc. Operacional do periodo, como esta no app)
  preencherTabela('OCORRÊNCIAS PLN', letras('A', 'J'), ocv,
    o => [serial(o.iso), o.carga, o.rota, o.placa, nome(o.funcionario), nome(o.funcao), o.motivo, o.causa, o.ocorrencia, o.acao]);

  // --- Folgas-Falta: faltas do Oc. Operacional, todas DESCONTADO (o Victor
  // Hugo troca para ABONADO). Ferias e folgas continuam a mao.
  preencherTabela('Folgas-Falta', [...letras('A', 'K'), 'N', 'O', 'P'], faltas,
    o => [serial(o.iso), nome(o.funcionario), nome(o.funcao), nome(o.motivo), serial(o.iso), serial(o.iso), undefined,
      'INTEGRAL', null, null, 'DESCONTADO', o.causa, o.ocorrencia, o.acao]);

  // --- Checklist (VERIFICADO: NAO REALIZADO conta; SISTEMA INOPERANTE nao)
  preencherTabela('Checklist', letras('A', 'K'), checklists,
    x => [x.v.carga, x.v.rota, x.v.placa, nome(x.v.motorista), nome(x.v.ajudante), nome(x.v.ajudante_2), x.v.setor,
      serial(x.v.iso), x.v.observacao, x.tipo, justificado(x.v) ? 'SISTEMA INOPERANTE' : 'NÃO REALIZADO']);

  // --- Fusion NA (STATUS: PROCEDENTE conta; IMPROCEDENTE nao)
  preencherTabela('Fusion NA', letras('A', 'J'), fusions,
    x => [x.v.carga, x.v.rota, x.v.placa, nome(x.v.motorista), nome(x.v.ajudante), nome(x.v.ajudante_2), x.v.setor,
      serial(x.v.iso), horaFracao(x.v.hora_saida), justificado(x.v) ? 'IMPROCEDENTE' : 'PROCEDENTE']);

  // --- Devolucao (sem a coluna de valor em R$)
  preencherTabela('Devolução', letras('A', 'N'), linhasDev,
    x => [serial(x.iso), x.d.numero_protocolo || x.d.numero_devolucao, x.d.carga_numero, x.rota, x.motorista, x.ajudante,
      x.ajudante2, x.d.detalhamento_texto, x.d.motivo_real_causa_raiz, String(x.d.tipo_erro).trim(), x.d.acao_gestor, null,
      x.d.responsavel_analise, x.d.desconto_produtividade_gestor ? 'SIM' : 'NÃO']);

  // --- Motor Ocioso: alertas do rastreador (mesmas colunas de antes). Qtd =
  // linhas identicas no Power BI, que o relatorio conta separadas.
  preencherTabela('Motor Ocioso', letras('A', 'G'), alertasAba,
    a => [a.numero_str, a.veiculo, serial(a.data), horaFracao(a.hora), 'MOTOR OCIOSO', a.qtd || 1, a.motorista || '(SEM VÍNCULO)']);
  // Tira os filtros manuais da tabela dinamica dessa aba (Veiculo e Motorista:
  // o do modelo deixava de fora placas e nomes novos que o Power BI conta).
  {
    const relsAba = arqAba('Motor Ocioso').replace('worksheets/', 'worksheets/_rels/') + '.rels';
    const pivos = fs.existsSync(path.join(dir, relsAba)) ? [...ler(relsAba).matchAll(/Target="\.\.\/pivotTables\/(pivotTable\d+\.xml)"/g)].map(x => 'xl/pivotTables/' + x[1]) : [];
    for (const pv of pivos) {
      gravar(pv, ler(pv).replace(/<pivotField [^>]*?axis="axis(Page|Row)"[\s\S]*?<\/pivotField>/g, pf => pf.replace(/ h="1"/g, '')));
    }
  }

  // --- Prazo Rota: limpa
  preencherTabela('Prazo Rota', letras('A', 'K'), [], () => []);

  // --- Tempo de Rota (sem tabela do Excel; M/N/O sao formulas da propria linha)
  {
    const aba = arqAba('Tempo de Rota');
    const p = lerLinhas(ler(aba));
    const ultimaModelo = Math.max(...[...p.linhas.keys()].filter(r => p.linhas.get(r).celulas.some(c => c.col === 'A')), 2);
    const ult = reescrever(p, {
      primeira: 2, ultimaModelo, cols: letras('A', 'O'), total: viagens.length, minimo: 1,
      valores: (i, r) => {
        const v = viagens[i];
        return { A: v.carga, B: v.rota, C: v.placa, D: nome(v.motorista), E: nome(v.ajudante), F: nome(v.ajudante_2), G: v.setor,
          H: serial(v.iso), I: horaFracao(v.hora_saida), J: serial(isoDe(v.data_retorno)), K: v.observacao || null, L: null,
          M: { f: `H${r}` }, N: { f: `IF(J${r}="","",J${r}-H${r}+1)` }, O: { f: `IF(J${r}="","",J${r})` } };
      }
    });
    gravar(aba, montarXml(p).replace(/<autoFilter ref="([A-Z]+)1:([A-Z]+)\d+"/, `<autoFilter ref="$1${1}:$2${ult}"`));
    const idAba = nomesAbas.indexOf(acharAba('Tempo de Rota'));
    gravar('xl/workbook.xml', ler('xl/workbook.xml').replace(
      new RegExp(`(<definedName name="_xlnm._FilterDatabase" localSheetId="${idAba}"[^>]*>'Tempo de Rota'!\\$[A-Z]+\\$1:\\$[A-Z]+\\$)\\d+`), `$1${ult}`));
  }

  // Tabelas dinamicas atualizam ao abrir; Excel recalcula tudo; sem calcChain velho.
  const pastaCache = path.join(dir, 'xl/pivotCache');
  if (fs.existsSync(pastaCache)) {
    for (const f of fs.readdirSync(pastaCache).filter(f => /^pivotCacheDefinition\d+\.xml$/.test(f))) {
      const arq = 'xl/pivotCache/' + f;
      gravar(arq, ler(arq).replace(/<pivotCacheDefinition([^>]*?)>/, (m0, a) => `<pivotCacheDefinition${a.replace(/ refreshOnLoad="[^"]*"/, '')} refreshOnLoad="1">`));
    }
  }
  gravar('xl/workbook.xml', ler('xl/workbook.xml').replace(/<calcPr([^>]*?)\/>/, (m0, a) => `<calcPr${a.replace(/ fullCalcOnLoad="\d"/, '')} fullCalcOnLoad="1"/>`));
  if (fs.existsSync(path.join(dir, 'xl/calcChain.xml'))) {
    fs.unlinkSync(path.join(dir, 'xl/calcChain.xml'));
    gravar('xl/_rels/workbook.xml.rels', ler('xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain\.xml"\/>/, ''));
    gravar('[Content_Types].xml', ler('[Content_Types].xml').replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
  }

  const zipOut = path.join(tmp, 'saida.zip');
  execFileSync(TAR, ['-a', '-cf', zipOut, '-C', dir, ...fs.readdirSync(dir)]);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.copyFileSync(zipOut, saida);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- Resumo
  const XLSX = require(path.join(__dirname, '..', 'js', 'xlsx.full.min.js'));
  const wbLido = XLSX.read(fs.readFileSync(modelo));
  const bd = XLSX.utils.sheet_to_json(wbLido.Sheets[acharAba('BD')] || {}, { header: 1, defval: '' });
  const colNomeBD = Math.max(0, (bd[0] || []).findIndex(h => /^FUNCION/i.test(String(h).trim())));
  const nomesBD = new Set(bd.slice(1).map(r => nome(r[colNomeBD])).filter(Boolean));
  const conta = req => oc.filter(o => o.requisito === req).length;
  console.log(`\nGerada: ${saida}`);
  console.log(`  Ocorrencias ........ ${oc.length} linhas`);
  console.log(`    Motor ocioso (CCO) ...... ${conta(REQ.motorOcioso)}`);
  console.log(`    Checklist ............... ${conta(REQ.checklist)} motoristas`);
  console.log(`    Fusion .................. ${conta(REQ.fusion)} motoristas`);
  console.log(`    Sinistro ................ ${conta(REQ.sinistro)}`);
  console.log(`    Devolucao ............... ${conta(REQ.devolucao)} (${devs.length} devolucoes ERRO MOTORISTA)`);
  console.log(`    Pontualidade ............ ${conta(REQ.pontualidade)}`);
  console.log(`  Abas de apoio ...... Motor Ocioso ${alertasAba.reduce((t, a) => t + (a.qtd || 1), 0)} alertas, OCORRENCIAS PLN ${ocv.length}, Folgas-Falta ${faltas.length}, Checklist ${checklists.length}, Fusion NA ${fusions.length}, Devolucao ${linhasDev.length}, Tempo de Rota ${viagens.length}`);
  const foraBD = [...new Set(oc.map(o => o.prestador))].filter(n => !nomesBD.has(n)).sort();
  if (foraBD.length) console.log(`  ATENCAO - fora da aba BD (vao aparecer com #N/D): ${foraBD.join('; ')}`);
  const isentos = ocv.filter(o => nome(o.motivo) === 'MOTOR OCIOSO' && isencao(o));
  if (isentos.length) console.log(`  Motor ocioso com isencao (nao entrou): ${isentos.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)}`).join('; ')}`);
  const pendGestor = linhasDev.filter(x => String(x.d.status_gestao || '').startsWith('PENDENTE')).map(x => x.d.numero_protocolo);
  if (pendGestor.length) console.log(`  Devolucao ERRO MOTORISTA ainda sem analise do gestor (entraram assim mesmo): ${pendGestor.join(', ')}`);
  const semEquipe = linhasDev.filter(x => !x.motorista).map(x => x.d.numero_protocolo);
  if (semEquipe.length) console.log(`  ATENCAO - devolucao sem motorista (carga fora do Controle de Viagens): ${semEquipe.join(', ')}`);
  const faltaTrocada = faltas.filter(o => !nome(o.motivo).endsWith(nome(o.funcao)));
  if (faltaTrocada.length) console.log(`  Falta com funcao diferente do motivo no app (entrou pelo nome): ${faltaTrocada.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)} (${o.motivo} / ${o.funcao})`).join('; ')}`);
  const outras = ocv.filter(o => !/^(MOTOR OCIOSO|FALTA AJUDANTE|FALTA MOTORISTA|INCONSISTENCIA CHECK LIST)$/.test(nome(o.motivo)));
  if (outras.length) console.log(`  Para avaliar (estao so na aba OCORRENCIAS PLN): ${outras.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)} - ${o.motivo}`).join('; ')}`);
  const semMot = alertasAba.filter(a => !a.motorista).reduce((t, a) => t + (a.qtd || 1), 0);
  const quando = ultimoSync ? new Date(ultimoSync.finalizado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca';
  console.log(`  Motor ocioso (Power BI) . ${alertasAba.reduce((t, a) => t + (a.qtd || 1), 0)} alertas (sem as placas ${VEICULOS_FORA_MOTOR_OCIOSO.join(', ')}), ${semMot} sem motorista vinculado (ultima sincronizacao: ${quando})`);
  console.log('\nFalta preencher a mao: Acerto Caixa, Cuidado Pneus, Prazo Rota, Fusion desvio (furo de cerca /');
  console.log('entrega fora do local), ferias e folgas, e as isencoes de motor ocioso.');
  console.log('Abonos: apagar a linha ou o Requisito na aba Ocorrencias; falta abonada = ABONADO na Folgas-Falta.');
}

main().catch(e => { console.error('\nERRO: ' + (e.message || e)); process.exit(1); });
