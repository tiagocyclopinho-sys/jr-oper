// deno-lint-ignore-file no-explicit-any
// =============================================================================
// SYNC VISAO OPERACAO - JR DISTRIBUIDORA
//
// Tira a "foto" mensal dos numeros da apresentacao Visao Operacao (Gerencia e
// Diretoria) direto dos modelos do Power BI (workspace LOGISTICA), via app
// "JR-Oper Sync" (service principal), e grava em vo_indicadores / vo_quadros.
//
// - Mes de referencia M (AAAAMM). Cortes: 26/(M-1) a 25/M. Devolucao, despesa,
//   abastecimento, motoristas e rastreamento: mes cheio. Inventario: 01/01 ate
//   o fim de M.
// - Sem corpo (pg_cron, todo dia): atualiza a previa do mes corrente; o mes
//   anterior e recapturado ate o dia 2 e CONGELADO a partir do dia 3. Depois
//   de congelado, so vo_indicadores.valor_atual muda (lancamentos atrasados).
// - Corpo { "meses": [202601, ...], "congelar": true } recaptura esses meses
//   (carga inicial / correcao). Mes ja fechado so e regravado com "congelar".
//   "secoes": ["horas_extras"] limita a recaptura a essas secoes.
// - Movimentacao CD vem de prod_pontuacao (sync-produtividade) e S.A.C. /
//   troca de veiculo vem das tabelas do proprio Jr-Oper: nao passam por aqui.
// - Hora Extra (workspace GERENCIA, modelo "Hora Extra - PBI"): o modelo e
//   mensal (coluna MES = dia 1 do mes de referencia) e a apresentacao usa so
//   "HORA EXTRA 55%"; a de 100% vai a parte. [Qtd HE] vem como HHHMMSS
//   (3990036 = 399:00:36): aqui vira horas decimais.
//
// Chamada: POST com cabecalho x-sync-token (mesmo 'prod_sync_token' do Vault).
// Deploy com verify_jwt = false. Segredos: PBI_CLIENT_ID e PBI_CLIENT_SECRET.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA
const MODELOS: Record<string, string> = {
  corte: "1a75be77-8337-4df5-817b-1674bee9cc92",
  devolucao: "6cade382-15ce-4e35-8f0e-06b012bec87c",
  despesa: "5420b2cc-7c63-413b-8780-ff473e345f7e",
  abastecimento: "8a0f9774-1599-4d1e-81db-48257f67580b",
  motoristas: "32ddc070-9a95-4ff5-a278-106352d6ed53",
  cco: "417603f5-7aaf-42d9-b376-dd54913dd288",
  hora_extra: "e8f482b2-3cde-441e-b8eb-7c1916f93174",
};
// Modelos fora do LOGISTICA (o app e Colaborador no GERENCIA desde 28/10/2026)
const WORKSPACE_DO_MODELO: Record<string, string> = {
  hora_extra: "d12a419a-cb88-41f7-9c18-702e5ac59b72", // GERENCIA
};
const DIA_CONGELAR = 3;
const TOP = 15;

function chaveServico(): string {
  const novas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (novas) {
    try {
      const k = JSON.parse(novas);
      if (k.default) return k.default;
      const primeira = Object.values(k)[0];
      if (primeira) return String(primeira);
    } catch (_) { /* cai para a chave legada */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", chaveServico(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Power BI
// ---------------------------------------------------------------------------
async function tokenPowerBi(): Promise<string> {
  const clientId = Deno.env.get("PBI_CLIENT_ID");
  const secret = Deno.env.get("PBI_CLIENT_SECRET");
  if (!clientId || !secret) throw new Error("Segredos PBI_CLIENT_ID / PBI_CLIENT_SECRET nao configurados");
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId.trim(),
      client_secret: secret.trim(),
      scope: "https://analysis.windows.net/powerbi/api/.default",
      grant_type: "client_credentials",
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Falha no login do Entra (${r.status}): ${j.error_description ?? j.error ?? "?"}`);
  return j.access_token;
}

// O Power BI limita as consultas por minuto (429): espera e tenta de novo.
async function dax(token: string, modelo: string, query: string): Promise<any[]> {
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(
      `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_DO_MODELO[modelo] ?? WORKSPACE_ID}/datasets/${MODELOS[modelo]}/executeQueries`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
      },
    );
    const txt = await r.text();
    if (r.status === 429 && tentativa < 4) {
      await new Promise((ok) => setTimeout(ok, 20000));
      continue;
    }
    if (!r.ok) throw new Error(`Power BI ${modelo} ${r.status}: ${txt.slice(0, 400)}`);
    return JSON.parse(txt).results?.[0]?.tables?.[0]?.rows ?? [];
  }
}

const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const rot = (v: any) => {
  const s = v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim();
  return s ? (/^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s) : "(Em branco)";
};

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------
type Janela = { de: string; ate: string };

function iso(a: number, m: number, d: number) {
  return new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10);
}
function janelas(am: number) {
  const a = Math.floor(am / 100), m = am % 100;
  return {
    mes: { de: iso(a, m, 1), ate: iso(a, m + 1, 0) },
    fech: { de: iso(a, m - 1, 26), ate: iso(a, m, 25) },
    ano: { de: iso(a, 1, 1), ate: iso(a, m + 1, 0) },
  };
}
function datas(col: string, j: Janela) {
  const [a1, m1, d1] = j.de.split("-").map(Number);
  const [a2, m2, d2] = j.ate.split("-").map(Number);
  return `DATESBETWEEN(${col}, DATE(${a1},${m1},${d1}), DATE(${a2},${m2},${d2}))`;
}
function hojeBrasilia() {
  const h = new Date(Date.now() - 3 * 3600000);
  return { am: h.getUTCFullYear() * 100 + h.getUTCMonth() + 1, dia: h.getUTCDate() };
}
function mesAnterior(am: number) {
  return am % 100 === 1 ? am - 89 : am - 1;
}

// ---------------------------------------------------------------------------
// Secoes: cada uma devolve indicadores (cabecalho) e quadros (graficos)
// ---------------------------------------------------------------------------
type Ind = { indicador: string; valor: number | null; de: string; ate: string };
type Quad = { quadro: string; rotulo: string; ordem: number; valor: number | null; valor2?: number | null; valor3?: number | null };
type Resultado = { ind: Ind[]; quad: Quad[] };

function linhaIndicadores(r: any, j: Janela): Ind[] {
  return Object.entries(r ?? {}).map(([k, v]) => ({ indicador: k.replace(/^\[|\]$/g, ""), valor: num(v), de: j.de, ate: j.ate }));
}

async function quadro(token: string, modelo: string, nome: string, coluna: string, filtro: string, medidas: string[], top = 0): Promise<Quad[]> {
  const cols = medidas.map((m, i) => `"v${i + 1}", ${m}`).join(", ");
  let q = `SUMMARIZECOLUMNS(${coluna}, ${filtro}, ${cols})`;
  if (top) q = `TOPN(${top}, ${q}, [v1], DESC)`;
  const rows = await dax(token, modelo, `EVALUATE ${q}`);
  const chave = Object.keys(rows[0] ?? {}).find((k) => !k.startsWith("[")) ?? "";
  const lista = rows
    .filter((r) => r["[v1]"] !== null && r["[v1]"] !== undefined)
    .map((r) => ({ rotulo: rot(r[chave]), valor: num(r["[v1]"]), valor2: num(r["[v2]"]), valor3: num(r["[v3]"]) }));
  // datas em ordem cronologica; o resto do maior para o menor
  const porData = lista.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.rotulo));
  lista.sort((x, y) => porData ? x.rotulo.localeCompare(y.rotulo) : (y.valor ?? 0) - (x.valor ?? 0));
  return lista.map((l, i) => ({ quadro: nome, ordem: i + 1, ...l }));
}

async function soIndicadores(token: string, modelo: string, filtro: string, medidas: Record<string, string>, j: Janela): Promise<Ind[]> {
  const cols = Object.entries(medidas).map(([k, m]) => `"${k}", ${m}`).join(", ");
  const rows = await dax(token, modelo, `EVALUATE CALCULATETABLE(ROW(${cols}), ${filtro})`);
  return linhaIndicadores(rows[0], j);
}

const SECOES: Record<string, (t: string, am: number, soInd: boolean) => Promise<Resultado>> = {
  async cortes(t, am, soInd) {
    const j = janelas(am).fech, f = datas("dim_Calendario[DATA]", j);
    const ind = await soIndicadores(t, "corte", f, { valor: "[Valor Corte]", kg: "[Qt Corte]", pedidos: "[Pedido Cortado]" }, j);
    if (soInd) return { ind, quad: [] };
    const quad = [
      ...await quadro(t, "corte", "produto", "f_PCCORTEI[PRODUTO]", f, ["[Valor Corte]", "[Qt Corte]"], TOP),
      ...await quadro(t, "corte", "dia", "dim_Calendario[DATA]", f, ["[Valor Corte]", "[Qt Corte]"]),
    ];
    return { ind, quad };
  },

  async inventario(t, am, soInd) {
    const j = janelas(am).ano, f = datas("dim_Calendario[DATA]", j);
    const ind = await soIndicadores(t, "corte", f, {
      saldo: "[Sd Invent]", perda: "[Sd Invent Perda]", rendimento: "[Sd Invent Rendimento]", saldo_ly: "[Sd Invent LY]",
    }, j);
    if (soInd) return { ind, quad: [] };
    // Perda / rendimento mes a mes no ano e no anterior (grafico comparativo)
    const a = Math.floor(am / 100), m = am % 100;
    const rows = await dax(t, "corte", `EVALUATE SUMMARIZECOLUMNS(dim_Calendario[Ano], dim_Calendario[Mês],
      ${datas("dim_Calendario[DATA]", { de: iso(a - 1, 1, 1), ate: iso(a, m + 1, 0) })},
      "saldo", [Sd Invent], "perda", [Sd Invent Perda], "rend", [Sd Invent Rendimento])`);
    const quad = rows
      .filter((r) => Number(r["dim_Calendario[Mês]"]) <= m)
      .map((r) => {
        const ano = Number(r["dim_Calendario[Ano]"]), mes = Number(r["dim_Calendario[Mês]"]);
        return {
          quadro: "mes", rotulo: `${ano}-${String(mes).padStart(2, "0")}`, ordem: ano * 100 + mes,
          valor: num(r["[saldo]"]), valor2: num(r["[perda]"]), valor3: num(r["[rend]"]),
        };
      });
    return { ind, quad };
  },

  async devolucao(t, am, soInd) {
    const j = janelas(am).mes, f = datas("dim_CALENDARIO[Data]", j);
    const ind = await soIndicadores(t, "devolucao", f, {
      valor: "[Vl Devolução]", kg: "[Peso Dev]", qtd: "[Qtd Devolução]", ticket: "[Ticket Médio]",
      faturamento: "[Vl Fat Bruto]", faturamento_kg: "[Peso Fat]", pct_dev_fat: "[% Dev/Fat]",
      valor_ly: "[LY Vl Dev]", kg_ly: "[LY Peso Dev]", qtd_ly: "[LY Qtd Dev]", ticket_ly: "[LY Tick Médio]",
    }, j);
    // Faturamento de 26 a 25: base da meta de corte (corte R$ / faturado R$ <= 0,01%)
    const jf = janelas(am).fech;
    ind.push(...await soIndicadores(t, "devolucao", datas("dim_CALENDARIO[Data]", jf), { faturamento_fech: "[Vl Fat Bruto]" }, jf));
    if (soInd) return { ind, quad: [] };
    const quad = [
      ...await quadro(t, "devolucao", "dia", "dim_CALENDARIO[Data]", f, ["[Vl Devolução]"]),
      ...await quadro(t, "devolucao", "motivo", "f_DEVOLUCAO[MOTIVO]", f, ["[Vl Devolução]", "[Qtd Devolução]"]),
      ...await quadro(t, "devolucao", "responsavel", `f_DEVOLUCAO["RESP DEV"]`, f, ["[Vl Devolução]", "[Qtd Devolução]"]),
      ...await quadro(t, "devolucao", "setor", "dim_PCSUPERV[SETOR I]", f, ["[Vl Devolução]"]),
      // devolucao e faturamento por setor do supervisor: meta de 0,20% por seco x frio
      ...await quadro(t, "devolucao", "setor_fat", "dim_PCSUPERV[SETOR I]", f, ["[Vl Fat Bruto]", "[Vl Devolução]"]),
    ];
    return { ind, quad };
  },

  async despesa(t, am, soInd) {
    const j = janelas(am).mes, f = datas("'dCalendário'[Data]", j);
    const ind = await soIndicadores(t, "despesa", f, {
      valor: "[Valor Total]", qtd: "[Qtd Total]", ticket: "[Ticket Médio]", por_dia: "[Total por Data]",
      valor_ly: "[Valor Total (LY)]", qtd_ly: "[Qtd Total (LY)]", ticket_ly: "[Ticket Médio (LY)]", por_dia_ly: "[Total por Data (LY)]",
    }, j);
    if (soInd) return { ind, quad: [] };
    const quad = [
      ...await quadro(t, "despesa", "departamento", "dNome[Dep]", f, ["[Valor Total]"]),
      ...await quadro(t, "despesa", "usuario", "dNome[Nome]", f, ["[Valor Total]", "[Qtd Total]"], TOP),
      ...await quadro(t, "despesa", "dia", "'dCalendário'[Data]", f, ["[Valor Total]"]),
    ];
    return { ind, quad };
  },

  async abastecimento(t, am, soInd) {
    const j = janelas(am).mes, f = datas("d_Calendario[Data]", j);
    const ind = await soIndicadores(t, "abastecimento", f, {
      valor: "[Valor Total]", litros: "[Qtd Total]", preco_medio: "[Preço Médio]",
      preco_min: "[Preço Mínimo]", preco_max: "[Preço Máximo]",
      valor_lm: "[LM Valor Total]", litros_lm: "[LM Qtd Total]", preco_medio_lm: "[LM Preço Med]",
      preco_min_lm: "[LM Preço Min]", preco_max_lm: "[LM Preço Max]",
    }, j);
    if (soInd) return { ind, quad: [] };
    const quad = [
      ...await quadro(t, "abastecimento", "dia", "d_Calendario[Data]", f, ["[Valor Total]", "[Qtd Total]"]),
      ...await quadro(t, "abastecimento", "preco_dia", "d_Calendario[Data]", f, ["[Preço Médio]", "[Preço Mínimo]", "[Preço Máximo]"]),
      ...await quadro(t, "abastecimento", "fornecedor", "f_Abastecimento[Fornecedor]", f, ["[Valor Total]", "[Qtd Total]", "[Preço Médio]"]),
      ...await quadro(t, "abastecimento", "uf", "d_Fornecedor[UF abrev]", f, ["[Valor Total]"]),
      ...await quadro(t, "abastecimento", "combustivel", "f_Abastecimento[Item]", f, ["[Valor Total]", "[Qtd Total]"]),
      ...await quadro(t, "abastecimento", "interno_externo", "f_Abastecimento[Int/Ext]", f, ["[Valor Total]", "[Qtd Total]"]),
    ];
    return { ind, quad };
  },

  async motoristas(t, am, soInd) {
    const j = janelas(am).mes, f = datas("dim_CALENDARIO[Data]", j);
    const ind = await soIndicadores(t, "motoristas", f, {
      peso: "[Total Peso Mot]", viagens: "[Total Viagens Mot]", motoristas_ativos: "[Qtd Motoristas Ativos]",
      ajudantes_ativos: "[Qtd Ajudantes Ativos]", garantido: "[Garantido Mot]",
      peso_palmas: "[Peso Tranb Palmas]", cargas_palmas: "[Qtd Tranb Palmas]", media_palmas: "[Media Transb Palmas]", pct_palmas: "[% Transb]",
      peso_maraba: "[Peso Transb Marabá]", cargas_maraba: "[Qtd Tranb Marabá]", media_maraba: "[Media Transb Marabá]", pct_maraba: "[% Transb Marabá]",
      peso_maraba_ly: "[Peso Marabá LY]", cargas_maraba_ly: "[Qtd Carga Marabá LY]",
    }, j);
    if (soInd) return { ind, quad: [] };
    const naoBranco = (q: Quad[]) => q.filter((l) => l.rotulo !== "(Em branco)");
    const quad = [
      ...naoBranco(await quadro(t, "motoristas", "motorista", "dim_PCEMPR[NOME]", f, ["[Total Peso Mot]", "[Total Viagens Mot]", "[% Garantido Mot]"])),
      ...naoBranco(await quadro(t, "motoristas", "ajudante", "dim_PCEMPR[NOME]", f, ["[Total Peso Ajud]", "[Total Viagens Ajud]", "[% Garantido Ajud]"])),
      ...await quadro(t, "motoristas", "palmas_dia", "dim_CALENDARIO[Data]", f, ["[Peso Tranb Palmas]", "[Qtd Tranb Palmas]", "[Media Transb Palmas]"]),
    ];
    // Maraba mes a mes no ano, com o mesmo mes do ano anterior (grafico comparativo)
    const a = Math.floor(am / 100), m = am % 100;
    const mar = await dax(t, "motoristas", `EVALUATE SUMMARIZECOLUMNS(dim_CALENDARIO[Ano], dim_CALENDARIO[Mês],
      ${datas("dim_CALENDARIO[Data]", { de: iso(a, 1, 1), ate: iso(a, m + 1, 0) })},
      "p", [Peso Transb Marabá], "q", [Qtd Tranb Marabá], "ly", [Peso Marabá LY])`);
    for (const r of mar) {
      const mes = Number(r["dim_CALENDARIO[Mês]"]);
      if (mes > m) continue;
      quad.push({ quadro: "maraba_mes", rotulo: `${a}-${String(mes).padStart(2, "0")}`, ordem: a * 100 + mes,
        valor: num(r["[p]"]), valor2: num(r["[q]"]), valor3: num(r["[ly]"]) });
    }
    return { ind, quad };
  },

  async horas_extras(t, am, soInd) {
    const a = Math.floor(am / 100), m = am % 100;
    const j = janelas(am).fech;
    // [Qtd HE] e HHHMMSS; passa para horas decimais
    const horas = (v: any) => {
      const n = num(v);
      if (n === null) return null;
      return Math.floor(n / 10000) + Math.floor((n % 10000) / 100) / 60 + (n % 100) / 3600;
    };
    const tipo = (t55: boolean) => `'fHora Extra'[HORA EXTRA] = "HORA EXTRA ${t55 ? "55" : "100"}%"`;
    const mes = (aa: number, mm: number) => `'fHora Extra'[MÊS] = DATE(${aa},${mm},1)`;
    const linha = async (filtros: string) => {
      const r = (await dax(t, "hora_extra", `EVALUATE CALCULATETABLE(ROW("qtd", [Qtd HE], "vl", [Valor HE],
        "pessoas", DISTINCTCOUNT('fHora Extra'[FUNCIONÁRIO])), ${filtros})`))[0] ?? {};
      return { horas: horas(r["[qtd]"]), valor: num(r["[vl]"]), pessoas: num(r["[pessoas]"]) };
    };
    const h55 = await linha(`${mes(a, m)}, ${tipo(true)}`);
    const h100 = await linha(`${mes(a, m)}, ${tipo(false)}`);
    const ly = await linha(`${mes(a - 1, m)}, ${tipo(true)}`);
    const ind: Ind[] = [
      { indicador: "valor", valor: h55.valor }, { indicador: "horas", valor: h55.horas },
      { indicador: "funcionarios", valor: h55.pessoas },
      { indicador: "valor_100", valor: h100.valor }, { indicador: "horas_100", valor: h100.horas },
      { indicador: "valor_ly", valor: ly.valor }, { indicador: "horas_ly", valor: ly.horas },
    ].map((i) => ({ ...i, de: j.de, ate: j.ate }));
    if (soInd) return { ind, quad: [] };

    const grupo = async (nome: string, colunas: string, filtros: string) => {
      const rows = await dax(t, "hora_extra", `EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS(${colunas}, "qtd", [Qtd HE], "vl", [Valor HE]), ${filtros})`);
      return rows.filter((r) => r["[vl]"] !== null);
    };
    const quad: Quad[] = [];
    const porSetor = await grupo("setor", "'fHora Extra'[SETOR]", `${mes(a, m)}, ${tipo(true)}`);
    porSetor.sort((x, y) => y["[vl]"] - x["[vl]"]).forEach((r, i) => quad.push({
      quadro: "setor", rotulo: rot(r["fHora Extra[SETOR]"]), ordem: i + 1, valor: num(r["[vl]"]), valor2: horas(r["[qtd]"]),
    }));
    // Funcionario: rotulo "SETOR | NOME" (a mesma pessoa pode ter HE em dois setores)
    const porPessoa = await grupo("funcionario", "'fHora Extra'[SETOR], 'fHora Extra'[FUNCIONÁRIO]", `${mes(a, m)}, ${tipo(true)}`);
    porPessoa.sort((x, y) => y["[vl]"] - x["[vl]"]).forEach((r, i) => quad.push({
      quadro: "funcionario", rotulo: `${rot(r["fHora Extra[SETOR]"])} | ${rot(r["fHora Extra[FUNCIONÁRIO]"])}`, ordem: i + 1,
      valor: num(r["[vl]"]), valor2: horas(r["[qtd]"]),
    }));
    // Ultimos 12 meses (grafico "Valor HE por mes")
    const ini = new Date(Date.UTC(a, m - 12, 1));
    const hist = await grupo("mes", "'fHora Extra'[MÊS]",
      `${tipo(true)}, 'fHora Extra'[MÊS] >= DATE(${ini.getUTCFullYear()},${ini.getUTCMonth() + 1},1), 'fHora Extra'[MÊS] <= DATE(${a},${m},1)`);
    hist.forEach((r) => {
      const d = String(r["fHora Extra[MÊS]"]).slice(0, 7);
      quad.push({ quadro: "mes", rotulo: d, ordem: Number(d.replace("-", "")), valor: num(r["[vl]"]), valor2: horas(r["[qtd]"]) });
    });
    return { ind, quad };
  },

  async rastreamento(t, am, soInd) {
    const j = janelas(am).mes, f = datas("'dCalendário'[Data]", j);
    const ind = await soIndicadores(t, "cco", f, { ocorrencias: "[Ocorrência Moov]", sem_vinculo: "[Ocorrências Sem Vínculo]" }, j);
    if (soInd) return { ind, quad: [] };
    const quad = [
      ...await quadro(t, "cco", "motivo", "fMoov[Violação]", f, ["[Ocorrência Moov]"]),
      ...await quadro(t, "cco", "vinculo", "fMoov[Status Vínculo]", f, ["[Ocorrência Moov]"]),
      ...await quadro(t, "cco", "motorista", "fMoov[Motorista Resp]", f, ["[Ocorrência Moov]"], TOP),
      ...await quadro(t, "cco", "faixa_horaria", "fMoov[Faixa Horária]", f, ["[Ocorrência Moov]"]),
      ...await quadro(t, "cco", "dia", "'dCalendário'[Data]", f, ["[Ocorrência Moov]"]),
    ];
    return { ind, quad };
  },
};

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------
async function capturar(token: string, am: number, modo: "completo" | "valor_atual", secoes: string[] = []) {
  const agora = new Date().toISOString();
  const resumo: Record<string, string> = {};
  // Uma secao por vez, para nao estourar o limite de consultas do Power BI
  for (const [secao, fn] of Object.entries(SECOES)) {
    if (secoes.length && !secoes.includes(secao)) continue;
    try {
      const r = await fn(token, am, modo === "valor_atual");
      if (modo === "valor_atual") {
        for (const i of r.ind) {
          const { error } = await db.from("vo_indicadores")
            .update({ valor_atual: i.valor, atualizado_em: agora })
            .eq("ano_mes", am).eq("secao", secao).eq("indicador", i.indicador);
          if (error) throw error;
        }
      } else {
        const ind = r.ind.map((i) => ({ ano_mes: am, secao, ...i, valor_atual: i.valor, atualizado_em: agora }));
        const quad = r.quad.map((q) => ({ ano_mes: am, secao, ...q, atualizado_em: agora }));
        const { error: e1 } = await db.from("vo_indicadores").delete().eq("ano_mes", am).eq("secao", secao);
        if (e1) throw e1;
        const { error: e2 } = await db.from("vo_quadros").delete().eq("ano_mes", am).eq("secao", secao);
        if (e2) throw e2;
        if (ind.length) { const { error } = await db.from("vo_indicadores").insert(ind); if (error) throw error; }
        for (let i = 0; i < quad.length; i += 1000) {
          const { error } = await db.from("vo_quadros").insert(quad.slice(i, i + 1000));
          if (error) throw error;
        }
      }
      resumo[secao] = "ok";
    } catch (e: any) {
      resumo[secao] = `erro: ${e?.message ?? e}`;
    }
  }
  return resumo;
}

const completo = (resumo: Record<string, string>) => Object.values(resumo).every((s) => s === "ok");

async function statusDe(am: number): Promise<string | null> {
  const { data } = await db.from("vo_periodos").select("status").eq("ano_mes", am).maybeSingle();
  return data?.status ?? null;
}

async function marcar(am: number, congelar: boolean) {
  const agora = new Date().toISOString();
  const linha: any = { ano_mes: am, atualizado_em: agora, status: congelar ? "fechado" : "aberto" };
  if (congelar) linha.congelado_em = agora;
  const { error } = await db.from("vo_periodos").upsert(linha);
  if (error) throw error;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });

  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const body: any = await req.json().catch(() => ({}));
  const pedidos: number[] = Array.isArray(body?.meses)
    ? body.meses.map(Number).filter((m: number) => m > 202000 && m % 100 >= 1 && m % 100 <= 12)
    : [];

  const { data: log } = await db.from("vo_sync_log")
    .insert({ meses: pedidos.length ? pedidos.join(",") : "automatico" }).select("id").single();
  const detalhe: Record<string, any> = {};
  try {
    const token = await tokenPowerBi();
    if (pedidos.length) {
      for (const am of pedidos) {
        if ((await statusDe(am)) === "fechado" && !body.congelar) { detalhe[am] = "fechado (use congelar: true)"; continue; }
        detalhe[am] = await capturar(token, am, "completo", Array.isArray(body.secoes) ? body.secoes.map(String) : []);
        // Mes incompleto nunca e congelado: fica aberto para a proxima rodada
        await marcar(am, !!body.congelar && completo(detalhe[am]));
      }
    } else {
      const { am, dia } = hojeBrasilia();
      const ant = mesAnterior(am);
      if ((await statusDe(ant)) === "fechado") {
        detalhe[ant] = await capturar(token, ant, "valor_atual");
      } else {
        detalhe[ant] = await capturar(token, ant, "completo");
        await marcar(ant, dia >= DIA_CONGELAR && completo(detalhe[ant]));
      }
      detalhe[am] = await capturar(token, am, "completo");
      await marcar(am, false);
    }
    const falhas = Object.values(detalhe).some((d) => typeof d === "object" && Object.values(d).some((s: any) => String(s).startsWith("erro")));
    await db.from("vo_sync_log").update({
      finalizado_em: new Date().toISOString(), status: falhas ? "parcial" : "ok", detalhe,
    }).eq("id", log?.id);
    return json(200, { ok: !falhas, detalhe });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("sync-visao-operacao:", msg);
    await db.from("vo_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "erro", erro: msg, detalhe,
    }).eq("id", log?.id);
    return json(500, { ok: false, erro: msg, detalhe });
  }
});
