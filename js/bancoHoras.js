// =============================================================================
// BANCO DE HORAS DO RH - PARTE COMUM (13/11/2026, 7.3.0)
//
// Um arquivo so para a pagina de envio do RH (/banco-horas), a subaba
// Boletim Gerencial -> Banco de Horas, a previa da Visao Operacao e o gerador.
// Le o relatorio "Saldo de Horas" do RH e faz a conta combinada com o Tiago:
//
//   * Aba BANCO DE HORAS: horas negativas e positivas ate a 10a hora do dia
//     (banco). Aba HORAS EXTRAS: uma linha por pessoa e dia, HE 55% (depois da
//     10a hora) e HE 100% (feriado). A aba SALDO DE HORAS e montada pelo RH em
//     cima dessas duas (com 55% e 100% trocados nas formulas): nao e usada.
//   * Colaborador: saldo do banco (positivas - negativas) + 55% + 100%, cada
//     um na sua coluna.
//   * Setor / supervisor: so os saldos POSITIVOS do banco + 55% + 100%. Quem
//     esta devendo entra como zero: nunca abate o setor nem a HE paga.
//   * O banco positivo e pago como HE 55% no fechamento: a meta do setor (em
//     horas) compara Banco + com 55%. A 100% fica a parte, como na Visao Operacao.
//   * So os setores da operacao. "3 TURNO" e divisao so do RH: e 2o turno.
//   * Cada envio e uma foto acumulada da competencia (26 a 25). Vale o ultimo
//     do dia. Entre duas fotos: banco que subiu = hora feita; negativas que
//     subiram = compensacao realizada.
//   * So horas, sem valor em R$.
//
// No navegador vira window.BancoHoras; no Node, require('../js/bancoHoras.js').
// =============================================================================
(function (raiz, fabrica) {
  const m = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else raiz.BancoHoras = m;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const sem = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const chave = (s) => sem(s).toUpperCase().replace(/\s+/g, ' ').trim();
const nomeLimpo = (s) => String(s == null ? '' : s).toUpperCase().replace(/\s+/g, ' ').trim();
const r2 = (x) => Math.round((x || 0) * 100) / 100;

// "-0,68" | "6,25" | 6.25 | "" -> numero (horas decimais)
function horas(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : NaN;
}

// 0,32 h -> "0:19"; -2,6 -> "-2:36"
function hhmm(h, { sinal = false, zero = '0:00' } = {}) {
  if (h === null || h === undefined || !isFinite(h)) return '—';
  const min = Math.round(Math.abs(h) * 60);
  if (min === 0) return zero;
  const txt = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  return h < 0 ? `-${txt}` : sinal ? `+${txt}` : txt;
}

// --- Competencia -------------------------------------------------------------
// "11/2026" -> "2026-11"; competencia 2026-11 = 26/10/2026 a 25/11/2026
function periodoDeTexto(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `${m[2]}-${String(Number(m[1])).padStart(2, '0')}`;
}
const isoUTC = (dt) => dt.toISOString().slice(0, 10);
function competencia(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return { ini: isoUTC(new Date(Date.UTC(a, m - 2, 26))), fim: isoUTC(new Date(Date.UTC(a, m - 1, 25))) };
}
function periodoAnterior(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const periodoDeAnoMes = (am) => `${Math.floor(am / 100)}-${String(am % 100).padStart(2, '0')}`;
function nomePeriodo(periodo) {
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [a, m] = periodo.split('-').map(Number);
  return `${MES[m - 1]}/${a}`;
}
// Dia de serie do Excel -> "AAAA-MM-DD" (o relatorio do RH usa o sistema de 1904)
function diaExcel(n, data1904) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  const base = data1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return isoUTC(new Date(base + Math.round(n) * 86400000));
}
function diaTexto(v, data1904) {
  if (v instanceof Date) return isoUTC(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  if (typeof v === 'number') return diaExcel(v, data1904);
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

// --- Setores -------------------------------------------------------------------
// Departamento do RH ("01.03.03-CARREGAMENTO FRIOS - 3 TURNO") -> setor da operacao
// (no formato do Power BI, para a meta de hora extra) ou null (fora da operacao).
const SETORES = [
  { setor: 'CARREGAMENTO FRIOS - 1 TURNO', rotulo: 'Carregamento Frios 1º turno' },
  { setor: 'CARREGAMENTO FRIOS - 2 TURNO', rotulo: 'Carregamento Frios 2º turno' },
  { setor: 'CARREGAMENTO SECOS', rotulo: 'Carregamento Secos' },
  { setor: 'PATIO', rotulo: 'Pátio' },
  { setor: 'PORTARIA', rotulo: 'Portaria' },
  { setor: 'LOGISTICA', rotulo: 'Logística' },
  { setor: 'MANUTENCAO', rotulo: 'Manutenção' },
];
const ROTULO = Object.fromEntries(SETORES.map((s) => [s.setor, s.rotulo]));
function setorOper(departamento) {
  const s = chave(departamento).replace(/^[\d.]+\s*-\s*/, '');
  if (/CARREGAMENTO FRIOS/.test(s)) return /1\s*TURNO/.test(s) ? 'CARREGAMENTO FRIOS - 1 TURNO' : 'CARREGAMENTO FRIOS - 2 TURNO';
  if (/CARREGAMENTO SECOS/.test(s)) return 'CARREGAMENTO SECOS';
  if (/PATIO/.test(s)) return 'PATIO';
  if (/PORTARIA/.test(s)) return 'PORTARIA';
  if (/LOGISTICA/.test(s)) return 'LOGISTICA';
  if (/MANUTENCAO/.test(s)) return 'MANUTENCAO';
  return null;
}
const rotuloSetor = (s) => ROTULO[s] || s || '—';
function coligada(filial) {
  const f = String(filial || '').replace(/\D/g, '');
  if (f.startsWith('50699226')) return 'CSA SERVICES';
  if (f.startsWith('24414418')) return 'R SERVIÇOS';
  return filial ? String(filial) : '—';
}

// --- Leitura do arquivo (SheetJS) ----------------------------------------------
function acharAba(wb, alvo) {
  const k = chave(alvo);
  return wb.SheetNames.find((n) => chave(n) === k) || wb.SheetNames.find((n) => chave(n).includes(k));
}
function acharCabecalho(linhas, exigidos) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cab = (linhas[i] || []).map(chave);
    if (exigidos.every((e) => cab.some((c) => e.test(c)))) return { i, cab };
  }
  return null;
}
const col = (cab, re) => cab.findIndex((c) => re.test(c));

// Retorna { periodo, periodoTexto, saldos, he, avisos } ou lanca Error com a
// explicacao para quem esta enviando.
function lerPlanilha(XLSX, dados) {
  const wb = XLSX.read(dados, { type: 'array' });
  const data1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  const avisos = [];

  const abaBanco = acharAba(wb, 'BANCO DE HORAS') || acharAba(wb, 'BASE DADOS');
  if (!abaBanco) throw new Error('Não encontrei a aba BANCO DE HORAS. Confira se é o relatório "Saldo de Horas" do RH.');
  const lb = XLSX.utils.sheet_to_json(wb.Sheets[abaBanco], { header: 1, raw: true, defval: null });
  const hb = acharCabecalho(lb, [/^NOME$/, /NEGATIVAS/, /POSITIVAS/, /PERIODO/]);
  if (!hb) throw new Error(`A aba ${abaBanco} não tem as colunas Nome, Departamento, Horas negativas, Horas positivas e Período.`);
  const cb = { nome: col(hb.cab, /^NOME$/), dep: col(hb.cab, /DEPARTAMENTO/), fil: col(hb.cab, /FILIAL/),
    neg: col(hb.cab, /NEGATIVAS/), pos: col(hb.cab, /POSITIVAS/), per: col(hb.cab, /PERIODO/) };
  const saldos = [], periodos = new Set(), vistos = new Map();
  for (const l of lb.slice(hb.i + 1)) {
    const nome = nomeLimpo(l[cb.nome]);
    if (!nome) continue;
    const neg = horas(l[cb.neg]), pos = horas(l[cb.pos]);
    if (isNaN(neg) || isNaN(pos)) throw new Error(`Horas inválidas para ${nome} na aba ${abaBanco}.`);
    const p = periodoDeTexto(l[cb.per]);
    if (!p) throw new Error(`Período inválido para ${nome}: "${l[cb.per] ?? ''}". O esperado é mês/ano, como 11/2026.`);
    periodos.add(p);
    const k = chave(nome);
    if (vistos.has(k)) {
      // Mesma pessoa duas vezes (troca de departamento no mes): soma as horas
      const s = vistos.get(k); s.negativas = r2(s.negativas + neg); s.positivas = r2(s.positivas + pos);
      avisos.push(`${nome} aparece duas vezes no banco; as horas foram somadas.`);
      continue;
    }
    const s = { nome, departamento: String(l[cb.dep] || '').trim(), filial: cb.fil >= 0 ? String(l[cb.fil] || '').trim() : '',
      negativas: r2(-Math.abs(neg)), positivas: r2(Math.abs(pos)) };
    vistos.set(k, s); saldos.push(s);
  }
  if (!saldos.length) throw new Error(`A aba ${abaBanco} está sem colaboradores.`);
  if (periodos.size > 1) throw new Error(`O arquivo mistura períodos (${[...periodos].join(', ')}). Envie um período por vez.`);
  const periodo = [...periodos][0];
  const comp = competencia(periodo);

  const he = [];
  const abaHe = acharAba(wb, 'HORAS EXTRAS');
  if (!abaHe) {
    avisos.push('O arquivo não tem a aba HORAS EXTRAS: a HE 55% (depois da 10ª hora) e a HE 100% vão sair zeradas.');
  } else {
    const lh = XLSX.utils.sheet_to_json(wb.Sheets[abaHe], { header: 1, raw: true, defval: null });
    const hh = acharCabecalho(lh, [/^NOME$/, /^DIA$|DATA/, /100/, /55/]);
    if (!hh) throw new Error(`A aba ${abaHe} não tem as colunas Nome, Dia, HORA EXTRA 100% e HORA EXTRA 55%.`);
    const ch = { nome: col(hh.cab, /^NOME$/), dia: col(hh.cab, /^DIA$|DATA/), h100: col(hh.cab, /100/), h55: col(hh.cab, /55/) };
    const soma = new Map();
    for (const l of lh.slice(hh.i + 1)) {
      const nome = nomeLimpo(l[ch.nome]);
      if (!nome) continue;
      const dia = diaTexto(l[ch.dia], data1904);
      if (!dia) throw new Error(`Dia inválido para ${nome} na aba ${abaHe}.`);
      if (dia < comp.ini || dia > comp.fim) throw new Error(`${nome} tem hora extra em ${dia.split('-').reverse().join('/')}, fora da competência ${periodo.slice(5)}/${periodo.slice(0, 4)} (26 a 25).`);
      const h55 = horas(l[ch.h55]), h100 = horas(l[ch.h100]);
      if (isNaN(h55) || isNaN(h100)) throw new Error(`Horas inválidas para ${nome} em ${dia} na aba ${abaHe}.`);
      const k = `${chave(nome)}|${dia}`;
      const x = soma.get(k) || { nome, dia, he55: 0, he100: 0 };
      x.he55 = r2(x.he55 + h55); x.he100 = r2(x.he100 + h100);
      soma.set(k, x);
    }
    he.push(...soma.values());
    const noBanco = new Set(saldos.map((s) => chave(s.nome)));
    const fora = [...new Set(he.filter((x) => !noBanco.has(chave(x.nome))).map((x) => x.nome))];
    if (fora.length) avisos.push(`Com hora extra mas fora da aba ${abaBanco} (ficam sem setor): ${fora.join(', ')}.`);
  }
  return { periodo, periodoTexto: `${periodo.slice(5)}/${periodo.slice(0, 4)}`, competencia: comp, saldos, he, avisos, data1904 };
}

// --- Conta -----------------------------------------------------------------------
// saldos: [{nome, departamento, filial, negativas, positivas}]; he: [{nome, dia, he55, he100}]
// opcoes.ate: 'AAAA-MM-DD' (so HE ate esse dia); opcoes.meta(setor) -> horas
function montar(saldos, he, opcoes = {}) {
  const meta = opcoes.meta || (() => null);
  const P = new Map();
  for (const s of saldos || []) {
    const k = chave(s.nome);
    const neg = Number(s.negativas) || 0, pos = Number(s.positivas) || 0;
    P.set(k, { nome: s.nome, departamento: s.departamento, setor: setorOper(s.departamento), coligada: coligada(s.filial),
      negativas: neg, positivas: pos, saldo: r2(pos + neg), he55: 0, he100: 0, semCadastro: false });
  }
  const dias = {};
  for (const x of he || []) {
    if (opcoes.ate && x.dia > opcoes.ate) continue;
    const k = chave(x.nome);
    if (!P.has(k)) P.set(k, { nome: x.nome, departamento: '', setor: null, coligada: '—', negativas: 0, positivas: 0, saldo: 0, he55: 0, he100: 0, semCadastro: true });
    const p = P.get(k);
    p.he55 = r2(p.he55 + (Number(x.he55) || 0)); p.he100 = r2(p.he100 + (Number(x.he100) || 0));
    if (p.setor) {
      const d = (dias[x.dia] ||= { dia: x.dia, he55: 0, he100: 0, pessoas: 0 });
      d.he55 = r2(d.he55 + (Number(x.he55) || 0)); d.he100 = r2(d.he100 + (Number(x.he100) || 0)); d.pessoas++;
    }
  }
  const todos = [...P.values()].map((p) => ({
    ...p,
    bancoPos: Math.max(p.saldo, 0), devendo: Math.min(p.saldo, 0),
    total: r2(p.saldo + p.he55 + p.he100),
    contaSetor: r2(Math.max(p.saldo, 0) + p.he55 + p.he100),
  }));
  const pessoas = todos.filter((p) => p.setor).sort((a, b) => b.contaSetor - a.contaSetor || a.nome.localeCompare(b.nome));
  const S = new Map(SETORES.map((s) => [s.setor, { setor: s.setor, rotulo: s.rotulo, pessoas: 0, bancoPos: 0, devendo: 0, he55: 0, he100: 0 }]));
  for (const p of pessoas) {
    const s = S.get(p.setor);
    s.pessoas++; s.bancoPos += p.bancoPos; s.devendo += p.devendo; s.he55 += p.he55; s.he100 += p.he100;
  }
  const setores = [...S.values()].map((s) => {
    const m = meta(s.setor);
    const previa55 = r2(s.bancoPos + s.he55);
    return { ...s, bancoPos: r2(s.bancoPos), devendo: r2(s.devendo), he55: r2(s.he55), he100: r2(s.he100),
      previa55, total: r2(previa55 + s.he100), meta: m, dentroMeta: m === null || m === undefined ? null : previa55 <= m };
  });
  const tot = setores.reduce((t, s) => ({ bancoPos: t.bancoPos + s.bancoPos, devendo: t.devendo + s.devendo, he55: t.he55 + s.he55,
    he100: t.he100 + s.he100, previa55: t.previa55 + s.previa55, total: t.total + s.total, pessoas: t.pessoas + s.pessoas }),
  { bancoPos: 0, devendo: 0, he55: 0, he100: 0, previa55: 0, total: 0, pessoas: 0 });
  for (const k of Object.keys(tot)) tot[k] = r2(tot[k]);
  return { pessoas, setores, total: tot, dias: Object.values(dias).sort((a, b) => a.dia.localeCompare(b.dia)),
    semCadastro: todos.filter((p) => p.semCadastro), foraOperacao: todos.filter((p) => !p.setor && !p.semCadastro) };
}

// O que mudou entre duas fotos (montar). Banco que subiu = hora feita no banco;
// negativas que cresceram = compensacao realizada (folga, saida antecipada, atraso).
function diferenca(atual, anterior) {
  const A = new Map((anterior ? anterior.pessoas : []).map((p) => [chave(p.nome), p]));
  const pessoas = atual.pessoas.map((p) => {
    const a = A.get(chave(p.nome));
    const base = a || { positivas: 0, negativas: 0, he55: 0, he100: 0, contaSetor: 0, saldo: 0 };
    return { nome: p.nome, setor: p.setor, novo: !a,
      bancoFeito: r2(p.positivas - base.positivas),
      compensado: r2(Math.max(0, base.negativas - p.negativas)),
      // negativas que diminuiram: abono ou ajuste do RH (nao e compensacao)
      abonado: r2(Math.max(0, p.negativas - base.negativas)),
      saldo: r2(p.saldo - base.saldo),
      he55: r2(p.he55 - base.he55), he100: r2(p.he100 - base.he100),
      contaSetor: r2(p.contaSetor - base.contaSetor) };
  });
  const S = {};
  for (const x of pessoas) {
    const s = (S[x.setor] ||= { setor: x.setor, bancoFeito: 0, compensado: 0, he55: 0, he100: 0, contaSetor: 0 });
    s.bancoFeito += x.bancoFeito; s.compensado += x.compensado; s.he55 += x.he55; s.he100 += x.he100; s.contaSetor += x.contaSetor;
  }
  for (const s of Object.values(S)) for (const k of ['bancoFeito', 'compensado', 'he55', 'he100', 'contaSetor']) s[k] = r2(s[k]);
  const total = Object.values(S).reduce((t, s) => ({ bancoFeito: t.bancoFeito + s.bancoFeito, compensado: t.compensado + s.compensado,
    he55: t.he55 + s.he55, he100: t.he100 + s.he100, contaSetor: t.contaSetor + s.contaSetor }), { bancoFeito: 0, compensado: 0, he55: 0, he100: 0, contaSetor: 0 });
  for (const k of Object.keys(total)) total[k] = r2(total[k]);
  return { pessoas, setores: S, total,
    compensacoes: pessoas.filter((x) => x.compensado > 0).sort((a, b) => b.compensado - a.compensado),
    abonos: pessoas.filter((x) => x.abonado > 0).sort((a, b) => b.abonado - a.abonado) };
}

// --- Leitura da nuvem --------------------------------------------------------------
// rest(tabela, query) -> Promise<array> (voRest no app, a do gerador no Node)
async function lerTudo(rest, tabela, query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const parte = await rest(tabela, `${query}&limit=1000&offset=${off}`);
    out.push(...parte);
    if (parte.length < 1000) return out;
  }
}
// Envios validos (o ultimo de cada dia) de um periodo, do mais antigo ao mais novo
function vigentes(envios, periodo) {
  return (envios || []).filter((e) => e.periodo === periodo && !e.substituido)
    .sort((a, b) => String(a.recebido_em).localeCompare(String(b.recebido_em)));
}
async function lerEnvio(rest, id) {
  const [saldos, he] = await Promise.all([
    lerTudo(rest, 'bh_saldos', `select=nome,departamento,filial,negativas,positivas&envio_id=eq.${id}&order=nome`),
    lerTudo(rest, 'bh_he_dia', `select=nome,dia,he55,he100&envio_id=eq.${id}&order=dia,nome`),
  ]);
  return { saldos, he };
}
// Mesmo ponto da competencia anterior: o dia de mesmo numero no mes anterior
function diaMesAnterior(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const ult = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  return isoUTC(new Date(Date.UTC(a, m - 2, Math.min(d, ult))));
}

// Ultima foto do periodo (para a Visao Operacao). null se nada foi enviado ou
// a tabela ainda nao existe.
async function ultimaFoto(rest, periodo, opcoes = {}) {
  let envios;
  try {
    envios = await rest('bh_envios', `select=id,periodo,recebido_em,dia_ref,arquivo,substituido&periodo=eq.${periodo}&substituido=eq.false&order=recebido_em.desc&limit=1`);
  } catch (e) { return null; }
  if (!envios || !envios.length) return null;
  const env = envios[0];
  const { saldos, he } = await lerEnvio(rest, env.id);
  return { envio: env, ...montar(saldos, he, opcoes) };
}

return {
  SETORES, horas, hhmm, chave, periodoDeTexto, competencia, periodoAnterior, periodoDeAnoMes, nomePeriodo, diaExcel,
  setorOper, rotuloSetor, coligada, lerPlanilha, montar, diferenca, lerTudo, vigentes, lerEnvio, diaMesAnterior, ultimaFoto,
};
});
