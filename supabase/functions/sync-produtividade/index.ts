// deno-lint-ignore-file no-explicit-any
// =============================================================================
// SYNC PRODUTIVIDADE - JR DISTRIBUIDORA
//
// Le a pontuacao do modelo "Produtividade" (workspace LOGISTICA) no Power BI,
// via app "JR-Oper Sync" (service principal), e grava em prod_pontuacao.
//
// - So atualiza meses com status 'aberto' em prod_periodos. Mes 'fechado' ou
//   'publicado' fica CONGELADO: o Power BI recalcula o passado com o cadastro
//   de hoje e os valores mudariam depois de pagos.
// - Periodo novo que aparece no Power BI entra como 'aberto' se terminou ha
//   menos de 35 dias; os antigos entram como 'fechado' (sem pontuacao).
//
// Chamada: POST com cabecalho x-sync-token (token guardado no Vault como
// 'prod_sync_token'; o pg_cron envia). Deploy com verify_jwt = false.
// Segredos: PBI_CLIENT_ID e PBI_CLIENT_SECRET (Edge Functions -> Secrets).
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA
const DATASET_ID = "ccec4f0c-7d46-4207-8fa5-eee9ff880191";   // Produtividade
const DIAS_PARA_ABRIR = 35;

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
  if (!r.ok) {
    // AADSTS7000222 = segredo expirado; AADSTS7000215 = segredo invalido
    throw new Error(`Falha no login do Entra (${r.status}): ${j.error_description ?? j.error ?? "?"}`);
  }
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

const num = (v: any) => (v === null || v === undefined || v === "" ? null : Number(v));
const dia = (v: string) => v.slice(0, 10);

// ---------------------------------------------------------------------------
// Sincronizacao
// ---------------------------------------------------------------------------
async function sincronizar() {
  const token = await tokenPowerBi();

  // 1) Periodos de fechamento (26 -> 25)
  const periodos = await dax(token, `
    EVALUATE
    SUMMARIZECOLUMNS(
      dCalendario[AnoMes Fechamento], dCalendario[Mes Ano Fechamento],
      "Inicio", MIN(dCalendario[Data]))`);

  const { data: existentes, error: e1 } = await db.from("prod_periodos").select("ano_mes");
  if (e1) throw e1;
  const jaTem = new Set((existentes ?? []).map((p: any) => p.ano_mes));
  const limite = new Date(Date.now() - DIAS_PARA_ABRIR * 86400000).toISOString().slice(0, 10);

  const novos = periodos
    .map((p: any) => {
      const am = Number(p["dCalendario[AnoMes Fechamento]"]);
      const fim = `${String(am).slice(0, 4)}-${String(am).slice(4, 6)}-25`;
      return {
        ano_mes: am,
        rotulo: p["dCalendario[Mes Ano Fechamento]"],
        inicio: dia(p["[Inicio]"]),
        fim,
        status: fim >= limite ? "aberto" : "fechado",
      };
    })
    .filter((p) => p.ano_mes && !jaTem.has(p.ano_mes));
  if (novos.length) {
    const { error } = await db.from("prod_periodos").insert(novos);
    if (error) throw error;
  }

  // 2) Meses abertos
  const { data: abertos, error: e2 } = await db.from("prod_periodos")
    .select("ano_mes").eq("status", "aberto").order("ano_mes");
  if (e2) throw e2;
  const meses: number[] = (abertos ?? []).map((p: any) => p.ano_mes);
  if (!meses.length) return { meses, linhas: 0, semMatricula: 0 };

  // 3) Pontuacao por matricula nos meses abertos
  const rows = await dax(token, `
    EVALUATE
    SUMMARIZECOLUMNS(
      dCalendario[AnoMes Fechamento],
      dFuncionario[MAT], dFuncionario[NOME], dFuncionario[CARGO], dFuncionario[SETOR],
      TREATAS({${meses.join(",")}}, dCalendario[AnoMes Fechamento]),
      "Pontuacao",  [PONTUAÇÃO GERAL],
      "QtdOS",      [Qtd OS],
      "QtdApanhos", [Qtd Apanhos],
      "TotalKg",    [Total Kg],
      "KgEntrada",  [Total Kg Entrada],
      "KgCarne",    [Total Kg Carne])`);

  const agora = new Date().toISOString();
  let semMatricula = 0;
  const porChave = new Map<string, any>();
  for (const r of rows) {
    const mat = String(r["dFuncionario[MAT]"] ?? "").trim();
    if (!mat) { semMatricula++; continue; } // producao de matricula fora do cadastro
    const am = Number(r["dCalendario[AnoMes Fechamento]"]);
    porChave.set(`${am}|${mat}`, {
      ano_mes: am,
      matricula: mat,
      nome: r["dFuncionario[NOME]"]?.trim() ?? null,
      cargo: r["dFuncionario[CARGO]"]?.trim() ?? null,
      setor: r["dFuncionario[SETOR]"]?.trim() ?? null,
      pontuacao: num(r["[Pontuacao]"]),
      qtd_os: num(r["[QtdOS]"]),
      qtd_apanhos: num(r["[QtdApanhos]"]),
      kg_total: num(r["[TotalKg]"]),
      kg_entrada: num(r["[KgEntrada]"]),
      kg_carne: num(r["[KgCarne]"]),
      atualizado_em: agora,
    });
  }
  const linhas = [...porChave.values()];

  if (linhas.length) {
    const { error } = await db.from("prod_pontuacao").upsert(linhas, { onConflict: "ano_mes,matricula" });
    if (error) throw error;
  }
  // Quem saiu do resultado num mes aberto (ex.: mudou de matricula) e removido
  const { error: e3 } = await db.from("prod_pontuacao").delete()
    .in("ano_mes", meses).lt("atualizado_em", agora);
  if (e3) throw e3;

  return { meses, linhas: linhas.length, semMatricula };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });

  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const { data: log } = await db.from("prod_sync_log").insert({}).select("id").single();
  try {
    const r = await sincronizar();
    await db.from("prod_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "ok",
      meses: r.meses, linhas: r.linhas, linhas_sem_matricula: r.semMatricula,
    }).eq("id", log?.id);
    return json(200, { ok: true, ...r });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("sync-produtividade:", msg);
    await db.from("prod_sync_log").update({
      finalizado_em: new Date().toISOString(), status: "erro", erro: msg,
    }).eq("id", log?.id);
    return json(500, { ok: false, erro: msg });
  }
});
