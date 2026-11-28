// deno-lint-ignore-file no-explicit-any
// =============================================================================
// SYNC ACERTO - JR DISTRIBUIDORA (28/11/2026, migration 87)
//
// Le do modelo "Motorista e Ajudantes" (workspace LOGISTICA) no Power BI, via
// app "JR-Oper Sync" (service principal), o que o acerto de motoristas e
// ajudantes precisa, e grava nas tabelas acerto_pbi_* (sem acesso anon):
//   * f_MOTORISTA (PCCARREG) ..... acerto_pbi_cargas (motorista, ajudantes,
//     transbordo, peso, entregas, rota, saida, faturamento, cancelamento)
//   * f_MOTORISTA ent (PCNFENT) .. acerto_pbi_compras (frete de compra). O
//     motorista sai pelo CPF da nota, resolvido DENTRO do Power BI (dim_PCEMPR,
//     so CPF -> MATRICULA): o CPF nao e gravado aqui.
//   * aux_ROTA ................... acerto_pbi_rotas
// Mes = data da carga no WinThor (DTSAIDA) e data de entrada da compra (DTENT),
// decisao do Tiago em 28/11. Conferido contra nov/26: 1.160/1.160 cargas e
// 60/62 compras batem com o que a 8003/8009 pagou.
//
// Janela: do dia 26 de dois meses atras ate hoje (mes atual e anterior). As
// linhas da janela sao apagadas e gravadas de novo (troca de equipe, cancelamento
// e faturamento mudam depois). Corpo opcional: { "de": "AAAA-MM-DD", "ate": "AAAA-MM-DD" }.
//
// Chamada: POST com cabecalho x-sync-token (token 'prod_sync_token' do Vault;
// o pg_cron envia). Deploy com verify_jwt = false. Segredos: PBI_CLIENT_ID e
// PBI_CLIENT_SECRET (os mesmos da sync-produtividade e da sync-cco).
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA
const DATASET_ID = "32ddc070-9a95-4ff5-a278-106352d6ed53";   // Motorista e Ajudantes

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
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function tokenPowerBi(): Promise<string> {
  const clientId = Deno.env.get("PBI_CLIENT_ID");
  const secret = Deno.env.get("PBI_CLIENT_SECRET");
  if (!clientId || !secret) throw new Error("Segredos PBI_CLIENT_ID / PBI_CLIENT_SECRET nao configurados");
  const r = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId.trim(), client_secret: secret.trim(),
      scope: "https://analysis.windows.net/powerbi/api/.default", grant_type: "client_credentials",
    }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`Falha no login do Entra (${r.status}): ${j.error_description ?? j.error ?? "?"}`);
  return j.access_token;
}

// O modelo responde 429 com consultas seguidas: tenta de novo depois de 20 s.
async function dax(token: string, query: string, tentativa = 1): Promise<any[]> {
  const r = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/executeQueries`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
    },
  );
  const txt = await r.text();
  if (r.status === 429 && tentativa < 3) {
    await new Promise((ok) => setTimeout(ok, 20000));
    return dax(token, query, tentativa + 1);
  }
  if (!r.ok) throw new Error(`Power BI executeQueries ${r.status}: ${txt.slice(0, 500)}`);
  return JSON.parse(txt).results?.[0]?.tables?.[0]?.rows ?? [];
}

const texto = (v: any) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim() || null);
const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
const inteiro = (v: any) => { const n = num(v); return n === null || isNaN(n) || n === 0 ? null : Math.trunc(n); };
const dia = (v: any) => (v ? String(v).slice(0, 10) : null);
const daxData = (iso: string) => { const [a, m, d] = iso.split("-").map(Number); return `DATE(${a}, ${m}, ${d})`; };

// Dia 26 de dois meses atras (horario de Brasilia): cobre o mes atual e o anterior.
function inicioJanela(): string {
  const hoje = new Date(Date.now() - 3 * 3600000);
  return new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 26)).toISOString().slice(0, 10);
}

async function gravar(tabela: string, colunaData: string, de: string, ate: string, linhas: any[], chave: string) {
  const { error: eDel } = await db.from(tabela).delete().gte(colunaData, de).lte(colunaData, ate);
  if (eDel) throw eDel;
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: chave });
    if (error) throw error;
  }
}

async function sincronizar(de: string, ate: string) {
  const token = await tokenPowerBi();
  const agora = new Date().toISOString();

  // ---- cargas (f_MOTORISTA = PCCARREG)
  const rc = await dax(token, `
    EVALUATE
    SELECTCOLUMNS(
      FILTER('f_MOTORISTA', 'f_MOTORISTA'[DTSAIDA] >= ${daxData(de)} && 'f_MOTORISTA'[DTSAIDA] <= ${daxData(ate)}),
      "car", [NUMCAR], "dt", [DTSAIDA], "fat", [DTFAT], "canc", [DT_CANCEL],
      "mot", [CODMOTORISTA], "mtr", [CODMOTTRANSBORDO],
      "aj1", [CODFUNCAJUD], "aj2", [CODFUNCAJUD2], "aj3", [CODFUNCAJUD3], "atr", [CODAJUDTRANSBORDO],
      "peso", [TOTPESO], "ent", [NUMENT], "rota", [CODROTAPRINC], "dest", [DESTINO],
      "vl", [VLTOTAL], "vei", [CODVEICULO])`);
  const cargas = new Map<number, any>();
  for (const r of rc) {
    const numcar = inteiro(r["[car]"]); const dt = dia(r["[dt]"]);
    if (!numcar || !dt) continue;
    cargas.set(numcar, {
      numcar, dtsaida: dt, dtfat: dia(r["[fat]"]), dtcancel: dia(r["[canc]"]),
      codmotorista: inteiro(r["[mot]"]), codmot_transb: inteiro(r["[mtr]"]),
      codajud1: inteiro(r["[aj1]"]), codajud2: inteiro(r["[aj2]"]), codajud3: inteiro(r["[aj3]"]),
      codajud_transb: inteiro(r["[atr]"]),
      peso: num(r["[peso]"]), nument: inteiro(r["[ent]"]), codrota: inteiro(r["[rota]"]),
      destino: texto(r["[dest]"]), vltotal: num(r["[vl]"]), codveiculo: inteiro(r["[vei]"]),
      atualizado_em: agora,
    });
  }

  // ---- compras (f_MOTORISTA ent = PCNFENT), motorista pelo CPF dentro do Power BI
  const rn = await dax(token, `
    EVALUATE
    SELECTCOLUMNS(
      FILTER('f_MOTORISTA ent', NOT ISBLANK('f_MOTORISTA ent'[CPFMOTORISTA])
        && 'f_MOTORISTA ent'[DTENT] >= ${daxData(de)} && 'f_MOTORISTA ent'[DTENT] <= ${daxData(ate)}),
      "nf", [NUMNOTA], "serie", [SERIE], "esp", [ESPECIE], "forn", [CODFORNEC], "dt", [DTENT],
      "mat", MAXX(FILTER(dim_PCEMPR, dim_PCEMPR[CPF] = 'f_MOTORISTA ent'[CPFMOTORISTA]), dim_PCEMPR[MATRICULA]),
      "peso", [TOTPESO], "uf", [UF])`);
  const compras = new Map<string, any>();
  for (const r of rn) {
    const numnota = inteiro(r["[nf]"]); const dt = dia(r["[dt]"]);
    if (!numnota || !dt) continue;
    const serie = texto(r["[serie]"]), especie = texto(r["[esp]"]), codfornec = inteiro(r["[forn]"]);
    const chave = [numnota, serie ?? "", especie ?? "", codfornec ?? ""].join("|");
    const ja = compras.get(chave);
    if (ja) { ja.peso = (ja.peso ?? 0) + (num(r["[peso]"]) ?? 0); continue; }
    compras.set(chave, {
      chave, numnota, serie, especie, codfornec, dtent: dt, matricula: inteiro(r["[mat]"]),
      peso: num(r["[peso]"]), uf: texto(r["[uf]"]), atualizado_em: agora,
    });
  }

  // ---- rotas do WinThor (pequena; regrava inteira)
  const rr = await dax(token, `EVALUATE SELECTCOLUMNS(aux_ROTA, "cod", aux_ROTA[CODROTA], "desc", aux_ROTA[DESCRICAO])`);
  const rotas = rr.map((r) => ({ codrota: inteiro(r["[cod]"]), descricao: texto(r["[desc]"]), atualizado_em: agora })).filter((r) => r.codrota);

  await gravar("acerto_pbi_cargas", "dtsaida", de, ate, [...cargas.values()], "numcar");
  await gravar("acerto_pbi_compras", "dtent", de, ate, [...compras.values()], "chave");
  if (rotas.length) {
    const { error } = await db.from("acerto_pbi_rotas").upsert(rotas, { onConflict: "codrota" });
    if (error) throw error;
  }
  return { cargas: cargas.size, compras: compras.size, rotas: rotas.length,
    compras_sem_motorista: [...compras.values()].filter((c) => !c.matricula).length };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });
  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const body: any = await req.json().catch(() => ({}));
  const de = /^\d{4}-\d{2}-\d{2}$/.test(body?.de ?? "") ? body.de : inicioJanela();
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(body?.ate ?? "") ? body.ate : new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

  const { data: log } = await db.from("acerto_sync_log").insert({ de, ate }).select("id").single();
  try {
    const r = await sincronizar(de, ate);
    await db.from("acerto_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "ok", cargas: r.cargas, compras: r.compras,
    }).eq("id", log?.id);
    return json(200, { ok: true, de, ate, ...r });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("sync-acerto:", msg);
    await db.from("acerto_sync_log").update({ finalizado_em: new Date().toISOString(), status: "erro", erro: msg }).eq("id", log?.id);
    return json(500, { ok: false, erro: msg });
  }
});
