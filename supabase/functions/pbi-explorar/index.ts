// deno-lint-ignore-file no-explicit-any
// =============================================================================
// PBI EXPLORAR - JR DISTRIBUIDORA
//
// Ferramenta SO DE LEITURA para levantar o que existe no workspace LOGISTICA do
// Power BI (modelos, relatorios, tabelas, medidas) e testar consultas DAX antes
// de escrever uma sincronizacao. Nao grava nada no banco e nao altera o Power BI.
// Usa o mesmo app "JR-Oper Sync" (service principal) da sync-produtividade.
//
// Chamada: POST com cabecalho x-sync-token (mesmo 'prod_sync_token' do Vault).
// Corpo:
//   { "acao": "workspaces" }                      lista os workspaces que o app enxerga
//   { "acao": "modelos" }                         lista os modelos (datasets)
//   { "acao": "relatorios" }                      lista os relatorios e o modelo de cada um
//   { "acao": "dax", "modelo": "Corte", "query": "EVALUATE ..." }
//       modelo = nome ou id; devolve no maximo "limite" linhas (padrao 500)
//   Em todas: "workspace" (nome ou id) opcional; sem ele, LOGISTICA.
// Deploy com verify_jwt = false. Segredos: PBI_CLIENT_ID e PBI_CLIENT_SECRET.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TENANT = "jrdistribuidora.net.br";
const WORKSPACE_ID = "d445377b-c93f-4454-aec1-24cda9003962"; // LOGISTICA (padrao)
const PBI = "https://api.powerbi.com/v1.0/myorg";
let API = `${PBI}/groups/${WORKSPACE_ID}`;

// Aceita nome ou id do workspace; so enxerga os que o app tem acesso.
async function usarWorkspace(token: string, ws: string) {
  if (!ws) { API = `${PBI}/groups/${WORKSPACE_ID}`; return; }
  if (/^[0-9a-f-]{36}$/i.test(ws)) { API = `${PBI}/groups/${ws}`; return; }
  const r = await fetch(`${PBI}/groups`, { headers: { Authorization: `Bearer ${token}` } });
  const lista: any[] = (await r.json()).value ?? [];
  const achado = lista.find((g) => String(g.name).toLowerCase() === ws.toLowerCase());
  if (!achado) throw new Error(`Workspace "${ws}" nao encontrado (o app enxerga: ${lista.map((g) => g.name).join(", ")})`);
  API = `${PBI}/groups/${achado.id}`;
}

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

async function getPbi(token: string, caminho: string): Promise<any[]> {
  const r = await fetch(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}` } });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Power BI ${caminho} ${r.status}: ${txt.slice(0, 500)}`);
  return JSON.parse(txt).value ?? [];
}

async function idDoModelo(token: string, modelo: string): Promise<string> {
  if (/^[0-9a-f-]{36}$/i.test(modelo)) return modelo;
  const lista = await getPbi(token, "/datasets");
  const achado = lista.find((d: any) => String(d.name).toLowerCase() === modelo.toLowerCase());
  if (!achado) throw new Error(`Modelo "${modelo}" nao encontrado no LOGISTICA`);
  return achado.id;
}

async function dax(token: string, datasetId: string, query: string): Promise<any[]> {
  const r = await fetch(`${API}/datasets/${datasetId}/executeQueries`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ queries: [{ query }], serializerSettings: { includeNulls: true } }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Power BI executeQueries ${r.status}: ${txt.slice(0, 800)}`);
  return JSON.parse(txt).results?.[0]?.tables?.[0]?.rows ?? [];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { erro: "use POST" });

  const tok = req.headers.get("x-sync-token") ?? "";
  if (!tok) return json(401, { erro: "nao autorizado" });
  const { data: ok, error: eTok } = await db.rpc("prod_sync_token_ok", { p_token: tok });
  if (eTok || !ok) return json(401, { erro: "nao autorizado" });

  const body: any = await req.json().catch(() => ({}));
  try {
    const token = await tokenPowerBi();
    if (body.acao === "workspaces") {
      const r = await fetch(`${PBI}/groups`, { headers: { Authorization: `Bearer ${token}` } });
      const lista: any[] = (await r.json()).value ?? [];
      return json(200, lista.map((g) => ({ id: g.id, nome: g.name })));
    }
    await usarWorkspace(token, String(body.workspace ?? ""));
    if (body.acao === "modelos") {
      const lista = await getPbi(token, "/datasets");
      return json(200, lista.map((d: any) => ({ id: d.id, nome: d.name, atualizavel: d.isRefreshable })));
    }
    if (body.acao === "relatorios") {
      const lista = await getPbi(token, "/reports");
      return json(200, lista.map((r: any) => ({ id: r.id, nome: r.name, modelo: r.datasetId, workspace_modelo: r.datasetWorkspaceId })));
    }
    if (body.acao === "dax") {
      const query = String(body.query ?? "");
      if (!/^\s*(DEFINE|EVALUATE)\b/i.test(query)) return json(400, { erro: "query precisa comecar com EVALUATE ou DEFINE" });
      const limite = Math.min(Number(body.limite) || 500, 5000);
      const id = await idDoModelo(token, String(body.modelo ?? ""));
      const linhas = await dax(token, id, query);
      return json(200, { total: linhas.length, linhas: linhas.slice(0, limite) });
    }
    return json(400, { erro: "acao invalida (modelos | relatorios | dax)" });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error("pbi-explorar:", msg);
    return json(500, { ok: false, erro: msg });
  }
});
