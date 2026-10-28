// deno-lint-ignore-file no-explicit-any
// =============================================================================
// SYNC CCO - JR DISTRIBUIDORA
//
// Le os alertas de MOTOR OCIOSO do rastreador (tabela fMoov do modelo "CCO",
// workspace LOGISTICA) no Power BI, via app "JR-Oper Sync" (service
// principal), e grava em cco_motor_ocioso.
//
// - Janela: do dia 26 de dois meses atras ate hoje (mes de fechamento atual e
//   o anterior). Os dias da janela sao apagados e gravados de novo, porque o
//   motorista vem do vinculo com a viagem e muda quando a viagem e corrigida.
// - Mes mais antigo fica como foi gravado da ultima vez (nao e congelado por
//   status como a produtividade: aqui o dado e o alerta, que nao muda).
// - Linhas identicas no Power BI viram uma linha com qtd (o relatorio da CCO
//   conta todas).
//
// Chamada: POST com cabecalho x-sync-token (mesmo token 'prod_sync_token' do
// Vault usado pela sync-produtividade; o pg_cron envia). Opcional no corpo:
// { "de": "AAAA-MM-DD" } para recarregar desde outra data.
// Deploy com verify_jwt = false. Segredos: PBI_CLIENT_ID e PBI_CLIENT_SECRET.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA
const DATASET_ID = "417603f5-7aaf-42d9-b376-dd54913dd288";   // CCO

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

async function dax(token: string, query: string): Promise<any[]> {
  const r = await fetch(
    `https://api.powerbi.com/v1.0/myorg/groups/${WORKSPACE_ID}/datasets/${DATASET_ID}/executeQueries`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
    },
  );
  const txt = await r.text();
  if (!r.ok) throw new Error(`Power BI executeQueries ${r.status}: ${txt.slice(0, 500)}`);
  return JSON.parse(txt).results?.[0]?.tables?.[0]?.rows ?? [];
}

const texto = (v: any) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, " ").trim() || null);
const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));

// Dia 26 de dois meses atras (horario de Brasilia).
function inicioJanela(): string {
  const hoje = new Date(Date.now() - 3 * 3600000);
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 2, 26));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sincronizacao
// ---------------------------------------------------------------------------
async function sincronizar(de: string) {
  const token = await tokenPowerBi();
  const [a, m, d] = de.split("-").map(Number);
  const rows = await dax(token, `
    EVALUATE
    SELECTCOLUMNS(
      FILTER(fMoov, fMoov[Violação] = "MOTOR OCIOSO" && fMoov[Data] >= DATE(${a}, ${m}, ${d})),
      "Veiculo", fMoov[Veículo], "Data", fMoov[Data], "Hora", fMoov[Hora],
      "Regra", fMoov[Título da Regra.2], "Numero", fMoov[Número STR],
      "Motorista", fMoov[Motorista Resp], "Vinculo", fMoov[Status Vínculo],
      "Lat", fMoov[Latitude], "Lon", fMoov[Longitude])`);

  const agora = new Date().toISOString();
  const porChave = new Map<string, any>();
  for (const r of rows) {
    const veiculo = texto(r["[Veiculo]"]);
    const data = String(r["[Data]"] ?? "").slice(0, 10);
    const hora = String(r["[Hora]"] ?? "").slice(11, 19);
    if (!veiculo || !data || !hora) continue;
    const regra = texto(r["[Regra]"]) ?? "";
    // Linhas identicas no Power BI contam como alertas separados (o relatorio
    // da CCO soma todas): guarda uma linha so, com a quantidade.
    const chave = `${veiculo}|${data}|${hora}|${regra}`;
    const ja = porChave.get(chave);
    if (ja) { ja.qtd++; continue; }
    porChave.set(chave, {
      veiculo, data, hora, regra, qtd: 1,
      numero_str: texto(r["[Numero]"]),
      motorista: texto(r["[Motorista]"])?.toUpperCase() ?? null,
      status_vinculo: texto(r["[Vinculo]"]),
      latitude: num(r["[Lat]"]),
      longitude: num(r["[Lon]"]),
      atualizado_em: agora,
    });
  }
  const linhas = [...porChave.values()];

  const { error: eDel } = await db.from("cco_motor_ocioso").delete().gte("data", de);
  if (eDel) throw eDel;
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error } = await db.from("cco_motor_ocioso").insert(linhas.slice(i, i + 1000));
    if (error) throw error;
  }
  return { linhas: linhas.length, alertas: linhas.reduce((t, l) => t + l.qtd, 0) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });

  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const body: any = await req.json().catch(() => ({}));
  const de = /^\d{4}-\d{2}-\d{2}$/.test(body?.de ?? "") ? body.de : inicioJanela();
  const ate = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

  const { data: log } = await db.from("cco_sync_log").insert({ de, ate }).select("id").single();
  try {
    const r = await sincronizar(de);
    await db.from("cco_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "ok", linhas: r.alertas,
    }).eq("id", log?.id);
    return json(200, { ok: true, de, ate, ...r });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("sync-cco:", msg);
    await db.from("cco_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "erro", erro: msg,
    }).eq("id", log?.id);
    return json(500, { ok: false, erro: msg });
  }
});
