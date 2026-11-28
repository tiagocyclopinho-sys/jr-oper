// =============================================================================
// ATUALIZA O CADASTRO DA PLANILHA DE REQUISITOS PELA RELACAO DO DP (27/11/2026)
//
// O DP manda todo mes a "Relacao de Folha" dos ajudantes (e a dos motoristas).
// Este script compara a lista do DP com a aba Ajudante (ou Motorista) e a BD da
// planilha de requisitos do mes e:
//   - tira quem nao esta mais na lista do DP (desligado);
//   - inclui quem entrou (novato), em ordem alfabetica, copiando a linha de
//     cima (formulas e formato). O novato entra com os Dias DIGITADOS, do 1o dia
//     de trabalho ate o dia 25, como o Victor fazia (ex.: EDIMAR e GLEDSON, 9
//     dias em ago/26). O 1o dia e a 1a viagem dele no Controle de Viagens do
//     periodo; sem viagem, fica a formula de 30 dias e o resumo avisa.
// Na BD so mexe nas colunas B a F (as listas ao lado nao podem andar).
//
// Usa do arquivo do DP so codigo, nome e cidade (nada de valor ou dado
// bancario). O codigo do DP e o mesmo id do cadastro do app; o nome sai do
// cadastro do app quando o 1o nome bate (o DP as vezes vem com sobra no nome).
// O Excel faz as alteracoes (preserva formato e formulas); a planilha precisa
// estar FECHADA. Antes de gravar, guarda uma copia "(antes do DP).xlsx".
//
// Uso:
//   node tools/atualizar_cadastro_requisitos.js AJUDANTE "relacao do DP.xlsx" [AAAAMM] [planilha.xlsx]
//   node tools/atualizar_cadastro_requisitos.js MOTORISTA "relacao do DP.xlsx" [AAAAMM] [planilha.xlsx]
//   --simular ... so mostra o que mudaria, sem gravar.
// =============================================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PASTA_PADRAO = 'S:\\Logistica\\01 - LOGISTICA INFORMATIVO\\20 - VICTOR HUGO\\REQUISITOS';
const XLSX = require(path.join(__dirname, '..', 'js', 'xlsx.full.min.js'));

// Layout das abas da planilha de requisitos.
const ABAS = {
  AJUDANTE: { aba: 'Ajudante', cabecalho: 1, num: 'A', cod: 'B', nome: 'C', cidade: 'D', dias: 'I', tabelaApp: 'ajudantes' },
  MOTORISTA: { aba: 'Motorista', cabecalho: 2, num: 'A', cod: 'B', nome: 'C', cidade: 'D', dias: 'Q', tabelaApp: 'motoristas' }
};

function lerConfig() {
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
  const url = (cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  const key = (cfg.match(/sb_publishable_[A-Za-z0-9_-]+/) || [])[0];
  if (!url || !key) throw new Error('Nao achei a URL/chave do Supabase em js/config.js');
  return { url, key };
}
async function rest(cfg, tabela, query) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const r = await fetch(`${cfg.url}/rest/v1/${tabela}?${query}`, { headers: { apikey: cfg.key, Range: `${de}-${de + 999}` } });
    if (!r.ok) throw new Error(`Erro ao ler ${tabela}: ${r.status} ${await r.text()}`);
    const lote = await r.json();
    tudo.push(...lote);
    if (lote.length < 1000) return tudo;
  }
}

const nome = n => String(n || '').replace(/\s+/g, ' ').trim().toUpperCase();
const semAcento = s => nome(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const primeiro = n => semAcento(n).split(' ')[0];
const isoDe = v => { const s = String(v || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return !m ? '' : m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`; };

// Lista do DP: a aba com o cabecalho "COD" + nome + "Cidade"; linhas com codigo numerico.
function lerDp(arquivo) {
  const wb = XLSX.read(fs.readFileSync(arquivo));
  for (const aba of wb.SheetNames) {
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' });
    const iCab = linhas.findIndex(l => l.some(c => /^COD\.?$/i.test(String(c).trim())) && l.some(c => /^CIDADE$/i.test(String(c).trim())));
    if (iCab < 0) continue;
    const cab = linhas[iCab].map(c => String(c).trim().toUpperCase());
    const cCod = cab.findIndex(c => /^COD\.?$/.test(c));
    // Nome: coluna AJUDANTE(S) / MOTORISTA(S); na relacao de ajudantes o nome
    // vem embaixo de "AJUDANTE", na de motoristas depois da PLACA.
    const cNomeCab = cab.findIndex(c => /^(AJUDANTES?|MOTORISTAS?)$/.test(c));
    const cNome = cNomeCab >= 0 ? cNomeCab : cCod + 1;
    const cCid = cab.indexOf('CIDADE');
    const lista = linhas.slice(iCab + 1).filter(l => /^\d+$/.test(String(l[cCod]).trim()))
      .map(l => ({ cod: Number(String(l[cCod]).trim()), nomeDp: nome(String(l[cNome]).replace(/^[\d.\s]+/, '').replace(/\s+[\d.\-\/]+$/, '')), cidade: String(l[cCid] || '').trim() }));
    if (lista.length) return { aba, lista };
  }
  throw new Error('Nao achei no arquivo do DP uma aba com as colunas COD e Cidade.');
}

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--simular');
  const simular = process.argv.includes('--simular');
  const [funcaoArg, arqDp, argMes, argPlanilha] = args;
  const funcao = nome(funcaoArg);
  const L = ABAS[funcao];
  if (!L || !arqDp) throw new Error('Uso: node tools/atualizar_cadastro_requisitos.js AJUDANTE|MOTORISTA "relacao do DP.xlsx" [AAAAMM] [planilha.xlsx] [--simular]');

  let ano, mes;
  if (argMes) { ano = Number(argMes.slice(0, 4)); mes = Number(argMes.slice(4)); }
  else { const h = new Date(Date.now() - 3 * 3600000); ano = h.getUTCFullYear(); mes = h.getUTCMonth() + 1; }
  const pad = n => String(n).padStart(2, '0');
  const [anoAnt, mesAnt] = mes === 1 ? [ano - 1, 12] : [ano, mes - 1];
  const inicio = `${anoAnt}-${pad(mesAnt)}-26`, fim = `${ano}-${pad(mes)}-25`;
  const planilha = argPlanilha || path.join(PASTA_PADRAO, String(ano), `REQUISITOS MOTORISTAS E AJUDANTES - ${pad(mes)}.${ano}.xlsx`);
  if (!fs.existsSync(planilha)) throw new Error(`Planilha nao encontrada: ${planilha}`);

  const dp = lerDp(arqDp);
  console.log(`DP: ${dp.lista.length} ${funcao.toLowerCase()}s (aba "${dp.aba}")`);
  console.log(`Planilha: ${planilha} (periodo ${inicio} a ${fim})`);

  // Cadastro do app (codigo do DP = id) e viagens do periodo (1o dia do novato).
  const cfg = lerConfig();
  const linhasCadastro = await rest(cfg, L.tabelaApp, 'select=*');
  const cadastro = new Map(linhasCadastro.map(c => [Number(c.id), nome(c.nome)]));
  const admissao = new Map(linhasCadastro.filter(c => c.data_admissao).map(c => [Number(c.id), isoDe(c.data_admissao)]));
  const viagens = (await rest(cfg, 'controle_viagens', 'select=data_saida,motorista,ajudante,ajudante_2,is_deleted'))
    .filter(v => !v.is_deleted).map(v => ({ ...v, iso: isoDe(v.data_saida) })).filter(v => v.iso >= inicio && v.iso <= fim);
  dp.lista.forEach(d => {
    const app = cadastro.get(d.cod);
    d.nome = app && primeiro(app) === primeiro(d.nomeDp) ? app : d.nomeDp;
  });

  // Planilha: linhas da aba e da BD.
  const wb = XLSX.read(fs.readFileSync(planilha));
  const ws = wb.Sheets[L.aba];
  const fimAba = XLSX.utils.decode_range(ws['!ref']).e.r + 1;
  const linhasAba = [];
  for (let r = L.cabecalho + 1; r <= fimAba; r++) {
    const n = ws[L.nome + r] && nome(ws[L.nome + r].v);
    if (n) linhasAba.push({ r, nome: n, cod: ws[L.cod + r] ? Number(ws[L.cod + r].v) : null });
  }
  const bd = wb.Sheets.BD;
  const fimBd = XLSX.utils.decode_range(bd['!ref']).e.r + 1;
  const linhasBd = [];
  for (let r = 2; r <= fimBd; r++) {
    const n = bd['B' + r] && nome(bd['B' + r].v);
    if (n) linhasBd.push({ r, nome: n, cod: bd['C' + r] ? Number(bd['C' + r].v) : null, funcao: bd['D' + r] ? nome(bd['D' + r].v) : '' });
  }

  const noDp = (cod, n) => dp.lista.some(d => d.cod === cod || semAcento(d.nome) === semAcento(n));
  const sair = linhasAba.filter(l => !noDp(l.cod, l.nome));
  const entrar = dp.lista.filter(d => !linhasAba.some(l => l.cod === d.cod || semAcento(l.nome) === semAcento(d.nome)));
  const sairBd = linhasBd.filter(l => l.funcao === funcao && !noDp(l.cod, l.nome));
  const entrarBd = dp.lista.filter(d => !linhasBd.some(l => l.cod === d.cod || semAcento(l.nome) === semAcento(d.nome)));

  // Dias do novato: do 1o dia (admissao no cadastro do app ou 1a viagem no
  // periodo, o que vier antes) ate o dia 25.
  entrar.forEach(d => {
    const nomes = [semAcento(d.nome), primeiro(d.nome)];
    const viagem = viagens.filter(v => [v.motorista, v.ajudante, v.ajudante_2].some(x => nomes.includes(semAcento(x))))
      .reduce((m, v) => (!m || v.iso < m ? v.iso : m), null);
    const adm = admissao.get(d.cod);
    const cands = [viagem, adm && adm <= fim ? adm : null].filter(Boolean).sort();
    let prim = cands[0] || null;
    if (prim && prim < inicio) prim = inicio;
    d.origemInicio = !prim ? '' : prim === adm ? 'admissao no cadastro' : '1a viagem';
    d.primeiroDia = prim;
    d.dias = prim ? Math.round((Date.parse(fim) - Date.parse(prim)) / 86400000) + 1 : null;
  });

  console.log(`\nSai (desligado, nao esta no DP): ${sair.map(l => `${l.nome} (${l.cod})`).join('; ') || 'ninguem'}`);
  console.log(`Entra (novato): ${entrar.map(d => `${d.nome} (${d.cod}, ${d.cidade}) - ${d.dias ? `${d.dias} dia(s), desde ${d.primeiroDia.slice(8)}/${d.primeiroDia.slice(5, 7)} (${d.origemInicio})` : 'SEM VIAGEM NEM ADMISSAO NO PERIODO: fica com a formula de 30 dias, conferir'}`).join('; ') || 'ninguem'}`);
  if (sairBd.length || entrarBd.length) console.log(`BD: sai ${sairBd.map(l => l.nome).join('; ') || 'ninguem'}; entra ${entrarBd.map(d => d.nome).join('; ') || 'ninguem'}`);
  const outros = dp.lista.filter(d => d.nome !== d.nomeDp);
  if (outros.length) console.log(`Nome pelo cadastro do app (o do DP veio diferente): ${outros.map(d => `${d.nomeDp} -> ${d.nome}`).join('; ')}`);
  if (simular || (!sair.length && !entrar.length && !sairBd.length && !entrarBd.length)) {
    console.log(simular ? '\n(--simular: nada foi gravado)' : '\nNada a mudar.');
    return;
  }

  // Copia de seguranca e alteracoes pelo Excel.
  const copia = planilha.replace(/\.xlsx$/i, ' (antes do DP).xlsx');
  if (!fs.existsSync(copia)) fs.copyFileSync(planilha, copia);
  const plano = {
    planilha: path.resolve(planilha), aba: L.aba, cabecalho: L.cabecalho, col: L, funcao,
    sair: sair.map(l => l.nome), entrar: entrar.map(d => ({ nome: d.nome, cod: d.cod, cidade: d.cidade, dias: d.dias })),
    sairBd: sairBd.map(l => l.nome), entrarBd: entrarBd.map(d => ({ nome: d.nome, cod: d.cod, cidade: d.cidade }))
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-dp-'));
  const arqPlano = path.join(tmp, 'plano.json');
  fs.writeFileSync(arqPlano, JSON.stringify(plano), 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'atualizar_cadastro_requisitos.ps1'), arqPlano], { stdio: 'inherit' });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nAtualizada: ${planilha}\nCopia de antes: ${copia}`);
}

main().catch(e => { console.error('\nERRO: ' + (e.message || e)); process.exit(1); });
