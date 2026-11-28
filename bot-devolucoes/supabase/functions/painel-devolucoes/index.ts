// deno-lint-ignore-file no-explicit-any
// =============================================================================
// PAINEL DO SAC - DEVOLUCOES PELO WHATSAPP (JR-OPER, producao)
//
// So o painel: lista, detalhe com links temporarios das fotos e decisao.
// Sem rota publica (o formulario do motorista foi reprovado em 01/10/2026).
//
// Rotas (todas com ?acao=... e cabecalho X-Senha-Sac):
//   GET  painel_lista&status=  -> lista resumida
//   GET  painel_detalhe&id=    -> tudo da solicitacao, com links das fotos
//   POST painel_status         -> abrir / reprovar / complemento (origem != whatsapp)
//
// A senha do painel fica em bot_config ('painel_sac_senha_sha256'), em SHA-256.
// Deploy com verify_jwt = false (pagina estatica sem login do Supabase).
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUCKET = "devolucoes-telegram";
const MINUTOS_LINK_FOTO = 60;

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

const db = createClient(SUPABASE_URL, chaveServico(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-senha-sac",
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });

const erro = (mensagem: string, status = 400) => json({ ok: false, erro: mensagem }, status);

const texto = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function senhaOk(req: Request): Promise<boolean> {
  const senha = req.headers.get("x-senha-sac") ?? "";
  if (!senha) return false;
  const { data } = await db.from("bot_config").select("valor")
    .eq("chave", "painel_sac_senha_sha256").maybeSingle();
  if (!data?.valor) return false;
  const ok = (await sha256(senha)) === data.valor;
  if (!ok) await new Promise((r) => setTimeout(r, 1200)); // freia tentativa e erro
  return ok;
}

async function painelLista(status: string) {
  let q = db.from("solicitacoes_devolucao")
    .select("id, protocolo, status, origem, motorista_nome, nota_fiscal, cliente_nome, motivo_codigo, tipo_devolucao, numero_devolucao, nf_duplicada_de, criado_em, motivos_devolucao(nome)")
    .neq("status", "em_coleta")
    .order("criado_em", { ascending: false }).limit(100);
  if (status === "abertas") q = q.in("status", ["aguardando_sac", "pendente_complemento"]);
  else if (status && status !== "todas") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return erro("Falha ao listar.", 500);
  return json({ ok: true, itens: data });
}

async function painelDetalhe(id: number) {
  const { data: sol } = await db.from("solicitacoes_devolucao")
    .select("*, motivos_devolucao(nome)").eq("id", id).maybeSingle();
  if (!sol) return erro("Solicitacao nao encontrada.", 404);
  const [{ data: itens }, { data: anexos }, { data: hist }] = await Promise.all([
    db.from("solicitacao_itens").select("texto").eq("solicitacao_id", id).order("id"),
    db.from("solicitacao_anexos").select("id, tipo, storage_path").eq("solicitacao_id", id).order("id"),
    db.from("solicitacao_historico").select("*").eq("solicitacao_id", id).order("id"),
  ]);
  const caminhos = (anexos ?? []).map((a: any) => a.storage_path).filter(Boolean);
  let links: Record<string, string> = {};
  if (caminhos.length) {
    const { data } = await db.storage.from(BUCKET).createSignedUrls(caminhos, MINUTOS_LINK_FOTO * 60);
    links = Object.fromEntries((data ?? []).map((s: any) => [s.path, s.signedUrl]));
  }
  return json({
    ok: true, solicitacao: sol, itens: (itens ?? []).map((i: any) => i.texto),
    anexos: (anexos ?? []).map((a: any) => ({ tipo: a.tipo, url: links[a.storage_path] ?? null })),
    historico: hist ?? [],
  });
}

async function historico(solicitacaoId: number, anterior: string | null, novo: string,
                         autorTipo: string, autorNome: string, comentario: string | null) {
  await db.from("solicitacao_historico").insert({
    solicitacao_id: solicitacaoId, status_anterior: anterior, status_novo: novo,
    autor_tipo: autorTipo, autor_nome: autorNome, comentario,
  });
}

async function painelStatus(req: Request) {
  let b: any;
  try { b = await req.json(); } catch (_) { return erro("Dados invalidos."); }
  const id = Number(b.id);
  const acao = String(b.acao ?? "");
  const atendente = texto(b.atendente, 80);
  const comentario = texto(b.comentario, 1000);
  if (!atendente) return erro("Informe o seu nome.");

  const { data: sol } = await db.from("solicitacoes_devolucao").select("id, status, origem").eq("id", id).maybeSingle();
  if (!sol) return erro("Solicitacao nao encontrada.", 404);
  // Pelo WhatsApp a decisao e na conversa (o bot registra e avisa o motorista)
  if (sol.origem === "whatsapp") return erro("Responda na conversa do WhatsApp: DEV 149, #complemento ou #reprovar.", 409);

  const agora = new Date().toISOString();
  let mudanca: any;
  if (acao === "abrir") {
    const dev = texto(b.numero_devolucao, 30).toUpperCase();
    if (!dev) return erro("Informe o numero da DEV aberta no Jr-Oper.");
    mudanca = { status: "ocorrencia_aberta", numero_devolucao: dev, decidido_por: atendente, decidido_em: agora };
  } else if (acao === "reprovar") {
    if (!comentario) return erro("Informe o motivo da reprovacao.");
    mudanca = { status: "reprovada", decisao_motivo: comentario, decidido_por: atendente, decidido_em: agora };
  } else if (acao === "complemento") {
    if (!comentario) return erro("Informe o que falta.");
    mudanca = { status: "pendente_complemento", complemento_pedido: comentario };
  } else if (acao === "complemento_recebido") {
    mudanca = { status: "aguardando_sac", complemento_resposta: comentario || null };
  } else {
    return erro("Acao desconhecida.");
  }

  const { error } = await db.from("solicitacoes_devolucao").update(mudanca).eq("id", id);
  if (error) {
    const msg = /Transicao de status invalida/.test(error.message)
      ? "Essa mudanca nao e permitida para o status atual." : "Falha ao salvar.";
    return erro(msg, 409);
  }
  const coment = acao === "abrir" ? `Ocorrencia ${mudanca.numero_devolucao}` : (comentario || null);
  await historico(id, sol.status, mudanca.status, "sac", atendente, coment);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const acao = url.searchParams.get("acao") ?? "";
  try {
    if (acao.startsWith("painel_")) {
      if (!(await senhaOk(req))) return erro("Senha incorreta.", 401);
      if (req.method === "GET" && acao === "painel_lista") {
        return await painelLista(url.searchParams.get("status") ?? "abertas");
      }
      if (req.method === "GET" && acao === "painel_detalhe") {
        return await painelDetalhe(Number(url.searchParams.get("id")));
      }
      if (req.method === "POST" && acao === "painel_status") return await painelStatus(req);
    }
    return erro("Rota nao encontrada.", 404);
  } catch (e) {
    console.error("[erro]", (e as Error).message);
    return erro("Erro interno.", 500);
  }
});
