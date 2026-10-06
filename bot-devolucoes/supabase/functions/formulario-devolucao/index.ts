// deno-lint-ignore-file no-explicit-any
// =============================================================================
// FORMULARIO DE DEVOLUCAO - JR DISTRIBUIDORA
//
// O SAC manda o link do formulario pelo WhatsApp (resposta rapida "/dev").
// O motorista preenche no celular; a solicitacao cai em solicitacoes_devolucao
// (origem = 'formulario'). O SAC acompanha pelo painel e abre a DEV no Jr-Oper
// como ja faz hoje.
//
// Rotas (todas com ?acao=...):
//   GET  dados                 -> motivos visiveis ao motorista
//   GET  motoristas&q=...      -> busca de motorista pelo nome
//   GET  clientes&q=...        -> busca de cliente por nome ou codigo
//   POST enviar  (multipart)   -> grava a solicitacao + fotos
//   --- painel do SAC (cabecalho X-Senha-Sac) ---
//   GET  painel_lista&status=  -> lista resumida
//   GET  painel_detalhe&id=    -> tudo da solicitacao, com links das fotos
//   POST painel_status         -> abrir / reprovar / pedir complemento
//
// Deploy com verify_jwt = false: quem chama e uma pagina publica (motorista)
// sem login. O painel do SAC e protegido pela senha cujo hash fica em
// bot_config ('painel_sac_senha_sha256').
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const BUCKET = "devolucoes-telegram";

const MAX_FOTOS = 10;
const MAX_CANHOTOS = 3;
const MAX_BYTES_ARQUIVO = 8 * 1024 * 1024;
const MAX_ENVIOS_POR_HORA = 6;
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

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
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

async function historico(solicitacaoId: number, anterior: string | null, novo: string,
                         autorTipo: string, autorNome: string, comentario: string | null) {
  await db.from("solicitacao_historico").insert({
    solicitacao_id: solicitacaoId, status_anterior: anterior, status_novo: novo,
    autor_tipo: autorTipo, autor_nome: autorNome, comentario,
  });
}

// ---------------------------------------------------------------------------
// Publico (motorista)
// ---------------------------------------------------------------------------
async function dados() {
  const { data, error } = await db.from("motivos_devolucao")
    .select("codigo, nome, min_fotos, exige_canhoto, exige_localizacao, orientacao_fotos")
    .eq("ativo", true).eq("visivel_motorista", true).order("ordem");
  if (error) return erro("Falha ao carregar os motivos.", 500);
  return json({ ok: true, motivos: data });
}

async function buscar(tipo: "motoristas" | "clientes", termo: string) {
  if (termo.length < 2) return json({ ok: true, itens: [] });
  const fn = tipo === "motoristas" ? "bot_buscar_motoristas" : "bot_buscar_clientes";
  const { data, error } = await db.rpc(fn, { p_termo: termo, p_limite: 8 });
  if (error) return erro("Falha na busca.", 500);
  return json({ ok: true, itens: data });
}

async function enviar(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch (_) { return erro("Envio invalido."); }
  if (texto(form.get("site"))) return json({ ok: true, protocolo: "-" }); // armadilha para robo

  let d: any;
  try { d = JSON.parse(String(form.get("dados") ?? "{}")); } catch (_) { return erro("Dados invalidos."); }

  // --- motorista
  const motoristaId = Number(d.motorista_id);
  if (!Number.isFinite(motoristaId)) return erro("Escolha o seu nome na lista.");
  const { data: mot } = await db.from("motoristas").select("id, nome, ativo, is_deleted")
    .eq("id", motoristaId).maybeSingle();
  if (!mot || mot.is_deleted || mot.ativo === false) return erro("Motorista nao encontrado.");

  const umaHoraAtras = new Date(Date.now() - 3600_000).toISOString();
  const { count: recentes } = await db.from("solicitacoes_devolucao")
    .select("id", { count: "exact", head: true })
    .eq("motorista_id", motoristaId).eq("origem", "formulario").gte("criado_em", umaHoraAtras);
  if ((recentes ?? 0) >= MAX_ENVIOS_POR_HORA) {
    return erro("Muitos envios na ultima hora. Fale com o SAC pelo WhatsApp.", 429);
  }

  // --- nota fiscal
  const nf = texto(d.nota_fiscal, 30).replace(/\D/g, "");
  if (!nf) return erro("Informe o numero da nota fiscal.");

  // --- motivo
  const { data: motivo } = await db.from("motivos_devolucao")
    .select("codigo, nome, min_fotos, exige_canhoto, exige_localizacao")
    .eq("codigo", texto(d.motivo_codigo, 30)).eq("ativo", true).maybeSingle();
  if (!motivo) return erro("Escolha o motivo da devolucao.");

  // --- tipo e itens
  const tipo = d.tipo_devolucao === "parcial" ? "parcial" : d.tipo_devolucao === "total" ? "total" : null;
  if (!tipo) return erro("Informe se a devolucao e total ou parcial.");
  const itens: string[] = (Array.isArray(d.itens) ? d.itens : [])
    .map((i: any) => texto(i, 200).toUpperCase()).filter(Boolean).slice(0, 40);
  if (tipo === "parcial" && itens.length === 0) return erro("Informe os itens devolvidos.");

  // --- cliente: escolhido da lista ou digitado
  let cliente: any = null;
  if (d.cliente_id) {
    const { data } = await db.from("clientes").select("id, codigo_cliente, razao_social, cidade")
      .eq("id", Number(d.cliente_id)).maybeSingle();
    cliente = data;
  }
  const clienteDigitado = texto(d.cliente_texto, 150).toUpperCase();
  if (!cliente && !clienteDigitado) return erro("Informe o cliente.");

  // --- arquivos
  const fotos = form.getAll("foto_produto").filter((f) => f instanceof File) as File[];
  const canhotos = form.getAll("canhoto").filter((f) => f instanceof File) as File[];
  if (fotos.length > MAX_FOTOS || canhotos.length > MAX_CANHOTOS) return erro("Fotos demais.");
  for (const f of [...fotos, ...canhotos]) {
    if (f.size > MAX_BYTES_ARQUIVO) return erro("Uma das fotos e grande demais.");
    if (!/^image\//.test(f.type)) return erro("Envie somente fotos.");
  }
  if (fotos.length < (motivo.min_fotos ?? 0)) {
    return erro(`Esse motivo pede pelo menos ${motivo.min_fotos} foto(s) do produto.`);
  }
  const canhotoJust = texto(d.canhoto_justificativa, 300);
  if (motivo.exige_canhoto && canhotos.length === 0 && !canhotoJust) {
    return erro("Envie a foto do canhoto ou explique por que nao tem.");
  }

  // --- localizacao
  const lat = Number(d.latitude), lon = Number(d.longitude);
  const temLocal = Number.isFinite(lat) && Number.isFinite(lon) && d.latitude !== null && d.longitude !== null
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const localJust = texto(d.localizacao_justificativa, 300);
  if (motivo.exige_localizacao && !temLocal && !localJust) {
    return erro("Envie a localizacao ou explique por que nao foi possivel.");
  }

  // --- NF repetida (so avisa o SAC, nao bloqueia)
  const { data: dup } = await db.from("solicitacoes_devolucao").select("protocolo")
    .eq("nota_fiscal", nf).not("status", "in", "(cancelada,reprovada)")
    .order("criado_em", { ascending: false }).limit(1);

  const agora = new Date().toISOString();
  const { data: sol, error: errIns } = await db.from("solicitacoes_devolucao").insert({
    origem: "formulario",
    status: "aguardando_sac",
    motorista_id: mot.id,
    motorista_nome: mot.nome,
    telefone_motorista: texto(d.telefone, 20).replace(/[^\d+]/g, "") || null,
    nota_fiscal: nf,
    nf_duplicada_de: dup?.[0]?.protocolo ?? null,
    cliente_id: cliente?.id ?? null,
    cliente_codigo: cliente?.codigo_cliente ?? null,
    cliente_nome: cliente?.razao_social ?? clienteDigitado,
    cliente_cidade: cliente?.cidade ?? null,
    motivo_codigo: motivo.codigo,
    tipo_devolucao: tipo,
    observacoes: texto(d.observacoes, 1500) || null,
    canhoto_justificativa: canhotos.length ? null : (canhotoJust || null),
    latitude: temLocal ? lat : null,
    longitude: temLocal ? lon : null,
    localizacao_justificativa: temLocal ? null : (localJust || null),
    usuario_agente: texto(req.headers.get("user-agent"), 300),
    enviado_sac_em: agora,
    ultima_interacao_em: agora,
  }).select("id, protocolo").single();
  if (errIns || !sol) {
    console.error("[insert]", errIns?.message);
    return erro("Nao foi possivel gravar a solicitacao. Tente de novo.", 500);
  }

  // --- grava fotos; se alguma falhar, desfaz tudo
  const enviados: string[] = [];
  const anexos: any[] = [];
  const lotes: [string, File[]][] = [["foto_produto", fotos], ["canhoto", canhotos]];
  try {
    for (const [tipoAnexo, lista] of lotes) {
      for (let i = 0; i < lista.length; i++) {
        const f = lista[i];
        const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const caminho = `formulario/${sol.id}/${tipoAnexo}-${i + 1}.${ext}`;
        const { error } = await db.storage.from(BUCKET)
          .upload(caminho, f, { contentType: f.type, upsert: false });
        if (error) throw new Error(error.message);
        enviados.push(caminho);
        anexos.push({
          solicitacao_id: sol.id, tipo: tipoAnexo, midia: "photo", storage_path: caminho,
          mime_type: f.type, tamanho_bytes: f.size, nome_original: texto(f.name, 120),
        });
      }
    }
    if (anexos.length) {
      const { error } = await db.from("solicitacao_anexos").insert(anexos);
      if (error) throw new Error(error.message);
    }
    if (itens.length) {
      const { error } = await db.from("solicitacao_itens")
        .insert(itens.map((t) => ({ solicitacao_id: sol.id, texto: t })));
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.error("[anexos]", (e as Error).message);
    if (enviados.length) await db.storage.from(BUCKET).remove(enviados);
    await db.from("solicitacoes_devolucao").delete().eq("id", sol.id);
    return erro("Falha ao enviar as fotos. Verifique a internet e tente de novo.", 500);
  }

  await historico(sol.id, null, "aguardando_sac", "motorista", mot.nome, "Enviada pelo formulário");
  return json({ ok: true, protocolo: sol.protocolo });
}

// ---------------------------------------------------------------------------
// Painel do SAC
// ---------------------------------------------------------------------------
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

async function painelStatus(req: Request) {
  let b: any;
  try { b = await req.json(); } catch (_) { return erro("Dados invalidos."); }
  const id = Number(b.id);
  const acao = String(b.acao ?? "");
  const atendente = texto(b.atendente, 80);
  const comentario = texto(b.comentario, 1000);
  if (!atendente) return erro("Informe o seu nome.");

  const { data: sol } = await db.from("solicitacoes_devolucao").select("id, status").eq("id", id).maybeSingle();
  if (!sol) return erro("Solicitacao nao encontrada.", 404);

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

// ---------------------------------------------------------------------------
// Roteador
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const acao = url.searchParams.get("acao") ?? "";
  try {
    if (req.method === "GET" && acao === "dados") return await dados();
    if (req.method === "GET" && (acao === "motoristas" || acao === "clientes")) {
      return await buscar(acao, texto(url.searchParams.get("q"), 60));
    }
    if (req.method === "POST" && acao === "enviar") return await enviar(req);

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
