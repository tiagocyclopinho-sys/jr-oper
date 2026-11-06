// deno-lint-ignore-file no-explicit-any
// =============================================================================
// SYNC CUSTO DE GESTAO - JR DISTRIBUIDORA (migration 73, 06/11/2026)
//
// Combustivel e despesa de cartao sobre peso e faturamento, por gerente comercial,
// supervisor e motorista. Mes cheio. Grava em vo_indicadores / vo_quadros, secao
// 'custo_gestao'. Fica fora da sync-visao-operacao para nao travar o congelamento.
//
// - Gerente e supervisor: combustivel do carro de cada um, pela placa e pelo periodo
//   de vo_veiculo_responsavel. Mes sem carro confirmado fica vazio, nao zero.
// - Motorista: abastecimento da placa dividido pelo peso das cargas de cada motorista
//   naquela placa, sobre [Total Peso Mot]. O modelo nao tem placa: CODVEICULO -> placa
//   vem de vo_veiculo_codigo, que aprende cruzando a carga com o controle_viagens.
// - Nomes: dNome (Despesa) nao bate com o WinThor em alguns casos; ALIAS corrige aqui.
// - A Equipe Gladiador e supervisionada pelo gerente Carlos Alexandre: entra so na
//   carteira dele.
//
// Chamada: POST com x-sync-token. Corpo vazio = mes atual e anterior (se aberto).
// { "meses": [202610] } regrava esses meses, mesmo fechados (no maximo 4 por chamada).
// Deploy com verify_jwt = false. Segredos: PBI_CLIENT_ID e PBI_CLIENT_SECRET.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA
const MODELOS: Record<string, string> = {
  devolucao: "6cade382-15ce-4e35-8f0e-06b012bec87c",
  despesa: "5420b2cc-7c63-413b-8780-ff473e345f7e",
  abastecimento: "8a0f9774-1599-4d1e-81db-48257f67580b",
  motoristas: "32ddc070-9a95-4ff5-a278-106352d6ed53",
};
const SECAO = "custo_gestao";
const ALIAS: Record<string, string> = {
  "ADEMAR FILHO SILVA DE OLIVEIRA": "ADEMAR FILHO DE OLIVEIRA",
  "NILMAR PEREIRA DOS SANTOS": "NILMAR PEREIRA DOS SANTOS SOUZA",
  "ARMANO LIMA DA CUNHA": "ARMANDO LIMA DA CUNHA",
  "FRANSOA FIGUEREDO ALENCAR": "FRANSOA FIGUEIREDO ALENCAR",
};

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

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
    const r = await fetch(`https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets/${MODELOS[modelo]}/executeQueries`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
    });
    const txt = await r.text();
    if (r.status === 429 && tentativa < 4) {
      await new Promise((ok) => setTimeout(ok, 20000));
      continue;
    }
    if (!r.ok) throw new Error(`Power BI ${modelo} ${r.status}: ${txt.slice(0, 400)}`);
    return JSON.parse(txt).results?.[0]?.tables?.[0]?.rows ?? [];
  }
}

const n0 = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? 0 : Number(v));
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
const chave = (s: any) => {
  const k = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  return ALIAS[k] ?? k;
};
const iso = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d)).toISOString().slice(0, 10);
const datas = (col: string, a: number, m: number) => {
  const fim = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `DATESBETWEEN(${col}, DATE(${a},${m},1), DATE(${a},${m},${fim}))`;
};
const mesAnterior = (am: number) => (am % 100 === 1 ? am - 89 : am - 1);
function hojeBrasilia() {
  const h = new Date(Date.now() - 3 * 3600000);
  return h.getUTCFullYear() * 100 + h.getUTCMonth() + 1;
}

// Numero da carga do controle_viagens -> placa (o campo pode ter "43424 / 43425")
async function placaDasCargas(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await db.from("controle_viagens").select("carga,placa")
      .or("is_deleted.is.null,is_deleted.is.false").order("id").range(de, de + 999);
    if (error) throw error;
    for (const v of data ?? []) {
      const placa = String(v.placa ?? "").trim().toUpperCase();
      if (!placa) continue;
      for (const c of String(v.carga ?? "").match(/\d+/g) ?? []) mapa.set(c, placa);
    }
    if ((data ?? []).length < 1000) break;
  }
  return mapa;
}

async function capturar(token: string, am: number) {
  const a = Math.floor(am / 100), m = am % 100;
  const de = iso(a, m, 1), ate = iso(a, m + 1, 0);

  const abast = await dax(token, "abastecimento", `EVALUATE SUMMARIZECOLUMNS(f_Abastecimento[Placa], d_Calendario[Data],
    ${datas("d_Calendario[Data]", a, m)}, "v", [Valor Total], "l", [Qtd Total])`);
  const fat = await dax(token, "devolucao", `EVALUATE SUMMARIZECOLUMNS(dim_PCGERENTE[NOMEGERENTE], dim_PCSUPERV[NOME],
    ${datas("dim_CALENDARIO[Data]", a, m)}, "fat", [Vl Fat Bruto], "kg", [Peso Fat])`);
  const desp = await dax(token, "despesa", `EVALUATE SUMMARIZECOLUMNS(dNome[Nome], ${datas("'dCalendário'[Data]", a, m)}, "v", [Valor Total])`);
  const cargas = await dax(token, "motoristas", `EVALUATE SUMMARIZECOLUMNS(f_MOTORISTA[NUMCAR], f_MOTORISTA[CODVEICULO], dim_PCEMPR[NOME],
    ${datas("dim_CALENDARIO[Data]", a, m)}, "kg", SUM(f_MOTORISTA[TOTPESO]), "vl", SUM(f_MOTORISTA[VLTOTAL]))`);
  const pesos = await dax(token, "motoristas", `EVALUATE SUMMARIZECOLUMNS(dim_PCEMPR[NOME], ${datas("dim_CALENDARIO[Data]", a, m)}, "tot", [Total Peso Mot])`);

  // Veiculo -> placa: aprende pelas cargas com viagem no Jr-Oper e guarda para os meses antigos
  const doOper = await placaDasCargas();
  const contagem: Record<string, Record<string, number>> = {};
  for (const c of cargas) {
    const cod = String(c["f_MOTORISTA[CODVEICULO]"] ?? ""), placa = doOper.get(String(c["f_MOTORISTA[NUMCAR]"] ?? ""));
    if (cod && placa) ((contagem[cod] ||= {})[placa] = ((contagem[cod] ||= {})[placa] ?? 0) + 1);
  }
  const { data: codigos, error: eCod } = await db.from("vo_veiculo_codigo").select("codveiculo,placa,cargas");
  if (eCod) throw eCod;
  const placaDe = new Map<string, string>((codigos ?? []).map((c: any) => [String(c.codveiculo), c.placa]));
  const qtdDe = new Map<string, number>((codigos ?? []).map((c: any) => [String(c.codveiculo), c.cargas]));
  const novos: any[] = [];
  for (const [cod, pl] of Object.entries(contagem)) {
    const [placa, qtd] = Object.entries(pl).sort((x, y) => y[1] - x[1])[0];
    if (!placaDe.has(cod) || qtd >= (qtdDe.get(cod) ?? 0)) {
      placaDe.set(cod, placa);
      novos.push({ codveiculo: cod, placa, cargas: qtd, atualizado_em: new Date().toISOString() });
    }
  }
  if (novos.length) { const { error } = await db.from("vo_veiculo_codigo").upsert(novos); if (error) throw error; }

  // Abastecimento por placa, com o dia para respeitar o periodo de cada responsavel
  const abs = abast.map((r) => ({
    placa: String(r["f_Abastecimento[Placa]"] ?? "").trim().toUpperCase(),
    dia: String(r["d_Calendario[Data]"] ?? "").slice(0, 10), v: n0(r["[v]"]), l: n0(r["[l]"]),
  })).filter((r) => r.v);
  const combPlaca: Record<string, number> = {};
  for (const r of abs) combPlaca[r.placa] = (combPlaca[r.placa] ?? 0) + r.v;

  const { data: resp, error: eResp } = await db.from("vo_veiculo_responsavel").select("placa,nome,de,ate");
  if (eResp) throw eResp;
  const combPessoa: Record<string, number> = {}; // so quem tem carro confirmado no mes
  for (const p of resp ?? []) {
    if (p.de > ate || (p.ate && p.ate < de)) continue;
    const k = chave(p.nome);
    combPessoa[k] = combPessoa[k] ?? 0;
    for (const r of abs) if (r.placa === p.placa && r.dia >= p.de && (!p.ate || r.dia <= p.ate)) combPessoa[k] += r.v;
  }
  const despPessoa: Record<string, number> = {};
  for (const r of desp) { const k = chave(r["dNome[Nome]"]); despPessoa[k] = (despPessoa[k] ?? 0) + n0(r["[v]"]); }

  // Carteiras
  const gerentes: Record<string, { fat: number; kg: number }> = {};
  const sups: Record<string, { fat: number; kg: number; g: Record<string, number> }> = {};
  let fatTotal = 0, kgTotal = 0;
  for (const r of fat) {
    const f = n0(r["[fat]"]), kg = n0(r["[kg]"]);
    if (!f && !kg) continue;
    fatTotal += f; kgTotal += kg;
    const g = chave(r["dim_PCGERENTE[NOMEGERENTE]"]), s = chave(r["dim_PCSUPERV[NOME]"]);
    if (g) { const e = (gerentes[g] ||= { fat: 0, kg: 0 }); e.fat += f; e.kg += kg; }
    if (s && !/GLADIADOR/.test(s)) { const e = (sups[s] ||= { fat: 0, kg: 0, g: {} }); e.fat += f; e.kg += kg; e.g[g] = (e.g[g] ?? 0) + f; }
  }
  const quad: any[] = [];
  const add = (quadro: string, rotulo: string, ordem: number, valor: number | null, valor2: number | null = null, valor3: number | null = null) =>
    quad.push({ quadro, rotulo, ordem, valor: r2(valor), valor2: r2(valor2), valor3: r2(valor3) });
  const comb = (k: string) => (k in combPessoa ? combPessoa[k] : null);
  let ordem = 0, combGestores = 0;
  for (const [k, e] of Object.entries(gerentes).sort((x, y) => x[0].localeCompare(y[0]))) {
    ordem++;
    add("pessoa", `Gerente|${k}`, ordem, comb(k), despPessoa[k] ?? 0, e.fat);
    add("pessoa_kg", `Gerente|${k}`, ordem, e.kg);
    combGestores += comb(k) ?? 0;
  }
  const equipe: Record<string, { c: number; d: number }> = {};
  for (const k of Object.keys(gerentes)) equipe[k] = { c: comb(k) ?? 0, d: despPessoa[k] ?? 0 };
  for (const [k, e] of Object.entries(sups).sort((x, y) => x[0].localeCompare(y[0]))) {
    ordem++;
    add("pessoa", `Supervisor|${k}`, ordem, comb(k), despPessoa[k] ?? 0, e.fat);
    add("pessoa_kg", `Supervisor|${k}`, ordem, e.kg);
    combGestores += comb(k) ?? 0;
    const g = Object.entries(e.g).sort((x, y) => y[1] - x[1])[0]?.[0];
    if (g && equipe[g]) { equipe[g].c += comb(k) ?? 0; equipe[g].d += despPessoa[k] ?? 0; }
  }
  for (const [k, e] of Object.entries(equipe).sort((x, y) => x[0].localeCompare(y[0]))) {
    ordem++;
    add("equipe", k, ordem, e.c, e.d, gerentes[k].fat);
    add("equipe_kg", k, ordem, gerentes[k].kg);
  }

  // Motoristas: abastecimento da placa dividido pelo peso das cargas de cada um
  const kgPlaca: Record<string, number> = {};
  const linhas = cargas.map((c) => ({
    nome: chave(c["dim_PCEMPR[NOME]"]), placa: placaDe.get(String(c["f_MOTORISTA[CODVEICULO]"] ?? "")) ?? null,
    kg: n0(c["[kg]"]), vl: n0(c["[vl]"]),
  })).filter((c) => c.nome && c.nome !== "TERCEIROS");
  for (const c of linhas) if (c.placa) kgPlaca[c.placa] = (kgPlaca[c.placa] ?? 0) + c.kg;
  const mot: Record<string, { comb: number | null; n: number; vl: number }> = {};
  for (const c of linhas) {
    const e = (mot[c.nome] ||= { comb: null, n: 0, vl: 0 });
    e.n++; e.vl += c.vl;
    if (c.placa && kgPlaca[c.placa] > 0 && combPlaca[c.placa]) e.comb = (e.comb ?? 0) + combPlaca[c.placa] * c.kg / kgPlaca[c.placa];
  }
  const pesoMot: Record<string, number> = {};
  for (const r of pesos) { const k = chave(r["dim_PCEMPR[NOME]"]); pesoMot[k] = (pesoMot[k] ?? 0) + n0(r["[tot]"]); }
  let combMot = 0;
  for (const [k, e] of Object.entries(mot).sort((x, y) => x[0].localeCompare(y[0]))) {
    ordem++;
    add("motorista", k, ordem, e.comb, despPessoa[k] ?? 0, pesoMot[k] ?? 0);
    add("motorista_carga", k, ordem, e.n, e.vl);
    combMot += e.comb ?? 0;
  }

  const total = (o: Record<string, number>) => Object.values(o).reduce((t, v) => t + v, 0);
  const agora = new Date().toISOString();
  const ind = Object.entries({
    combustivel: total(combPlaca), litros: abs.reduce((t, r) => t + r.l, 0), faturamento: fatTotal, kg_faturado: kgTotal,
    despesa: desp.reduce((t, r) => t + n0(r["[v]"]), 0), comb_gestores: combGestores, comb_motoristas: combMot,
  }).map(([indicador, valor]) => ({ ano_mes: am, secao: SECAO, indicador, valor: r2(valor), valor_atual: r2(valor), de, ate, atualizado_em: agora }));
  const { error: e1 } = await db.from("vo_indicadores").delete().eq("ano_mes", am).eq("secao", SECAO);
  if (e1) throw e1;
  const { error: e2 } = await db.from("vo_quadros").delete().eq("ano_mes", am).eq("secao", SECAO);
  if (e2) throw e2;
  const { error: e3 } = await db.from("vo_indicadores").insert(ind);
  if (e3) throw e3;
  const { error: e4 } = await db.from("vo_quadros").insert(quad.map((q) => ({ ano_mes: am, secao: SECAO, ...q, atualizado_em: agora })));
  if (e4) throw e4;
  return "ok";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });
  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const body: any = await req.json().catch(() => ({}));
  let meses: number[] = Array.isArray(body?.meses) ? body.meses.map(Number).filter((m: number) => m > 202000) : [];
  if (!meses.length) {
    const am = hojeBrasilia(), ant = mesAnterior(am);
    const { data } = await db.from("vo_periodos").select("status").eq("ano_mes", ant).maybeSingle();
    meses = data?.status === "fechado" ? [am] : [ant, am];
  }
  const { data: log } = await db.from("vo_sync_log").insert({ meses: `custo_gestao ${meses.join(",")}` }).select("id").single();
  const detalhe: Record<string, any> = {};
  try {
    const token = await tokenPowerBi();
    for (const am of meses) {
      try { detalhe[am] = { custo_gestao: await capturar(token, am) }; }
      catch (e: any) { detalhe[am] = { custo_gestao: `erro: ${e?.message ?? e}` }; }
    }
    const falhas = Object.values(detalhe).some((d: any) => String(d.custo_gestao).startsWith("erro"));
    await db.from("vo_sync_log").update({ finalizado_em: new Date().toISOString(), status: falhas ? "parcial" : "ok", detalhe }).eq("id", log?.id);
    return json(200, { ok: !falhas, detalhe });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await db.from("vo_sync_log").update({ finalizado_em: new Date().toISOString(), status: "erro", erro: msg, detalhe }).eq("id", log?.id);
    return json(500, { ok: false, erro: msg, detalhe });
  }
});
