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
// - O motorista do alerta e refeito pelas viagens do JR-Oper (sem as apagadas);
//   o do Power BI fica em motorista_pbi. Ver vincularPelasViagens.
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
// Motorista do alerta pelas viagens do JR-Oper (27/11/2026)
//
// O Power BI liga o alerta ao motorista lendo a tabela controle_viagens sem
// tirar as viagens APAGADAS. Uma viagem apagada fica sem retorno, e o Power BI
// a trata como aberta para sempre: caso real, carga 45132 (RICARDO, TVA8I21,
// apagada na correcao da escala de 04/11) fez todos os alertas da TVA8I21 irem
// para ele ate o fim de novembro, inclusive nas viagens do NANDERSON.
// Aqui o vinculo e refeito pela view vw_bi_controle_viagens (sem apagadas):
// mesma placa, entre a saida e o retorno = "Em Viagem"; ate MARGEM_MINUTOS antes
// da saida ou depois do retorno = "Pre/Pos Viagem"; fora disso, sem motorista.
// Viagem sem retorno vale ate a proxima saida da mesma placa (no maximo
// ABERTA_MAX_DIAS). O motorista do Power BI fica em motorista_pbi para conferir.
// Antes da 1a viagem lancada no JR-Oper (ago/26) vale o do Power BI.
// ---------------------------------------------------------------------------
// 15 min cobre a diferenca entre a hora digitada no Controle de Viagens e a
// real, sem pegar o caminhao parado no patio horas antes (medido em nov/26: o
// Power BI nao usa margem fixa; com 2 h entravam 83 alertas de patio a mais).
const MARGEM_MINUTOS = 15;
const ABERTA_MAX_DIAS = 7;

const placaChave = (p: any) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ms = (iso: string) => Date.parse(iso + "Z");

async function vincularPelasViagens(linhas: any[], de: string) {
  const desde = new Date(ms(`${de}T00:00:00`) - 10 * 86400000).toISOString().slice(0, 10);
  const viagens: any[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from("vw_bi_controle_viagens")
      .select("placa,motorista,saida_em,retorno_em,data_saida")
      .gte("data_saida", desde).order("saida_em", { ascending: true }).range(i, i + 999);
    if (error) throw error;
    viagens.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: primeira } = await db.from("vw_bi_controle_viagens")
    .select("data_saida").not("data_saida", "is", null).order("data_saida", { ascending: true }).limit(1);
  const inicioOper = primeira?.[0]?.data_saida ?? "9999-12-31";

  // Janelas por placa, em ordem de saida.
  const porPlaca = new Map<string, { ini: number; fim: number; motorista: string }[]>();
  for (const v of viagens) {
    if (!v.saida_em || !v.motorista) continue;
    const p = placaChave(v.placa);
    if (!p) continue;
    const lista = porPlaca.get(p) ?? [];
    lista.push({ ini: ms(String(v.saida_em).slice(0, 19)), fim: v.retorno_em ? ms(String(v.retorno_em).slice(0, 19)) : NaN,
      motorista: String(v.motorista).replace(/\s+/g, " ").trim().toUpperCase() });
    porPlaca.set(p, lista);
  }
  for (const lista of porPlaca.values()) {
    lista.sort((x, y) => x.ini - y.ini);
    lista.forEach((j, k) => {
      if (!isNaN(j.fim)) return;
      const prox = lista[k + 1];
      // Horas das viagens e dos alertas sao de Brasilia: o "agora" tambem.
      j.fim = Math.min(prox ? prox.ini - 1000 : Date.now() - 3 * 3600000, j.ini + ABERTA_MAX_DIAS * 86400000);
    });
  }

  const margem = MARGEM_MINUTOS * 60000;
  for (const l of linhas) {
    l.motorista_pbi = l.motorista;
    if (l.data < inicioOper) continue; // sem viagens no JR-Oper ainda: fica o do Power BI
    const t = ms(`${l.data}T${l.hora}`);
    const lista = porPlaca.get(placaChave(l.veiculo)) ?? [];
    let dentro: any = null, perto: any = null, dist = Infinity;
    for (const j of lista) {
      if (t >= j.ini && t <= j.fim) { if (!dentro || j.ini > dentro.ini) dentro = j; continue; }
      const d = t < j.ini ? j.ini - t : t - j.fim;
      if (d <= margem && d < dist) { perto = j; dist = d; }
    }
    if (dentro) { l.motorista = dentro.motorista; l.status_vinculo = "Em Viagem"; }
    else if (perto) { l.motorista = perto.motorista; l.status_vinculo = "Pré/Pós Viagem"; }
    else { l.motorista = null; l.status_vinculo = "Sem Vínculo"; }
  }
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
  await vincularPelasViagens(linhas, de);

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
