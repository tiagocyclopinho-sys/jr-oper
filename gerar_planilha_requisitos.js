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
//       * Motor ocioso do rastreador (Power BI) ........... Media Consumo, uma
//         linha por motorista: "MOTORISTA TEVE N OCORRENCIAS DE MOTOR OCIOSO"
//         (forma correta segundo o Tiago em 26/11/2026, pela quantidade)
//       * Conduta / desvio / atolamento (Oc. Operacional), pelo texto:
//         limpeza, conservacao, dano no veiculo, atolamento ... Sinistro &
//         Conservacao; desvio de rota ... Fusion / FURO DE CERCA (nome antigo,
//         hoje e o monitoramento com a telemetria); checklist ... Manut.
//         Veiculo / Aparelho. As outras condutas ficam para avaliar.
//       * Motivo de pneu (FALTA DE CUIDADO COM PNEUS / PNEU DANIFICADO, Oc.
//         Operacional, 7.9.3) ............................... Cuidado Pneus
//       * Checklist nao realizado (Controle de Viagens) .. Manut. Veiculo /
//         Aparelho, uma linha por motorista com o total (saida + chegada)
//       * Fusion nao iniciado (Controle de Viagens) ...... Fusion / FALTA,
//         uma linha por motorista com o total de viagens
//       * Sinistro (Investigacao de Sinistro) ............ Sinistro & Conservacao
//       * Devolucao ERRO MOTORISTA com Desconto Aplicado = SIM (28/11) .. Devolucao,
//         uma linha para o motorista e uma para cada ajudante da carga
//       * Falta (Oc. Operacional, vale o nome): de ajudante ... Pontualidade;
//         de motorista ... Prazo Rota (motorista e prestador, nao tem
//         pontualidade; so conta se atrasou as entregas - o Victor confere)
//   - abas de apoio, com o detalhe que gerou cada linha: OCORRENCIAS PLN,
//     Folgas-Falta (faltas do Oc. Operacional, todas DESCONTADO: o app so lanca,
//     quem avalia e abona e o Victor Hugo; e folgas da Escala, que contam os
//     dias fora da escala mas nao geram Prazo Rota/Pontualidade), Checklist,
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
// Os nomes vao como estao no app (com a troca de NOMES_PLANILHA): quem nao
// estiver na aba BD aparece com #N/D no Cod. ERP / Funcao - o resumo no fim
// lista quem e.
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

// Caminhao 3/4 e isento de motor ocioso (Tiago, 27/11/2026). As placas isentas
// saem do cadastro de veiculos do JR-Oper (tipo "3/4"): caminhao novo cadastrado
// como 3/4 ja sai isento. A aba Motor Ocioso sai sem elas, e a tabela dinamica
// dela sem filtro de veiculo. (Antes era uma lista fixa, conferida contra o
// grafico da CCO em 26/10, que tinha esquecido a TVD1E68.)
const TIPO_ISENTO_MOTOR_OCIOSO = '3/4';

// Nome no app -> nome na planilha (o das abas Motorista/Ajudante, que vem do
// cadastro do sistema de pagamento). ARMANDO foi cadastrado la como ARMANO.
const NOMES_PLANILHA = { 'ARMANDO LIMA DA CUNHA': 'ARMANO LIMA DA CUNHA' };

// Textos que as formulas das abas Motorista/Ajudante procuram (COUNTIFS).
const REQ = {
  checklist: 'Manut. Veiculo / Aparelho', sinistro: 'Sinistro & Conservação', motorOcioso: 'Média Consumo',
  devolucao: 'Devolução', fusion: 'Fusion', pontualidade: 'Pontualidade', prazoRota: 'Prazo Rota',
  pneus: 'Cuidado Pneus'
};

// Conduta / desvio da Oc. Operacional -> requisito, pelo motivo + causa +
// ocorrencia (combinado com o Tiago em 26/11/2026). Primeira regra que bate vale.
// doMotivo: casa so com o motivo lancado (os de pneu, criados na 7.9.3 para a
// manutencao registrar; "pneu" no texto livre de outra ocorrencia nao conta).
const REGRAS_CONDUTA = [
  { doMotivo: /PNEU/, requisito: REQ.pneus },
  { texto: /DESVIO DE ROTA/, requisito: REQ.fusion, motivo: 'FURO DE CERCA' },
  { texto: /CHECK ?LIST/, requisito: REQ.checklist },
  { texto: /LIMPEZA|CONSERVA|SUJO|ATOLA|SINISTRO|COLIS|ACIDENTE|AVARIA|DANIF|AMASS|QUEBR|BARRA DE PROTE|ARRANH|BATID/, requisito: REQ.sinistro }
];

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
  // Folgas da Escala (escala_folgas): negada ou cancelada nao tira ninguem da escala.
  const folgas = (await rest(cfg, 'escala_folgas', `select=*&is_deleted=is.false&data_inicio=lte.${fim}&data_fim=gte.${inicio}&order=data_inicio.asc`))
    .filter(f => f.parecer !== 'NEGADO' && f.parecer !== 'CANCELADO');
  const alertas = await rest(cfg, 'cco_motor_ocioso',
    `select=*&data=gte.${inicio}&data=lte.${fim}&order=data.asc,hora.asc,veiculo.asc`);
  const placaChave = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const placasIsentas = (await rest(cfg, 'veiculos', 'select=placa,tipo,is_deleted&limit=5000'))
    .filter(v => !v.is_deleted && String(v.tipo || '').trim() === TIPO_ISENTO_MOTOR_OCIOSO).map(v => placaChave(v.placa)).sort();
  const alertasAba = alertas.filter(a => !placasIsentas.includes(placaChave(a.veiculo)));
  const ultimoSync = (await rest(cfg, 'cco_sync_log', 'select=finalizado_em&status=eq.ok&order=id.desc&limit=1'))[0];
  const nomeMotorista = Object.fromEntries(motoristas.map(m => [String(m.id), m.nome]));

  // Equipe de cada carga pelo Controle de Viagens (todas as datas: a
  // devolucao pode abrir dias depois da viagem). Mesmo caminho do app.
  const todasViagens = (await rest(cfg, 'controle_viagens', 'select=carga,rota,motorista,ajudante,ajudante_2,data_saida,data_retorno,is_deleted&limit=20000'))
    .filter(naoApagado).map(v => ({ ...v, iso: isoDe(v.data_saida) }));
  const chaveCarga = c => String(c || '').trim().toUpperCase();
  const equipePorCarga = new Map(todasViagens.map(v => [chaveCarga(v.carga), v]));

  const nomeApp = n => String(n || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const nome = n => { const x = nomeApp(n); return NOMES_PLANILHA[x] || x; };
  const valido = n => n && !/^(N\/A|-+|—)$/.test(n);

  // Nomes e funcao do modelo (abas Motorista, Ajudante e BD): a funcao decide
  // se a falta e Pontualidade (ajudante) ou Prazo Rota (motorista).
  const XLSX = require(path.join(__dirname, '..', 'js', 'xlsx.full.min.js'));
  const wbLido = XLSX.read(fs.readFileSync(modelo));
  const linhasAba = n => XLSX.utils.sheet_to_json(wbLido.Sheets[wbLido.SheetNames.find(s => s.trim().toUpperCase() === n.toUpperCase())] || {}, { header: 1, defval: '' });
  const colunaNome = (linhas, re) => {
    const i = linhas.findIndex(l => l.some(c => re.test(String(c).trim())));
    if (i < 0) return [];
    const j = linhas[i].findIndex(c => re.test(String(c).trim()));
    return linhas.slice(i + 1).map(l => nomeApp(l[j])).filter(Boolean);
  };
  const nomesMotoristaAba = new Set(colunaNome(linhasAba('Motorista'), /^NOME MOTORISTA$/i));
  const nomesAjudanteAba = new Set(colunaNome(linhasAba('Ajudante'), /^NOME AJUDANTE$/i));
  const bd = linhasAba('BD');
  const colNomeBD = Math.max(0, (bd[0] || []).findIndex(h => /^FUNCION/i.test(String(h).trim())));
  const colFuncaoBD = (bd[0] || []).findIndex(h => /^FUN[CÇ][AÃ]O$/i.test(String(h).trim()));
  const funcaoBD = new Map(bd.slice(1).filter(r => nomeApp(r[colNomeBD])).map(r => [nomeApp(r[colNomeBD]), nomeApp(colFuncaoBD >= 0 ? r[colFuncaoBD] : '')]));
  const nomesBD = new Set(funcaoBD.keys());
  const funcaoDe = (n, reserva) => (nomesMotoristaAba.has(n) ? 'MOTORISTA' : nomesAjudanteAba.has(n) ? 'AJUDANTE'
    : funcaoBD.get(n) || nomeApp(reserva));

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

  // Motor ocioso do rastreador: uma linha por motorista com o total do periodo
  // (mesma conta da aba Motor Ocioso e do grafico da CCO). Isencao registrada
  // pela CCO vai no Complemento para o Victor descontar.
  const totalOcioso = new Map();
  alertasAba.filter(a => a.motorista).forEach(a => totalOcioso.set(nome(a.motorista), (totalOcioso.get(nome(a.motorista)) || 0) + (a.qtd || 1)));
  const isencoesPorNome = new Map();
  ocv.filter(o => nome(o.motivo) === 'MOTOR OCIOSO' && isencao(o))
    .forEach(o => isencoesPorNome.set(nome(o.funcionario), [...(isencoesPorNome.get(nome(o.funcionario)) || []), `${ddmm(o.iso)}: ${o.causa || o.ocorrencia}`]));
  [...totalOcioso.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([mot, n]) =>
    add(fim, mot, REQ.motorOcioso, `MOTORISTA TEVE ${n} OCORRÊNCIAS DE MOTOR OCIOSO`,
      isencoesPorNome.has(mot) ? `ISENÇÃO REGISTRADA PELA CCO - ${isencoesPorNome.get(mot).join(' | ')}` : null));

  // Conduta, desvio de rota, atolamento etc.: requisito pelo texto (REGRAS_CONDUTA).
  const textoOcv = o => nome(`${o.motivo} ${o.causa} ${o.ocorrencia}`);
  const regraConduta = o => REGRAS_CONDUTA.find(r => (r.doMotivo ? r.doMotivo.test(nome(o.motivo)) : r.texto.test(textoOcv(o))));
  const gestorPendente = o => (Array.isArray(o.tratativas) ? o.tratativas : [])
    .some(t => t && t.area === 'GESTOR' && String(t.status || '').toUpperCase() !== 'CONCLUIDA');
  const outrasOcv = ocv.filter(o => !/^(MOTOR OCIOSO|FALTA AJUDANTE|FALTA MOTORISTA|INCONSISTENCIA CHECK LIST)$/.test(nome(o.motivo)));
  // Texto do app numa linha so, sem emoji (o desvio vem em formato de mensagem).
  const limpo = t => String(t || '').replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 250);
  outrasOcv.filter(regraConduta).forEach(o => {
    const r = regraConduta(o);
    add(o.iso, o.funcionario, r.requisito, r.motivo || limpo(o.ocorrencia || o.causa || o.motivo),
      [limpo(r.motivo ? o.ocorrencia || o.causa : o.causa), gestorPendente(o) ? '(tratativa do gestor pendente)' : null].filter(Boolean).join(' - '));
  });

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
  // So conta a devolucao com "Desconto Aplicado = SIM" do gestor
  // (desconto_produtividade_gestor), decisao do Tiago em 28/11/2026, igual ao
  // acerto. Substitui a de 26/10 ("todas contam"). A aba Devolucao continua com
  // todas as ERRO MOTORISTA e a coluna Desconto Aplicado, para o Victor conferir;
  // as que ainda estao sem analise do gestor saem no aviso do fim.
  const descontaDev = d => d.desconto_produtividade_gestor === true;
  const motivoDev = d => d.motivo_real_causa_raiz || d.motivo_reclamado;
  const complDev = d => `${d.numero_protocolo || d.numero_devolucao}`;
  const linhasDevConta = linhasDev.filter(x => descontaDev(x.d));
  linhasDevConta.forEach(x => add(x.iso, x.motorista, REQ.devolucao, motivoDev(x.d), complDev(x.d)));
  linhasDevConta.forEach(x => [x.ajudante, x.ajudante2].forEach(a => add(x.iso, a, REQ.devolucao, motivoDev(x.d), complDev(x.d))));

  // Falta (de ajudante ou de motorista): vale o NOME do registro, e a funcao vem
  // da planilha (abas Motorista/Ajudante/BD), nao do motivo lancado no app.
  // Ajudante: Pontualidade e Prazo Rota. Motorista: Prazo Rota (prestador, nao
  // tem pontualidade). Todas vao tambem para a Folgas-Falta como DESCONTADO: o
  // arquivo e o respaldo, o Victor avalia, abona e decide o pagamento.
  //
  // Dias de falta (regra do Tiago, 26/11/2026): os dias da viagem que a pessoa
  // perdeu (saida -> retorno), mas so ate a proxima viagem em que ela saiu. Ex.:
  // faltou hoje numa viagem de 3 dias = 3 dias; se saiu em outra viagem amanha
  // = 1 dia. A viagem perdida e achada pela carga (o app nao liga a falta a
  // viagem); dia ja contado por outra falta da mesma pessoa nao conta de novo.
  //
  // Folga (Escala -> Folgas): conta os dias fora da escala na Folgas-Falta, mas
  // NAO gera Prazo Rota nem Pontualidade. Falta lancada num dia de folga
  // aprovada vale como a folga (sem conduta e sem contar o dia duas vezes).
  const numerosCarga = c => (String(c || '').match(/\d{4,6}/g) || []);
  const viagemDaFalta = o => {
    const nums = numerosCarga(o.carga);
    const perto = todasViagens.filter(v => v.iso && Math.abs(Date.parse(v.iso) - Date.parse(o.iso)) <= 86400000);
    return perto.find(v => chaveCarga(v.carga).replace(/\s+/g, '') === chaveCarga(o.carga).replace(/\s+/g, ''))
      || (nums.length ? perto.find(v => numerosCarga(v.carga).some(n => nums.includes(n))) : null) || null;
  };
  const diaMais = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
  const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const faltas = ocv.filter(o => /^FALTA (AJUDANTE|MOTORISTA)$/.test(nome(o.motivo)))
    .map(o => ({ ...o, funcaoPlanilha: funcaoDe(nome(o.funcionario), o.funcao), viagem: viagemDaFalta(o) }))
    .sort((a, b) => a.iso.localeCompare(b.iso));
  const cargasFaltadas = new Map(); // pessoa -> viagens que ela perdeu (nao valem como "proxima viagem")
  faltas.forEach(o => o.viagem && cargasFaltadas.set(nome(o.funcionario), [...(cargasFaltadas.get(nome(o.funcionario)) || []), o.viagem]));
  // Dias ja contados por pessoa: primeiro os das folgas, depois os das faltas.
  const diasContados = new Map();
  const marcar = (pessoa, de, ate) => {
    const s = diasContados.get(pessoa) || new Set();
    for (let d = de; d <= ate; d = diaMais(d, 1)) s.add(d);
    diasContados.set(pessoa, s);
  };
  const contado = (pessoa, d) => (diasContados.get(pessoa) || new Set()).has(d);
  const folgasPeriodo = folgas.map(f => ({ ...f, pessoa: nome(f.colaborador_nome),
    inicioFolga: f.data_inicio < inicio ? inicio : f.data_inicio, fimFolga: f.data_fim > fim ? fim : f.data_fim }));
  folgasPeriodo.forEach(f => marcar(f.pessoa, f.inicioFolga, f.fimFolga));
  faltas.forEach(o => {
    const pessoa = nome(o.funcionario);
    const folga = folgasPeriodo.find(f => f.pessoa === pessoa && f.data_inicio <= o.iso && f.data_fim >= o.iso);
    if (folga) {
      o.cobertaPorFolga = true;
      o.diasFalta = 0;
      o.obsDias = `DIA DE FOLGA APROVADA (${folga.categoria} DE ${ddmm(folga.data_inicio)} A ${ddmm(folga.data_fim)}): CONTA SO COMO FOLGA, SEM PRAZO ROTA/PONTUALIDADE`;
      return;
    }
    const retorno = o.viagem && isoDe(o.viagem.data_retorno);
    let ate = retorno && retorno >= o.iso ? retorno : o.iso;
    const proxima = todasViagens.filter(v => v.iso > o.iso && !(cargasFaltadas.get(pessoa) || []).includes(v)
      && [v.motorista, v.ajudante, v.ajudante_2].some(n => nome(n) === pessoa))
      .reduce((m, v) => (!m || v.iso < m ? v.iso : m), null);
    if (proxima && proxima <= ate) ate = diaMais(proxima, -1);
    if (ate > fim) ate = fim;
    // Primeiro bloco de dias seguidos ainda nao contados (folga ou outra falta).
    let de = o.iso;
    while (de <= ate && contado(pessoa, de)) de = diaMais(de, 1);
    let ult = de;
    while (ult < ate && !contado(pessoa, diaMais(ult, 1))) ult = diaMais(ult, 1);
    o.inicioFalta = de;
    o.fimFalta = ult;
    o.diasFalta = de <= ate ? diasEntre(de, ult) + 1 : 0;
    if (o.diasFalta) marcar(pessoa, de, ult);
    o.obsDias = !o.viagem ? '1 DIA (VIAGEM DA CARGA NAO ENCONTRADA NO CONTROLE DE VIAGENS)'
      : !retorno ? `${o.diasFalta} DIA(S) (VIAGEM ${o.viagem.carga} SEM DATA DE RETORNO)`
      : !o.diasFalta ? `DIAS JA CONTADOS EM OUTRA FALTA OU FOLGA (VIAGEM ${o.viagem.carga})`
      : `${o.diasFalta} DIA(S) - VIAGEM ${o.viagem.carga} DE ${ddmm(o.viagem.iso)} A ${ddmm(retorno)}${proxima && diaMais(proxima, -1) < retorno ? `, SAIU EM OUTRA VIAGEM EM ${ddmm(proxima)}` : ''}`;
  });
  faltas.filter(o => !o.cobertaPorFolga).forEach(o => {
    const compl = [o.obsDias, o.causa].filter(Boolean).join(' - ');
    if (o.funcaoPlanilha !== 'MOTORISTA') add(o.iso, o.funcionario, REQ.pontualidade, 'FALTA DO COLABORADOR, GEROU ATRASO NA PONTUALIDADE', compl);
    add(o.iso, o.funcionario, REQ.prazoRota, o.funcaoPlanilha === 'MOTORISTA' ? 'FALTA DO MOTORISTA NA ROTA' : 'FALTA DO AJUDANTE NA ROTA', compl);
  });

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

  // --- Folgas-Falta: folgas da Escala e faltas do Oc. Operacional, em ordem de
  // inicio. Falta sai DESCONTADO (o Victor troca para ABONADO); folga sai como o
  // tratamento da Escala (ABONADO) ou DESCONTADO. Uma linha por falta com dias
  // (a que so repete dias ja contados fica so na Ocorrencias); DIAS e a formula
  // da propria tabela (fim - inicio + 1). Folga cortada no periodo 26 -> 25.
  const faltasComDias = faltas.filter(o => o.diasFalta > 0);
  const linhasFolgaFalta = [
    ...folgasPeriodo.map(f => ({ ordem: f.inicioFolga, linha: [serial(f.data_solicitacao || f.data_inicio), f.pessoa,
      funcaoDe(f.pessoa, f.colaborador_tipo), f.categoria, serial(f.inicioFolga), serial(f.fimFolga), undefined,
      f.periodo || 'INTEGRAL', f.parecer, f.substituto ? nome(f.substituto) : null, f.tratamento === 'ABONADO' ? 'ABONADO' : 'DESCONTADO',
      [f.motivo, f.data_inicio !== f.inicioFolga || f.data_fim !== f.fimFolga ? `FOLGA DE ${ddmm(f.data_inicio)} A ${ddmm(f.data_fim)} (CORTADA NO PERIODO)` : null].filter(Boolean).join(' - '),
      'FOLGA (ESCALA)', f.aprovado_por ? `APROVADO POR ${f.aprovado_por}` : null] })),
    ...faltasComDias.map(o => ({ ordem: o.inicioFalta, linha: [serial(o.iso), nome(o.funcionario), o.funcaoPlanilha || nome(o.funcao), nome(o.motivo),
      serial(o.inicioFalta), serial(o.fimFalta), undefined, 'INTEGRAL', null, null, 'DESCONTADO',
      [o.obsDias, o.causa].filter(Boolean).join(' - '), o.ocorrencia, o.acao] }))
  ].sort((a, b) => a.ordem.localeCompare(b.ordem));
  preencherTabela('Folgas-Falta', [...letras('A', 'K'), 'N', 'O', 'P'], linhasFolgaFalta, x => x.linha);

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
  const conta = req => oc.filter(o => o.requisito === req).length;
  console.log(`\nGerada: ${saida}`);
  console.log(`  Ocorrencias ........ ${oc.length} linhas`);
  console.log(`    Media Consumo ........... ${conta(REQ.motorOcioso)} (${totalOcioso.size} motoristas com o total do rastreador + eventos confirmados pela CCO)`);
  console.log(`    Manut. Veiculo/Aparelho . ${conta(REQ.checklist)}`);
  console.log(`    Fusion .................. ${conta(REQ.fusion)}`);
  console.log(`    Sinistro & Conservacao .. ${conta(REQ.sinistro)}`);
  console.log(`    Devolucao ............... ${conta(REQ.devolucao)} (${linhasDevConta.length} de ${devs.length} devolucoes ERRO MOTORISTA com Desconto Aplicado = SIM)`);
  console.log(`    Pontualidade ............ ${conta(REQ.pontualidade)}`);
  console.log(`    Prazo Rota (faltas) ..... ${conta(REQ.prazoRota)}`);
  faltas.forEach(o => console.log(`      falta ${ddmm(o.iso)} ${nome(o.funcionario)} (${o.funcaoPlanilha}): ${o.obsDias}`));
  console.log(`  Folgas (Escala) .... ${folgasPeriodo.length}, so na Folgas-Falta (sem Prazo Rota/Pontualidade)`);
  folgasPeriodo.forEach(f => console.log(`      folga ${ddmm(f.inicioFolga)} a ${ddmm(f.fimFolga)} ${f.pessoa}: ${f.categoria}, ${diasEntre(f.inicioFolga, f.fimFolga) + 1} dia(s), ${f.tratamento === 'ABONADO' ? 'ABONADO' : 'DESCONTADO'}`));
  console.log(`  Abas de apoio ...... Motor Ocioso ${alertasAba.reduce((t, a) => t + (a.qtd || 1), 0)} alertas, OCORRENCIAS PLN ${ocv.length}, Folgas-Falta ${linhasFolgaFalta.length}, Checklist ${checklists.length}, Fusion NA ${fusions.length}, Devolucao ${linhasDev.length}, Tempo de Rota ${viagens.length}`);
  const prestadores = [...new Set([...oc.map(o => o.prestador), ...folgasPeriodo.map(f => f.pessoa)])].sort();
  const foraAbas = prestadores.filter(n => !nomesMotoristaAba.has(n) && !nomesAjudanteAba.has(n));
  if (foraAbas.length) console.log(`  ATENCAO - fora das abas Motorista/Ajudante (ocorrencia/folga nao conta para ninguem): ${foraAbas.join('; ')}`);
  const foraBD = prestadores.filter(n => !nomesBD.has(n) && !foraAbas.includes(n));
  if (foraBD.length) console.log(`  Fora da aba BD (Cod. ERP / Funcao com #N/D, mas a contagem funciona): ${foraBD.join('; ')}`);
  const isentos = ocv.filter(o => nome(o.motivo) === 'MOTOR OCIOSO' && isencao(o));
  if (isentos.length) console.log(`  Motor ocioso com isencao (nao entrou): ${isentos.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)}`).join('; ')}`);
  const pendGestor = linhasDev.filter(x => String(x.d.status_gestao || '').startsWith('PENDENTE')).map(x => x.d.numero_protocolo);
  if (pendGestor.length) console.log(`  ATENCAO - devolucao ERRO MOTORISTA ainda sem analise do gestor (NAO contaram; so contam com Desconto Aplicado = SIM): ${pendGestor.join(', ')}`);
  const semDesconto = linhasDev.filter(x => !descontaDev(x.d) && !String(x.d.status_gestao || '').startsWith('PENDENTE')).map(x => x.d.numero_protocolo);
  if (semDesconto.length) console.log(`  Devolucao ERRO MOTORISTA com Desconto Aplicado = NAO (nao contaram): ${semDesconto.join(', ')}`);
  // O texto da acao do gestor as vezes diz "DESCONTADO" sem a caixa marcada
  // (DEV-236 e 241 em nov/26): o gestor tem de marcar, senao nao conta.
  const textoDiz = linhasDev.filter(x => !descontaDev(x.d) && /DESCONTAD/i.test(x.d.acao_gestor || '') && !/N[AÃ]O\s+(HAVER[AÁ]\s+)?DESCONT/i.test(x.d.acao_gestor || '')).map(x => x.d.numero_protocolo);
  if (textoDiz.length) console.log(`  ATENCAO - a acao do gestor diz DESCONTADO, mas Desconto Aplicado esta desmarcado (nao contaram; o gestor precisa marcar): ${textoDiz.join(', ')}`);
  const semEquipe = linhasDev.filter(x => !x.motorista).map(x => x.d.numero_protocolo);
  if (semEquipe.length) console.log(`  ATENCAO - devolucao sem motorista (carga fora do Controle de Viagens): ${semEquipe.join(', ')}`);
  const faltaTrocada = faltas.filter(o => !nome(o.motivo).endsWith(o.funcaoPlanilha));
  if (faltaTrocada.length) console.log(`  Falta com motivo diferente da funcao na planilha (entrou pela funcao da planilha): ${faltaTrocada.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)} (${o.motivo} / ${o.funcaoPlanilha})`).join('; ')}`);
  const comRegra = outrasOcv.filter(regraConduta);
  if (comRegra.length) console.log(`  Condutas com requisito: ${comRegra.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)} -> ${regraConduta(o).requisito}`).join('; ')}`);
  const outras = outrasOcv.filter(o => !regraConduta(o));
  if (outras.length) console.log(`  Para avaliar (estao so na aba OCORRENCIAS PLN): ${outras.map(o => `${ddmm(o.iso)} ${nome(o.funcionario)} - ${o.motivo}`).join('; ')}`);
  const semMot = alertasAba.filter(a => !a.motorista).reduce((t, a) => t + (a.qtd || 1), 0);
  const quando = ultimoSync ? new Date(ultimoSync.finalizado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'nunca';
  console.log(`  Motor ocioso (Power BI) . ${alertasAba.reduce((t, a) => t + (a.qtd || 1), 0)} alertas (sem os ${placasIsentas.length} caminhoes ${TIPO_ISENTO_MOTOR_OCIOSO}: ${placasIsentas.join(', ')}), ${semMot} sem motorista vinculado (ultima sincronizacao: ${quando})`);
  console.log('\nFalta preencher a mao: Acerto Caixa, Cuidado Pneus fora da Oc. Operacional, Prazo Rota por atraso de entrega, folga/ferias');
  console.log('que nao estiver na Escala, e descontar as isencoes de motor ocioso (vao no Complemento quando a CCO registra).');
  console.log('Abonos: apagar a linha ou o Requisito na aba Ocorrencias; falta abonada = ABONADO na Folgas-Falta.');
}

main().catch(e => { console.error('\nERRO: ' + (e.message || e)); process.exit(1); });
