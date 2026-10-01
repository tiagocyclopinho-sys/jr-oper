// deno-lint-ignore-file no-explicit-any
// =============================================================================
// BOT DE DEVOLUCOES - JR DISTRIBUIDORA (versao simples, sem IA)
//
// O motorista responde perguntas fixas com botoes; o bot junta tudo num resumo
// e publica no grupo do SAC no Telegram. O SAC abre a ocorrencia no Jr-Oper
// como ja faz hoje e responde pelos botoes do grupo; o motorista e avisado.
//
// Rotas:
//   POST /telegram-bot              -> webhook do Telegram (exige o cabecalho
//                                      X-Telegram-Bot-Api-Secret-Token)
//   GET  /telegram-bot?acao=setup   -> registra o webhook no Telegram
//   GET  /telegram-bot?acao=status  -> situacao do webhook
//
// Unico segredo a cadastrar: TELEGRAM_BOT_TOKEN. O segredo do webhook e
// derivado do token (ver segredoWebhook), assim ninguem precisa gerar nem
// copiar um segundo valor.
//
// Deploy com verify_jwt = false: quem chama e o Telegram (sem JWT). A
// autenticacao do POST e o cabecalho secreto; o GET ?acao=setup apenas aponta
// o webhook para esta mesma funcao, entao chama-lo de novo nao causa dano.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const TG = `https://api.telegram.org/bot${TOKEN}`;
const BUCKET = "devolucoes-telegram";
const HORAS_VALIDADE_LINK = 48;
const HORAS_ABANDONO = 24;

function chaveServico(): string {
  // Projetos novos: SUPABASE_SECRET_KEYS = {"default":"sb_secret_..."}.
  // Projetos antigos (como o JR-OPER): SUPABASE_SERVICE_ROLE_KEY.
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
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtData = (iso: string | Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });

async function segredoWebhook(): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jr-webhook:" + TOKEN));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

function codigoAleatorio(tamanho = 16): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(tamanho));
  return [...bytes].map((b) => alfabeto[b % alfabeto.length]).join("");
}

function nomeTelegram(u: any): string {
  if (!u) return "?";
  const nome = [u.first_name, u.last_name].filter(Boolean).join(" ");
  return u.username ? `${nome} (@${u.username})` : nome;
}

// ---------------------------------------------------------------------------
// API do Telegram
// ---------------------------------------------------------------------------
async function tg(metodo: string, corpo: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${TG}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) console.error(`[telegram] ${metodo} falhou: ${j.description}`);
  return j;
}

type Botao = [string, string];
const teclado = (linhas: Botao[][]) => ({
  inline_keyboard: linhas.map((l) => l.map(([text, callback_data]) => ({ text, callback_data }))),
});

function enviar(chatId: number | string, texto: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", {
    chat_id: chatId, text: texto, parse_mode: "HTML",
    link_preview_options: { is_disabled: true }, ...extra,
  });
}

const tirarBotoes = (chatId: number | string, messageId: number) =>
  tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });

let usernameBot = "";
async function botUsername(): Promise<string> {
  if (!usernameBot) {
    const me = await tg("getMe", {});
    usernameBot = me?.result?.username ?? "";
  }
  return usernameBot;
}

// ---------------------------------------------------------------------------
// Configuracao (id do grupo do SAC)
// ---------------------------------------------------------------------------
async function cfg(chave: string): Promise<string | null> {
  const { data } = await db.from("bot_config").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}
async function setCfg(chave: string, valor: string) {
  await db.from("bot_config").upsert({ chave, valor, atualizado_em: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
async function motoristaDoChat(chatId: number) {
  const { data } = await db.from("motoristas_telegram")
    .select("*, motoristas(nome)")
    .eq("chat_id", chatId).eq("ativo", true).maybeSingle();
  return data;
}

async function carregarSol(id: number | string) {
  const { data } = await db.from("solicitacoes_devolucao").select("*").eq("id", id).maybeSingle();
  return data;
}

async function solEmColeta(motoristaId: number) {
  const { data } = await db.from("solicitacoes_devolucao").select("*")
    .eq("motorista_id", motoristaId).eq("status", "em_coleta").maybeSingle();
  return data;
}

async function atualizarSol(id: number, campos: Record<string, unknown>) {
  const { data, error } = await db.from("solicitacoes_devolucao")
    .update({ ...campos, ultima_interacao_em: new Date().toISOString() })
    .eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(`atualizarSol: ${error.message}`);
  return data;
}

async function motivo(codigo: string | null) {
  if (!codigo) return null;
  const { data } = await db.from("motivos_devolucao").select("*").eq("codigo", codigo).maybeSingle();
  return data;
}

async function contarAnexos(solId: number, tipos: string[]) {
  const { count } = await db.from("solicitacao_anexos").select("id", { count: "exact", head: true })
    .eq("solicitacao_id", solId).in("tipo", tipos);
  return count ?? 0;
}

async function itensDa(solId: number) {
  const { data } = await db.from("solicitacao_itens").select("id, texto")
    .eq("solicitacao_id", solId).order("id");
  return data ?? [];
}

async function registrarHistorico(solId: number, de: string | null, para: string | null,
  autorTipo: "motorista" | "sac" | "sistema", autorNome: string, comentario?: string) {
  await db.from("solicitacao_historico").insert({
    solicitacao_id: solId, status_anterior: de, status_novo: para,
    autor_tipo: autorTipo, autor_nome: autorNome, comentario: comentario ?? null,
  });
}

// Muda o status so se ele ainda for o esperado; o trigger do banco recusa
// transicoes invalidas. Devolve a linha nova ou null.
async function mudarStatus(sol: any, novo: string, campos: Record<string, unknown>,
  autorTipo: "motorista" | "sac" | "sistema", autorNome: string, comentario?: string) {
  const { data, error } = await db.from("solicitacoes_devolucao")
    .update({ ...campos, status: novo })
    .eq("id", sol.id).eq("status", sol.status).select("*").maybeSingle();
  if (error || !data) {
    if (error) console.error(`[mudarStatus] ${sol.protocolo} ${sol.status}->${novo}: ${error.message}`);
    return null;
  }
  await registrarHistorico(sol.id, sol.status, novo, autorTipo, autorNome, comentario);
  return data;
}

const ROTULO_STATUS: Record<string, string> = {
  em_coleta: "✏️ Em preenchimento",
  aguardando_sac: "⏳ Aguardando o SAC",
  pendente_complemento: "📝 SAC pediu complemento",
  ocorrencia_aberta: "✅ Registrada no SAC",
  reprovada: "❌ Não aprovada",
  cancelada: "🚫 Cancelada",
  recebida_deposito: "📦 Recebida no depósito",
};

// ---------------------------------------------------------------------------
// Anexos: guarda o id do arquivo no Telegram e uma copia no Storage privado
// ---------------------------------------------------------------------------
function arquivoDaMensagem(msg: any): { fileId: string; uniqueId: string; midia: string; mime: string; tamanho?: number } | null {
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { fileId: p.file_id, uniqueId: p.file_unique_id, midia: "photo", mime: "image/jpeg", tamanho: p.file_size };
  }
  if (msg.document) {
    const d = msg.document;
    const mime = d.mime_type ?? "application/octet-stream";
    if (mime.startsWith("image/") || mime === "application/pdf") {
      return { fileId: d.file_id, uniqueId: d.file_unique_id, midia: "document", mime, tamanho: d.file_size };
    }
    return null;
  }
  if (msg.voice) return { fileId: msg.voice.file_id, uniqueId: msg.voice.file_unique_id, midia: "voice", mime: msg.voice.mime_type ?? "audio/ogg", tamanho: msg.voice.file_size };
  if (msg.audio) return { fileId: msg.audio.file_id, uniqueId: msg.audio.file_unique_id, midia: "audio", mime: msg.audio.mime_type ?? "audio/mpeg", tamanho: msg.audio.file_size };
  return null;
}

const ehImagem = (msg: any) => !!msg.photo?.length ||
  (!!msg.document && ((msg.document.mime_type ?? "").startsWith("image/") || msg.document.mime_type === "application/pdf"));
const ehAudio = (msg: any) => !!msg.voice || !!msg.audio;

async function salvarAnexo(sol: any, msg: any, tipo: string) {
  const arq = arquivoDaMensagem(msg);
  if (!arq) return null;

  let storagePath: string | null = null;
  try {
    const info = await tg("getFile", { file_id: arq.fileId });
    const caminho = info?.result?.file_path as string | undefined;
    if (caminho) {
      const r = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${caminho}`);
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        const ext = caminho.includes(".") ? caminho.split(".").pop() : "bin";
        const destino = `${sol.protocolo}/${tipo}-${Date.now()}-${arq.uniqueId}.${ext}`;
        const { error } = await db.storage.from(BUCKET).upload(destino, bytes, { contentType: arq.mime, upsert: false });
        if (error) console.error(`[storage] ${error.message}`);
        else storagePath = destino;
      }
    }
  } catch (e) {
    // Sem copia no Storage o anexo continua valendo pelo id do Telegram.
    console.error(`[salvarAnexo] download falhou: ${e}`);
  }

  const { data } = await db.from("solicitacao_anexos").insert({
    solicitacao_id: sol.id, tipo, midia: arq.midia,
    telegram_file_id: arq.fileId, telegram_file_unique_id: arq.uniqueId,
    media_group_id: msg.media_group_id ?? null, storage_path: storagePath,
    mime_type: arq.mime, tamanho_bytes: arq.tamanho ?? null,
  }).select("*").single();
  return data;
}

// Album: o Telegram manda cada foto como uma mensagem separada. So a
// primeira do album recebe resposta, para o bot nao responder 5 vezes.
async function jaTemDoAlbum(solId: number, mediaGroupId?: string) {
  if (!mediaGroupId) return null;
  const { data } = await db.from("solicitacao_anexos").select("tipo")
    .eq("solicitacao_id", solId).eq("media_group_id", mediaGroupId).limit(1);
  return data?.[0]?.tipo ?? null;
}

// ---------------------------------------------------------------------------
// Fluxo de perguntas do motorista
// ---------------------------------------------------------------------------
const ORDEM = ["nf", "cliente", "motivo", "tipo", "itens", "fotos", "canhoto", "localizacao", "observacoes", "resumo"];

async function pendencias(sol: any): Promise<{ campo: string; etapa: string; texto: string }[]> {
  const m = await motivo(sol.motivo_codigo);
  const faltas: { campo: string; etapa: string; texto: string }[] = [];
  if (!sol.nota_fiscal) faltas.push({ campo: "nf", etapa: "nf", texto: "número da nota fiscal" });
  if (!sol.cliente_id && !sol.cliente_nome) faltas.push({ campo: "cliente", etapa: "cliente", texto: "cliente" });
  if (!sol.motivo_codigo) faltas.push({ campo: "motivo", etapa: "motivo", texto: "motivo" });
  if (!sol.tipo_devolucao) faltas.push({ campo: "tipo", etapa: "tipo", texto: "se é total ou parcial" });
  if (sol.tipo_devolucao === "parcial" && (await itensDa(sol.id)).length === 0) {
    faltas.push({ campo: "itens", etapa: "itens", texto: "itens devolvidos" });
  }
  const minFotos = m?.min_fotos ?? 0;
  if (minFotos > 0 && (await contarAnexos(sol.id, ["foto_produto"])) < minFotos) {
    faltas.push({ campo: "fotos", etapa: "fotos", texto: `pelo menos ${minFotos} foto(s)` });
  }
  if ((m?.exige_canhoto ?? true) && !sol.canhoto_justificativa && (await contarAnexos(sol.id, ["canhoto"])) === 0) {
    faltas.push({ campo: "canhoto", etapa: "canhoto", texto: "foto do canhoto" });
  }
  if ((m?.exige_localizacao ?? true) && sol.latitude == null && !sol.localizacao_justificativa) {
    faltas.push({ campo: "localizacao", etapa: "localizacao", texto: "localização" });
  }
  return faltas;
}

function proximaEtapa(atual: string, sol: any): string {
  if (sol.corrigindo) return "resumo";
  const atalhos: Record<string, string> = {
    cliente_manual: "motivo",
    canhoto_justificativa: "localizacao",
    localizacao_justificativa: "observacoes",
  };
  if (atalhos[atual]) return atalhos[atual];
  let i = ORDEM.indexOf(atual) + 1;
  if (ORDEM[i] === "itens" && sol.tipo_devolucao !== "parcial") i++;
  return ORDEM[i] ?? "resumo";
}

async function avancar(sol: any, atual: string) {
  const etapa = proximaEtapa(atual, sol);
  const nova = await atualizarSol(sol.id, { etapa });
  await perguntar(nova);
}

async function perguntar(sol: any) {
  const chat = sol.chat_id;
  const id = sol.id;
  switch (sol.etapa) {
    case "nf":
      return enviar(chat, "🧾 Qual o <b>número da nota fiscal</b>?\n<i>Só os números. Ex.: 1320080</i>");
    case "cliente":
      return enviar(chat, "🏪 Qual o <b>cliente</b>?\n<i>Digite o código ou parte do nome. Ex.: QUARTETTO</i>");
    case "cliente_manual":
      return enviar(chat, "✍️ Digite o <b>nome do cliente</b> como está na nota:");
    case "motivo": {
      const { data } = await db.from("motivos_devolucao").select("codigo, nome")
        .eq("ativo", true).eq("visivel_motorista", true).order("ordem");
      const linhas: Botao[][] = [];
      (data ?? []).forEach((m: any, i: number) => {
        if (i % 2 === 0) linhas.push([]);
        linhas[linhas.length - 1].push([m.nome, `mot:${id}:${m.codigo}`]);
      });
      return enviar(chat, "❓ Qual o <b>motivo</b> da devolução?", { reply_markup: teclado(linhas) });
    }
    case "tipo":
      return enviar(chat, "📦 A devolução é da <b>nota inteira</b> ou <b>só de parte</b> dela?", {
        reply_markup: teclado([[["Nota inteira (total)", `tipo:${id}:total`], ["Só uma parte (parcial)", `tipo:${id}:parcial`]]]),
      });
    case "itens": {
      const itens = await itensDa(id);
      const botoes = itens.length
        ? { reply_markup: teclado([[["✅ Terminei os itens", `itens_fim:${id}`], ["↩️ Apagar o último", `itens_desf:${id}`]]]) }
        : {};
      return enviar(chat,
        "📝 Quais <b>itens</b> voltaram?\nMande <b>um item por mensagem</b>, com a quantidade.\n<i>Ex.: FRANGO INTEIRO 12 CX</i>" +
        (itens.length ? `\n\nJá anotados: ${itens.length}` : ""), botoes);
    }
    case "fotos": {
      const m = await motivo(sol.motivo_codigo);
      const min = m?.min_fotos ?? 0;
      const qtd = await contarAnexos(id, ["foto_produto"]);
      const orient = m?.orientacao_fotos ? ` ${esc(m.orientacao_fotos)}` : "";
      const linhas: Botao[][] = [[["✅ Terminei as fotos", `fotos_fim:${id}`]]];
      if (min === 0 && qtd === 0) linhas[0] = [["Não tenho fotos (pular)", `fotos_fim:${id}`]];
      return enviar(chat,
        `📷 Mande as <b>fotos</b>${orient}.` +
        (min > 0 ? `\nMínimo: <b>${min}</b>.` : "\n<i>Fotos são opcionais para este motivo.</i>") +
        (qtd ? `\nRecebidas até agora: ${qtd}` : ""),
        { reply_markup: teclado(linhas) });
    }
    case "canhoto": {
      const m = await motivo(sol.motivo_codigo);
      const exige = m?.exige_canhoto ?? true;
      return enviar(chat, "🧾 Mande uma <b>foto do canhoto</b> (ou da nota) assinado.", {
        reply_markup: teclado([[exige ? ["Não tenho o canhoto", `can_nao:${id}`] : ["Pular", `can_nao:${id}`]]]),
      });
    }
    case "canhoto_justificativa":
      return enviar(chat, "✍️ Por que não tem o canhoto? Escreva em poucas palavras.");
    case "localizacao":
      return enviar(chat, "📍 Toque no botão <b>Enviar localização</b> aqui embaixo 👇", {
        reply_markup: {
          keyboard: [[{ text: "📍 Enviar localização", request_location: true }], [{ text: "Não consigo enviar" }]],
          resize_keyboard: true, one_time_keyboard: true,
        },
      });
    case "localizacao_justificativa":
      return enviar(chat, "✍️ Por que não conseguiu enviar a localização? Escreva em poucas palavras.",
        { reply_markup: { remove_keyboard: true } });
    case "observacoes":
      return enviar(chat, "💬 Alguma <b>observação</b>? Escreva ou mande um <b>áudio</b>.", {
        reply_markup: teclado([[["Pular", `obs_pular:${id}`]]]),
      });
    case "resumo": {
      const faltas = await pendencias(sol);
      if (faltas.length) {
        const f = faltas[0];
        await enviar(chat, `⚠️ Ainda falta: <b>${esc(f.texto)}</b>.`);
        const nova = await atualizarSol(id, { etapa: f.etapa, corrigindo: true });
        return perguntar(nova);
      }
      const texto = await montarResumo(sol, false);
      return enviar(chat, texto + "\n\n<b>Está tudo certo?</b>", {
        reply_markup: teclado([
          [["✅ Enviar ao SAC", `env:${id}`]],
          [["✏️ Corrigir", `corr:${id}`], ["❌ Cancelar", `canc:${id}`]],
        ]),
      });
    }
  }
}

async function montarResumo(sol: any, paraSac: boolean): Promise<string> {
  const m = await motivo(sol.motivo_codigo);
  const itens = await itensDa(sol.id);
  const nFotos = await contarAnexos(sol.id, ["foto_produto"]);
  const nCanhoto = await contarAnexos(sol.id, ["canhoto"]);
  const nAudio = await contarAnexos(sol.id, ["audio"]);
  const cliente = sol.cliente_id
    ? `${esc(sol.cliente_codigo)} - ${esc(sol.cliente_nome)}${sol.cliente_cidade ? ` (${esc(sol.cliente_cidade)})` : ""}`
    : `${esc(sol.cliente_nome)} <i>(digitado, não encontrado no cadastro)</i>`;
  const linhas = [
    `📦 <b>SOLICITAÇÃO ${esc(sol.protocolo)}</b>`,
    `👤 Motorista: <b>${esc(sol.motorista_nome)}</b>`,
    `🧾 NF: <b>${esc(sol.nota_fiscal)}</b>` + (sol.nf_duplicada_de ? `  ⚠️ <i>mesma NF da ${esc(sol.nf_duplicada_de)}</i>` : ""),
    `🏪 Cliente: ${cliente}`,
    `❓ Motivo: <b>${esc(m?.nome ?? sol.motivo_codigo)}</b>`,
    `📦 Tipo: <b>${sol.tipo_devolucao === "total" ? "TOTAL (nota inteira)" : "PARCIAL"}</b>`,
  ];
  if (itens.length) linhas.push("📝 Itens:\n" + itens.map((i: any) => `   • ${esc(i.texto)}`).join("\n"));
  linhas.push(`📷 Fotos: ${nFotos}   |   🧾 Canhoto: ${nCanhoto ? "sim" : `não (${esc(sol.canhoto_justificativa ?? "-")})`}`);
  linhas.push(sol.latitude != null
    ? `📍 Localização: enviada`
    : `📍 Localização: não enviada (${esc(sol.localizacao_justificativa ?? "-")})`);
  if (sol.observacoes) linhas.push(`💬 Observações: ${esc(sol.observacoes)}`);
  if (nAudio) linhas.push(`🎤 Áudio: ${nAudio}`);
  if (paraSac) linhas.push(`🕒 Enviada em ${fmtData(sol.enviado_sac_em ?? new Date())}`);
  return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Publicacao no grupo do SAC
// ---------------------------------------------------------------------------
const tecladoSac = (id: number) => teclado([
  [["✅ Ocorrência aberta", `sac:abrir:${id}`]],
  [["↩️ Pedir complemento", `sac:comp:${id}`], ["❌ Reprovar", `sac:repr:${id}`]],
]);

async function enviarMidias(grupo: string, anexos: any[], legenda: string, responderA?: number) {
  const reply = responderA ? { reply_parameters: { message_id: responderA, allow_sending_without_reply: true } } : {};
  const fotos = anexos.filter((a) => a.midia === "photo");
  for (let i = 0; i < fotos.length; i += 10) {
    const lote = fotos.slice(i, i + 10);
    if (lote.length === 1) {
      await tg("sendPhoto", { chat_id: grupo, photo: lote[0].telegram_file_id, caption: `${legenda} · ${lote[0].tipo === "canhoto" ? "canhoto" : "foto"}`, ...reply });
    } else {
      await tg("sendMediaGroup", {
        chat_id: grupo, ...reply,
        media: lote.map((a, j) => ({
          type: "photo", media: a.telegram_file_id,
          caption: j === 0 ? `${legenda} · ${lote.length} imagens` : (a.tipo === "canhoto" ? "canhoto" : undefined),
        })),
      });
    }
  }
  for (const a of anexos.filter((a) => a.midia === "document")) {
    await tg("sendDocument", { chat_id: grupo, document: a.telegram_file_id, caption: `${legenda} · ${a.tipo}`, ...reply });
  }
  for (const a of anexos.filter((a) => a.midia === "voice")) {
    await tg("sendVoice", { chat_id: grupo, voice: a.telegram_file_id, caption: `${legenda} · áudio`, ...reply });
  }
  for (const a of anexos.filter((a) => a.midia === "audio")) {
    await tg("sendAudio", { chat_id: grupo, audio: a.telegram_file_id, caption: `${legenda} · áudio`, ...reply });
  }
}

async function publicarNoGrupo(sol: any): Promise<boolean> {
  const grupo = await cfg("sac_grupo_id");
  if (!grupo) return false;
  const { data: anexos } = await db.from("solicitacao_anexos").select("*")
    .eq("solicitacao_id", sol.id).eq("enviado_sac", false).order("id");
  const ordenados = [...(anexos ?? [])].sort((a, b) =>
    (a.tipo === "canhoto" ? 1 : 0) - (b.tipo === "canhoto" ? 1 : 0) || a.id - b.id);
  await enviarMidias(grupo, ordenados, sol.protocolo);
  if (sol.latitude != null) {
    await tg("sendLocation", { chat_id: grupo, latitude: Number(sol.latitude), longitude: Number(sol.longitude) });
  }
  const r = await enviar(grupo, await montarResumo(sol, true), { reply_markup: tecladoSac(sol.id) });
  if (!r?.ok) return false;
  await db.from("solicitacoes_devolucao").update({ sac_message_id: r.result.message_id }).eq("id", sol.id);
  if (anexos?.length) await db.from("solicitacao_anexos").update({ enviado_sac: true }).in("id", anexos.map((a: any) => a.id));
  return true;
}

// ---------------------------------------------------------------------------
// Mensagens privadas (motorista)
// ---------------------------------------------------------------------------
const AJUDA_MOTORISTA =
  "ℹ️ <b>Como usar</b>\n" +
  "/nova – abrir uma solicitação de devolução\n" +
  "/status – ver as suas últimas solicitações\n" +
  "/cancelar – cancelar a que está em preenchimento\n\n" +
  "O bot faz as perguntas uma de cada vez. Responda escrevendo ou tocando nos botões. " +
  "No fim você confere o resumo e envia ao SAC. A resposta do SAC chega aqui.";

async function tratarPrivado(msg: any) {
  const chatId = msg.chat.id;
  const texto: string = (msg.text ?? "").trim();
  const [cmdBruto, ...args] = texto.split(/\s+/);
  const cmd = cmdBruto.startsWith("/") ? cmdBruto.split("@")[0].toLowerCase() : "";

  if (cmd === "/start" && args[0]) return vincularPorCodigo(msg, args[0]);

  const mt = await motoristaDoChat(chatId);
  if (!mt) {
    return enviar(chatId,
      "🚫 Este bot é de uso exclusivo dos motoristas da <b>JR Distribuidora</b>.\n" +
      "Para usar, peça ao SAC o seu <b>link de acesso</b>.");
  }
  const nomeMotorista = mt.motoristas?.nome ?? "motorista";

  if (cmd === "/start") {
    return enviar(chatId, `👋 Olá, <b>${esc(nomeMotorista)}</b>!\n\n${AJUDA_MOTORISTA}`);
  }
  if (cmd === "/ajuda" || cmd === "/help") return enviar(chatId, AJUDA_MOTORISTA);
  if (cmd === "/nova") return novaSolicitacao(mt, nomeMotorista, chatId);
  if (cmd === "/status") return statusMotorista(chatId);
  if (cmd === "/cancelar") return cancelarEmColeta(mt, chatId, nomeMotorista);
  if (cmd) return enviar(chatId, "Não conheço esse comando. " + AJUDA_MOTORISTA);

  // Respondendo a um pedido de complemento do SAC?
  if (mt.solicitacao_ativa_id) {
    const alvo = await carregarSol(mt.solicitacao_ativa_id);
    if (alvo && alvo.status === "pendente_complemento" && alvo.motorista_id === mt.motorista_id) {
      return tratarComplemento(alvo, msg, nomeMotorista);
    }
    await db.from("motoristas_telegram").update({ solicitacao_ativa_id: null }).eq("id", mt.id);
  }

  const sol = await solEmColeta(mt.motorista_id);
  if (!sol) {
    if (msg.location) return enviar(chatId, "📍 Recebi a localização, mas não há devolução em preenchimento. Toque em /nova para abrir uma.");
    return enviar(chatId, "Para abrir uma devolução, toque em /nova.\nPara ver as suas, toque em /status.");
  }
  return tratarEtapa(sol, msg);
}

async function novaSolicitacao(mt: any, nomeMotorista: string, chatId: number) {
  const existente = await solEmColeta(mt.motorista_id);
  if (existente) {
    const parada = Date.now() - new Date(existente.ultima_interacao_em).getTime() > HORAS_ABANDONO * 3600e3;
    if (parada) {
      await mudarStatus(existente, "cancelada", { etapa: null }, "sistema", "bot",
        `sem resposta por mais de ${HORAS_ABANDONO} h`);
    } else {
      return enviar(chatId,
        `Você já tem a <b>${esc(existente.protocolo)}</b> em preenchimento.`, {
          reply_markup: teclado([
            [["Continuar essa", `cont:${existente.id}`]],
            [["Descartar e começar outra", `desc:${existente.id}`]],
          ]),
        });
    }
  }
  await db.from("motoristas_telegram").update({ solicitacao_ativa_id: null }).eq("id", mt.id);
  const { data: sol, error } = await db.from("solicitacoes_devolucao").insert({
    motorista_id: mt.motorista_id, motorista_nome: nomeMotorista, chat_id: chatId, etapa: "nf",
  }).select("*").single();
  if (error) throw new Error(`novaSolicitacao: ${error.message}`);
  await registrarHistorico(sol.id, null, "em_coleta", "motorista", nomeMotorista, "aberta pelo bot");
  await enviar(chatId, `📦 Nova devolução <b>${esc(sol.protocolo)}</b>\n<i>Para desistir a qualquer momento: /cancelar</i>`);
  return perguntar(sol);
}

async function statusMotorista(chatId: number) {
  const { data } = await db.from("solicitacoes_devolucao")
    .select("protocolo, nota_fiscal, status, numero_devolucao, criado_em")
    .eq("chat_id", chatId).order("criado_em", { ascending: false }).limit(5);
  if (!data?.length) return enviar(chatId, "Você ainda não tem solicitações. Toque em /nova para abrir uma.");
  const linhas = data.map((s: any) =>
    `<b>${esc(s.protocolo)}</b> · NF ${esc(s.nota_fiscal ?? "-")} · ${fmtData(s.criado_em)}\n` +
    `   ${ROTULO_STATUS[s.status] ?? s.status}${s.numero_devolucao ? ` (${esc(s.numero_devolucao)})` : ""}`);
  return enviar(chatId, "📋 <b>Suas últimas solicitações</b>\n\n" + linhas.join("\n\n"));
}

async function cancelarEmColeta(mt: any, chatId: number, nomeMotorista: string) {
  const sol = await solEmColeta(mt.motorista_id);
  if (!sol) return enviar(chatId, "Não há devolução em preenchimento para cancelar.", { reply_markup: { remove_keyboard: true } });
  await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMotorista, "cancelada pelo motorista");
  return enviar(chatId, `🚫 A <b>${esc(sol.protocolo)}</b> foi cancelada.`, { reply_markup: { remove_keyboard: true } });
}

async function tratarEtapa(sol: any, msg: any) {
  const chat = sol.chat_id;
  const texto: string = (msg.text ?? "").trim();

  // Foto que chega depois, do mesmo album de uma foto ja salva: guarda com o
  // mesmo tipo, sem responder (o album ja foi respondido na primeira).
  if (ehImagem(msg) && msg.media_group_id) {
    const tipoAlbum = await jaTemDoAlbum(sol.id, msg.media_group_id);
    if (tipoAlbum) { await salvarAnexo(sol, msg, tipoAlbum); return; }
  }

  // Localizacao aceita em qualquer etapa
  if (msg.location) {
    await atualizarSol(sol.id, { latitude: msg.location.latitude, longitude: msg.location.longitude, localizacao_justificativa: null });
    if (sol.etapa === "localizacao" || sol.etapa === "localizacao_justificativa") {
      await enviar(chat, "📍 Localização recebida.", { reply_markup: { remove_keyboard: true } });
      return avancar(await carregarSol(sol.id), "localizacao");
    }
    await enviar(chat, "📍 Localização guardada.");
    return perguntar(await carregarSol(sol.id));
  }

  switch (sol.etapa) {
    case "nf": {
      const nf = texto.replace(/\D/g, "");
      if (nf.length < 3 || nf.length > 10) {
        return enviar(chat, "Não entendi. Mande <b>só os números</b> da nota. Ex.: <code>1320080</code>");
      }
      const { data: dup } = await db.from("solicitacoes_devolucao").select("protocolo")
        .eq("nota_fiscal", nf).neq("id", sol.id).not("status", "in", "(cancelada,reprovada)").limit(1);
      const nfDup = dup?.[0]?.protocolo ?? null;
      const nova = await atualizarSol(sol.id, { nota_fiscal: nf, nf_duplicada_de: nfDup });
      await enviar(chat, `✔️ NF <b>${nf}</b> anotada.` +
        (nfDup ? `\n⚠️ Já existe a ${esc(nfDup)} com esta NF. Pode seguir; o SAC vai ver as duas.` : ""));
      return avancar(nova, "nf");
    }
    case "cliente": {
      if (texto.length < 3) return enviar(chat, "Digite pelo menos <b>3 letras</b> do nome ou o <b>código</b> do cliente.");
      const { data: achados, error } = await db.rpc("bot_buscar_clientes", { p_termo: texto, p_limite: 6 });
      if (error) throw new Error(`bot_buscar_clientes: ${error.message}`);
      if (!achados?.length) {
        return enviar(chat, `Não encontrei cliente com "<b>${esc(texto)}</b>".\nTente outra parte do nome ou o código.`, {
          reply_markup: teclado([[["✍️ Digitar o nome manualmente", `cli:${sol.id}:manual`]]]),
        });
      }
      const linhas: Botao[][] = achados.map((c: any) =>
        [[`${c.codigo_cliente} - ${c.razao_social}${c.cidade ? ` (${c.cidade})` : ""}`.slice(0, 60), `cli:${sol.id}:${c.id}`]]);
      linhas.push([["Não está na lista", `cli:${sol.id}:manual`]]);
      return enviar(chat, "Qual destes? 👇\n<i>Se não estiver aqui, digite outra parte do nome.</i>", { reply_markup: teclado(linhas) });
    }
    case "cliente_manual": {
      if (texto.length < 3) return enviar(chat, "Digite o nome do cliente (pelo menos 3 letras).");
      const nova = await atualizarSol(sol.id, { cliente_id: null, cliente_codigo: null, cliente_cidade: null, cliente_nome: texto.toUpperCase() });
      await enviar(chat, `✔️ Cliente: <b>${esc(texto.toUpperCase())}</b>`);
      return avancar(nova, "cliente_manual");
    }
    case "itens": {
      if (!texto) return enviar(chat, "Mande o item <b>escrito</b>, com a quantidade. Ex.: <i>FRANGO INTEIRO 12 CX</i>");
      await db.from("solicitacao_itens").insert({ solicitacao_id: sol.id, texto: texto.toUpperCase() });
      await atualizarSol(sol.id, {});
      const n = (await itensDa(sol.id)).length;
      return enviar(chat, `✔️ Item ${n}: <i>${esc(texto.toUpperCase())}</i>\nMande o próximo ou toque em <b>Terminei</b>.`, {
        reply_markup: teclado([[["✅ Terminei os itens", `itens_fim:${sol.id}`], ["↩️ Apagar o último", `itens_desf:${sol.id}`]]]),
      });
    }
    case "fotos": {
      if (!ehImagem(msg)) {
        return enviar(chat, "Estou esperando <b>fotos</b> 📷. Se já mandou todas, toque em <b>Terminei</b>.", {
          reply_markup: teclado([[["✅ Terminei as fotos", `fotos_fim:${sol.id}`]]]),
        });
      }
      await salvarAnexo(sol, msg, "foto_produto");
      await atualizarSol(sol.id, {});
      const qtd = await contarAnexos(sol.id, ["foto_produto"]);
      return enviar(chat,
        msg.media_group_id ? "📷 Recebendo as fotos… Pode mandar mais ou tocar em <b>Terminei</b>."
                           : `📷 Foto ${qtd} recebida. Pode mandar mais ou tocar em <b>Terminei</b>.`,
        { reply_markup: teclado([[["✅ Terminei as fotos", `fotos_fim:${sol.id}`]]]) });
    }
    case "canhoto": {
      if (!ehImagem(msg)) return perguntar(sol);
      await salvarAnexo(sol, msg, "canhoto");
      await enviar(chat, "✔️ Canhoto recebido.");
      return avancar(await atualizarSol(sol.id, { canhoto_justificativa: null }), "canhoto");
    }
    case "canhoto_justificativa": {
      if (texto.length < 3) return perguntar(sol);
      return avancar(await atualizarSol(sol.id, { canhoto_justificativa: texto.toUpperCase() }), "canhoto_justificativa");
    }
    case "localizacao": {
      if (texto.toLowerCase().startsWith("não consigo") || texto.toLowerCase().startsWith("nao consigo")) {
        const m = await motivo(sol.motivo_codigo);
        if (m?.exige_localizacao ?? true) return perguntar(await atualizarSol(sol.id, { etapa: "localizacao_justificativa" }));
        await enviar(chat, "Tudo bem.", { reply_markup: { remove_keyboard: true } });
        return avancar(sol, "localizacao");
      }
      return perguntar(sol);
    }
    case "localizacao_justificativa": {
      if (texto.length < 3) return perguntar(sol);
      return avancar(await atualizarSol(sol.id, { localizacao_justificativa: texto.toUpperCase() }), "localizacao_justificativa");
    }
    case "observacoes": {
      if (ehAudio(msg)) {
        await salvarAnexo(sol, msg, "audio");
        await enviar(chat, "🎤 Áudio recebido.");
        return avancar(sol, "observacoes");
      }
      if (ehImagem(msg)) {
        await salvarAnexo(sol, msg, "observacao");
        await enviar(chat, "📷 Imagem guardada junto das observações.");
        return avancar(sol, "observacoes");
      }
      if (!texto) return perguntar(sol);
      const obs = sol.observacoes ? `${sol.observacoes} ${texto.toUpperCase()}` : texto.toUpperCase();
      return avancar(await atualizarSol(sol.id, { observacoes: obs }), "observacoes");
    }
    case "motivo":
    case "tipo":
    case "resumo":
      await enviar(chat, "Toque em uma das opções nos <b>botões</b> 👇");
      return perguntar(sol);
    default:
      return perguntar(sol);
  }
}

// ---------------------------------------------------------------------------
// Complemento pedido pelo SAC
// ---------------------------------------------------------------------------
async function tratarComplemento(sol: any, msg: any, nomeMotorista: string) {
  const chat = sol.chat_id;
  const texto: string = (msg.text ?? "").trim();
  const botao = { reply_markup: teclado([[["📨 Enviar complemento ao SAC", `comp_env:${sol.id}`]]]) };

  if (ehImagem(msg) || ehAudio(msg)) {
    const doAlbum = msg.media_group_id ? await jaTemDoAlbum(sol.id, msg.media_group_id) : null;
    await salvarAnexo(sol, msg, "complemento");
    if (doAlbum) return;
    return enviar(chat, "✔️ Recebido. Mande mais ou toque em <b>Enviar complemento</b>.", botao);
  }
  if (msg.location) {
    await db.from("solicitacoes_devolucao").update({ latitude: msg.location.latitude, longitude: msg.location.longitude }).eq("id", sol.id);
    return enviar(chat, "📍 Localização recebida. Mande mais ou toque em <b>Enviar complemento</b>.", botao);
  }
  if (!texto) return;
  const resposta = sol.complemento_resposta ? `${sol.complemento_resposta}\n${texto}` : texto;
  await db.from("solicitacoes_devolucao").update({ complemento_resposta: resposta }).eq("id", sol.id);
  void nomeMotorista;
  return enviar(chat, "✔️ Anotado. Mande mais ou toque em <b>Enviar complemento</b>.", botao);
}

async function enviarComplemento(sol: any, mt: any, nomeMotorista: string) {
  const chat = sol.chat_id;
  const { count } = await db.from("solicitacao_anexos").select("id", { count: "exact", head: true })
    .eq("solicitacao_id", sol.id).eq("tipo", "complemento").eq("enviado_sac", false);
  if (!sol.complemento_resposta && !count) {
    return enviar(chat, "Mande primeiro o que o SAC pediu (texto, foto ou áudio).");
  }
  const grupo = await cfg("sac_grupo_id");
  if (!grupo) return enviar(chat, "⚠️ O grupo do SAC ainda não foi configurado. Avise o SAC.");

  const nova = await mudarStatus(sol, "aguardando_sac", {}, "motorista", nomeMotorista, sol.complemento_resposta ?? "anexos");
  if (!nova) return enviar(chat, "Esta solicitação não está mais aguardando complemento.");

  const { data: anexos } = await db.from("solicitacao_anexos").select("*")
    .eq("solicitacao_id", sol.id).eq("tipo", "complemento").eq("enviado_sac", false).order("id");
  if (sol.sac_message_id) await tirarBotoes(grupo, sol.sac_message_id);
  await enviarMidias(grupo, anexos ?? [], `${sol.protocolo} complemento`, sol.sac_message_id ?? undefined);
  const r = await enviar(grupo,
    `📝 <b>COMPLEMENTO · ${esc(sol.protocolo)}</b>\n👤 ${esc(sol.motorista_nome)} · NF ${esc(sol.nota_fiscal)}\n\n` +
    `<b>O SAC pediu:</b> ${esc(sol.complemento_pedido)}\n<b>Resposta:</b> ${esc(sol.complemento_resposta ?? "(só anexos)")}`,
    { reply_markup: tecladoSac(sol.id), reply_parameters: sol.sac_message_id ? { message_id: sol.sac_message_id, allow_sending_without_reply: true } : undefined });
  if (r?.ok) await db.from("solicitacoes_devolucao").update({ sac_message_id: r.result.message_id }).eq("id", sol.id);
  if (anexos?.length) await db.from("solicitacao_anexos").update({ enviado_sac: true }).in("id", anexos.map((a: any) => a.id));

  await db.from("motoristas_telegram").update({ solicitacao_ativa_id: null }).eq("id", mt.id);
  await enviar(chat, `📨 Complemento da <b>${esc(sol.protocolo)}</b> enviado ao SAC.`);
  const emColeta = await solEmColeta(mt.motorista_id);
  if (emColeta) {
    await enviar(chat, `Voltando à <b>${esc(emColeta.protocolo)}</b>, que estava em preenchimento:`);
    return perguntar(emColeta);
  }
}

// ---------------------------------------------------------------------------
// Vinculo motorista <-> Telegram
// ---------------------------------------------------------------------------
async function vincularPorCodigo(msg: any, codigo: string) {
  const chatId = msg.chat.id;
  const { data: v } = await db.from("motoristas_telegram").select("*, motoristas(nome)")
    .eq("codigo_vinculo", codigo).eq("ativo", true).maybeSingle();
  if (!v || v.chat_id) {
    return enviar(chatId, "⚠️ Este link é inválido ou já foi usado. Peça um novo ao SAC.");
  }
  if (v.codigo_expira_em && new Date(v.codigo_expira_em).getTime() < Date.now()) {
    return enviar(chatId, "⚠️ Este link venceu. Peça um novo ao SAC.");
  }
  // Se este Telegram estava ligado a outro motorista, desliga o antigo.
  await db.from("motoristas_telegram")
    .update({ ativo: false, revogado_em: new Date().toISOString(), revogado_por: "substituído por novo vínculo" })
    .eq("chat_id", chatId).eq("ativo", true);
  const { error } = await db.from("motoristas_telegram").update({
    chat_id: chatId, telegram_user_id: msg.from?.id ?? null, telegram_username: msg.from?.username ?? null,
    vinculado_em: new Date().toISOString(), codigo_vinculo: null, codigo_expira_em: null,
  }).eq("id", v.id);
  if (error) throw new Error(`vincular: ${error.message}`);

  const nome = v.motoristas?.nome ?? "motorista";
  await enviar(chatId, `✅ Pronto, <b>${esc(nome)}</b>! Seu acesso está ativo.\n\n${AJUDA_MOTORISTA}`);
  const grupo = await cfg("sac_grupo_id");
  if (grupo) await enviar(grupo, `🔗 <b>${esc(nome)}</b> ativou o acesso ao bot (Telegram: ${esc(nomeTelegram(msg.from))}).`);
}

async function gerarLink(grupo: string, motoristaId: number, autor: string) {
  const { data: mot } = await db.from("motoristas").select("id, nome").eq("id", motoristaId).maybeSingle();
  if (!mot) return enviar(grupo, "Motorista não encontrado.");
  const { data: atual } = await db.from("motoristas_telegram").select("*")
    .eq("motorista_id", motoristaId).eq("ativo", true).maybeSingle();
  if (atual?.chat_id) {
    return enviar(grupo,
      `ℹ️ <b>${esc(mot.nome)}</b> já está vinculado` +
      (atual.telegram_username ? ` (@${esc(atual.telegram_username)})` : "") +
      ` desde ${fmtData(atual.vinculado_em)}.\nPara trocar o celular, use /desvincular primeiro.`);
  }
  const codigo = codigoAleatorio();
  const expira = new Date(Date.now() + HORAS_VALIDADE_LINK * 3600e3).toISOString();
  if (atual) {
    await db.from("motoristas_telegram").update({ codigo_vinculo: codigo, codigo_expira_em: expira, criado_por: autor }).eq("id", atual.id);
  } else {
    const { error } = await db.from("motoristas_telegram").insert({
      motorista_id: motoristaId, codigo_vinculo: codigo, codigo_expira_em: expira, criado_por: autor,
    });
    if (error) throw new Error(`gerarLink: ${error.message}`);
  }
  const link = `https://t.me/${await botUsername()}?start=${codigo}`;
  return enviar(grupo,
    `🔗 Link de acesso de <b>${esc(mot.nome)}</b>\n${link}\n\n` +
    `Válido até <b>${fmtData(expira)}</b> e só funciona <b>uma vez</b>.\n` +
    `Encaminhe ao motorista pelo WhatsApp. Ele deve abrir no celular que tem o Telegram e tocar em <b>Iniciar</b>.`);
}

async function desvincular(grupo: string, motoristaId: number, autor: string) {
  const { data: atual } = await db.from("motoristas_telegram").select("*, motoristas(nome)")
    .eq("motorista_id", motoristaId).eq("ativo", true).maybeSingle();
  if (!atual) return enviar(grupo, "Este motorista não tem acesso ativo.");
  await db.from("motoristas_telegram").update({
    ativo: false, revogado_em: new Date().toISOString(), revogado_por: autor, codigo_vinculo: null,
  }).eq("id", atual.id);
  if (atual.chat_id) await enviar(atual.chat_id, "🔒 Seu acesso ao bot de devoluções foi encerrado pelo SAC.");
  return enviar(grupo, `🔒 Acesso de <b>${esc(atual.motoristas?.nome)}</b> encerrado.`);
}

// ---------------------------------------------------------------------------
// Grupo do SAC
// ---------------------------------------------------------------------------
const AJUDA_SAC =
  "ℹ️ <b>Comandos do SAC</b>\n" +
  "/vincular <i>nome</i> – gera o link de acesso de um motorista\n" +
  "/desvincular <i>nome</i> – encerra o acesso de um motorista\n" +
  "/pendentes – solicitações aguardando o SAC\n\n" +
  "Nas solicitações, use os botões. Quando o bot pedir, <b>responda à mensagem dele</b> " +
  "(segure a mensagem e toque em Responder).";

async function tratarGrupo(msg: any) {
  const chatId = String(msg.chat.id);
  const grupo = await cfg("sac_grupo_id");

  // Grupo virou supergrupo: o Telegram troca o id. Chegam duas mensagens
  // (uma no grupo antigo, outra no novo), em qualquer ordem.
  if (msg.migrate_to_chat_id && grupo === chatId) {
    await setCfg("sac_grupo_id", String(msg.migrate_to_chat_id));
    return;
  }
  if (msg.migrate_from_chat_id && grupo === String(msg.migrate_from_chat_id)) {
    await setCfg("sac_grupo_id", chatId);
    return;
  }

  const texto: string = (msg.text ?? "").trim();
  const [cmdBruto, ...args] = texto.split(/\s+/);
  const cmd = cmdBruto.startsWith("/") ? cmdBruto.split("@")[0].toLowerCase() : "";

  if (cmd === "/registrar_grupo") {
    if (!grupo) {
      await setCfg("sac_grupo_id", chatId);
      return enviar(chatId, "✅ Este grupo foi registrado como o <b>grupo do SAC</b>.\n\n" + AJUDA_SAC);
    }
    return enviar(chatId, grupo === chatId ? "Este grupo já é o grupo do SAC." : "⚠️ Já existe outro grupo do SAC registrado.");
  }

  if (!grupo) return; // ainda nao configurado: so /registrar_grupo funciona
  if (grupo !== chatId) { await tg("leaveChat", { chat_id: chatId }); return; }

  // Resposta a um "responda a esta mensagem"
  const respondida = msg.reply_to_message;
  if (respondida?.message_id) {
    const { data: pend } = await db.from("sac_acoes_pendentes").select("*")
      .eq("prompt_message_id", respondida.message_id).is("concluida_em", null).maybeSingle();
    if (pend) return executarAcaoSac(pend, msg, chatId);
    if (respondida.from?.is_bot && typeof respondida.text === "string") {
      if (respondida.text.startsWith(MARCA_VINCULAR)) return buscarMotoristaParaAcao(chatId, "/vincular", texto);
      if (respondida.text.startsWith(MARCA_DESVINCULAR)) return buscarMotoristaParaAcao(chatId, "/desvincular", texto);
    }
  }

  if (cmd === "/vincular" || cmd === "/desvincular") return buscarMotoristaParaAcao(chatId, cmd, args.join(" "));
  if (cmd === "/pendentes") return listarPendentes(chatId);
  if (cmd === "/ajuda" || cmd === "/help" || cmd === "/start") return enviar(chatId, AJUDA_SAC);
}

// Com o modo de privacidade do Telegram ligado, o bot so le no grupo os
// comandos e as RESPOSTAS as mensagens dele. Por isso, quando o nome nao vem
// junto do comando, o bot pede o nome como resposta a esta mensagem-marca.
const MARCA_VINCULAR = "🔎 Gerar link:";
const MARCA_DESVINCULAR = "🔎 Encerrar acesso:";

async function buscarMotoristaParaAcao(grupo: string, cmd: string, termo: string) {
  const vincular = cmd === "/vincular";
  termo = termo.trim();
  if (termo.length < 3) {
    return enviar(grupo, `${vincular ? MARCA_VINCULAR : MARCA_DESVINCULAR} <b>responda a esta mensagem</b> com o nome do motorista.`, {
      reply_markup: { force_reply: true, input_field_placeholder: "Nome do motorista" },
    });
  }
  const { data: achados, error } = await db.rpc("bot_buscar_motoristas", { p_termo: termo, p_limite: 8 });
  if (error) throw new Error(`bot_buscar_motoristas: ${error.message}`);
  if (!achados?.length) return enviar(grupo, `Nenhum motorista encontrado com "<b>${esc(termo)}</b>".`);
  return enviar(grupo, vincular ? "Gerar link para qual motorista?" : "Encerrar o acesso de qual motorista?", {
    reply_markup: teclado(achados.map((m: any) => [[m.nome, `${vincular ? "vinc" : "desv"}:${m.id}`]])),
  });
}

async function listarPendentes(grupo: string) {
  const { data } = await db.from("solicitacoes_devolucao")
    .select("protocolo, motorista_nome, nota_fiscal, status, enviado_sac_em")
    .in("status", ["aguardando_sac", "pendente_complemento"]).order("enviado_sac_em");
  if (!data?.length) return enviar(grupo, "✅ Nada pendente.");
  const linhas = data.map((s: any) => {
    const horas = s.enviado_sac_em ? Math.floor((Date.now() - new Date(s.enviado_sac_em).getTime()) / 3600e3) : 0;
    return `<b>${esc(s.protocolo)}</b> · ${esc(s.motorista_nome)} · NF ${esc(s.nota_fiscal)}\n   ${ROTULO_STATUS[s.status]} · há ${horas} h`;
  });
  return enviar(grupo, `📋 <b>Pendentes (${data.length})</b>\n\n` + linhas.join("\n\n"));
}

const PERGUNTA_ACAO: Record<string, string> = {
  abrir: "com o <b>número da DEV</b> aberta no Jr-Oper",
  complemento: "com <b>o que falta</b> (isso será enviado ao motorista)",
  reprovar: "com o <b>motivo da reprovação</b> (isso será enviado ao motorista)",
};

async function executarAcaoSac(pend: any, msg: any, grupo: string) {
  const texto: string = (msg.text ?? "").trim();
  if (!texto) return enviar(grupo, "Responda com <b>texto</b>, por favor.");
  const sol = await carregarSol(pend.solicitacao_id);
  if (!sol) return;
  const autor = nomeTelegram(msg.from);
  const agora = new Date().toISOString();
  const ref = `<b>${esc(sol.protocolo)}</b> (NF ${esc(sol.nota_fiscal)})`;

  if (pend.acao === "abrir") {
    const n = texto.match(/\d+/)?.[0];
    if (!n) {
      return enviar(grupo, "Não achei o número. Responda à mensagem anterior só com o número da DEV, ex.: <code>149</code>");
    }
    const dev = `DEV-${n}`;
    const nova = await mudarStatus(sol, "ocorrencia_aberta",
      { numero_devolucao: dev, decidido_por: autor, decidido_em: agora }, "sac", autor, dev);
    if (!nova) return enviar(grupo, `⚠️ Não foi possível: a ${ref} está "${ROTULO_STATUS[sol.status]}".`);
    await enviar(sol.chat_id, `✅ Sua devolução ${ref} foi registrada pelo SAC como <b>${dev}</b>.`);
    await enviar(grupo, `✅ ${ref} → <b>${dev}</b> (por ${esc(autor)}). Motorista avisado.`);
  } else if (pend.acao === "complemento") {
    const nova = await mudarStatus(sol, "pendente_complemento",
      { complemento_pedido: texto, complemento_resposta: null }, "sac", autor, texto);
    if (!nova) return enviar(grupo, `⚠️ Não foi possível: a ${ref} está "${ROTULO_STATUS[sol.status]}".`);
    const { data: mt } = await db.from("motoristas_telegram").select("*")
      .eq("motorista_id", sol.motorista_id).eq("ativo", true).maybeSingle();
    const emColeta = sol.motorista_id ? await solEmColeta(sol.motorista_id) : null;
    if (mt && !emColeta) await db.from("motoristas_telegram").update({ solicitacao_ativa_id: sol.id }).eq("id", mt.id);
    await enviar(sol.chat_id,
      `📝 O SAC precisa de mais informações sobre a devolução ${ref}:\n\n<i>${esc(texto)}</i>\n\n` +
      (emColeta
        ? "Quando puder, toque em <b>Responder agora</b>."
        : "Responda aqui (texto, fotos ou áudio) e depois toque em <b>Enviar complemento</b>."),
      emColeta ? { reply_markup: teclado([[["✍️ Responder agora", `comp:${sol.id}`]]]) } : {});
    await enviar(grupo, `↩️ Complemento da ${ref} pedido ao motorista (por ${esc(autor)}).`);
  } else if (pend.acao === "reprovar") {
    const nova = await mudarStatus(sol, "reprovada",
      { decisao_motivo: texto, decidido_por: autor, decidido_em: agora }, "sac", autor, texto);
    if (!nova) return enviar(grupo, `⚠️ Não foi possível: a ${ref} está "${ROTULO_STATUS[sol.status]}".`);
    await enviar(sol.chat_id,
      `❌ A devolução ${ref} <b>não foi aprovada</b> pelo SAC.\nMotivo: <i>${esc(texto)}</i>\n\nEm caso de dúvida, fale com a central.`);
    await enviar(grupo, `❌ ${ref} reprovada (por ${esc(autor)}). Motorista avisado.`);
  }

  await db.from("sac_acoes_pendentes").update({ concluida_em: agora }).eq("prompt_message_id", pend.prompt_message_id);
  if (pend.acao !== "complemento") {
    const atual = await carregarSol(sol.id);
    if (atual?.sac_message_id) await tirarBotoes(grupo, atual.sac_message_id);
  }
}

// ---------------------------------------------------------------------------
// Botoes (callback_query)
// ---------------------------------------------------------------------------
async function tratarCallback(cq: any) {
  const data: string = cq.data ?? "";
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const responder = (text?: string) => tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: false });
  if (!chatId) return responder();

  const partes = data.split(":");
  const tipo = partes[0];

  // ---- botoes do grupo do SAC ----
  if (tipo === "sac" || tipo === "vinc" || tipo === "desv") {
    const grupo = await cfg("sac_grupo_id");
    if (!grupo || String(chatId) !== grupo) return responder("Ação não permitida aqui.");
    const autor = nomeTelegram(cq.from);
    if (tipo === "vinc") { await responder(); await tirarBotoes(chatId, messageId); return gerarLink(grupo, Number(partes[1]), autor); }
    if (tipo === "desv") { await responder(); await tirarBotoes(chatId, messageId); return desvincular(grupo, Number(partes[1]), autor); }

    const acao = ({ abrir: "abrir", comp: "complemento", repr: "reprovar" } as Record<string, string>)[partes[1]];
    const sol = await carregarSol(partes[2]);
    if (!acao || !sol) return responder("Solicitação não encontrada.");
    if (!["aguardando_sac", "pendente_complemento"].includes(sol.status)) {
      await responder(`Já está: ${ROTULO_STATUS[sol.status]}`);
      return tirarBotoes(chatId, messageId);
    }
    await responder();
    const r = await enviar(grupo,
      `✍️ ${esc(cq.from?.first_name ?? "")}, <b>responda a esta mensagem</b> ${PERGUNTA_ACAO[acao]} · ${esc(sol.protocolo)}`, {
        reply_markup: { force_reply: true, input_field_placeholder: acao === "abrir" ? "Ex.: 149" : "Escreva aqui" },
        reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
      });
    if (r?.ok) {
      await db.from("sac_acoes_pendentes").insert({
        prompt_message_id: r.result.message_id, solicitacao_id: sol.id, acao,
        telegram_user_id: cq.from?.id ?? null, telegram_user_nome: autor,
      });
    }
    return;
  }

  // ---- botoes do motorista (conversa privada) ----
  const mt = await motoristaDoChat(chatId);
  if (!mt) return responder("Acesso não autorizado.");
  const nomeMotorista = mt.motoristas?.nome ?? "motorista";
  const sol = await carregarSol(partes[1]);
  if (!sol || sol.motorista_id !== mt.motorista_id) return responder("Solicitação não encontrada.");

  const naoVale = async () => {
    await responder("Essa opção não vale mais.");
    await tirarBotoes(chatId, messageId);
    if (sol.status === "em_coleta") return perguntar(sol);
  };

  // Complemento
  if (tipo === "comp") {
    if (sol.status !== "pendente_complemento") return naoVale();
    await responder();
    await tirarBotoes(chatId, messageId);
    await db.from("motoristas_telegram").update({ solicitacao_ativa_id: sol.id }).eq("id", mt.id);
    return enviar(chatId,
      `✍️ Respondendo à <b>${esc(sol.protocolo)}</b>.\nO SAC pediu: <i>${esc(sol.complemento_pedido)}</i>\n\n` +
      "Mande texto, fotos ou áudio e depois toque em <b>Enviar complemento</b>.");
  }
  if (tipo === "comp_env") {
    if (sol.status !== "pendente_complemento") return naoVale();
    await responder();
    await tirarBotoes(chatId, messageId);
    return enviarComplemento(sol, mt, nomeMotorista);
  }

  // Continuar / descartar (vindos do /nova)
  if (tipo === "cont") {
    if (sol.status !== "em_coleta") return naoVale();
    await responder(); await tirarBotoes(chatId, messageId);
    return perguntar(sol);
  }
  if (tipo === "desc") {
    await responder(); await tirarBotoes(chatId, messageId);
    if (sol.status === "em_coleta") {
      await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMotorista, "descartada para abrir outra");
    }
    return novaSolicitacao(mt, nomeMotorista, chatId);
  }

  if (sol.status !== "em_coleta") return naoVale();

  if (tipo === "canc") {
    await responder(); await tirarBotoes(chatId, messageId);
    await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMotorista, "cancelada pelo motorista");
    return enviar(chatId, `🚫 A <b>${esc(sol.protocolo)}</b> foi cancelada.`, { reply_markup: { remove_keyboard: true } });
  }

  // Cada botao so vale na etapa em que foi mostrado.
  const etapaDoBotao: Record<string, string[]> = {
    cli: ["cliente"], mot: ["motivo"], tipo: ["tipo"], itens_fim: ["itens"], itens_desf: ["itens"],
    fotos_fim: ["fotos"], can_nao: ["canhoto"], obs_pular: ["observacoes"], env: ["resumo"], corr: ["resumo"],
  };
  if (!etapaDoBotao[tipo]?.includes(sol.etapa)) return naoVale();

  switch (tipo) {
    case "cli": {
      await responder(); await tirarBotoes(chatId, messageId);
      if (partes[2] === "manual") return perguntar(await atualizarSol(sol.id, { etapa: "cliente_manual" }));
      const { data: c } = await db.from("clientes").select("id, codigo_cliente, razao_social, cidade").eq("id", partes[2]).maybeSingle();
      if (!c) return perguntar(sol);
      const nova = await atualizarSol(sol.id, { cliente_id: c.id, cliente_codigo: c.codigo_cliente, cliente_nome: c.razao_social, cliente_cidade: c.cidade });
      await enviar(chatId, `✔️ Cliente: <b>${esc(c.codigo_cliente)} - ${esc(c.razao_social)}</b>`);
      return avancar(nova, "cliente");
    }
    case "mot": {
      const m = await motivo(partes[2]);
      if (!m) return naoVale();
      await responder(); await tirarBotoes(chatId, messageId);
      const nova = await atualizarSol(sol.id, { motivo_codigo: m.codigo });
      await enviar(chatId, `✔️ Motivo: <b>${esc(m.nome)}</b>`);
      return avancar(nova, "motivo");
    }
    case "tipo": {
      await responder(); await tirarBotoes(chatId, messageId);
      const t = partes[2] === "total" ? "total" : "parcial";
      if (t === "total") await db.from("solicitacao_itens").delete().eq("solicitacao_id", sol.id);
      const nova = await atualizarSol(sol.id, { tipo_devolucao: t });
      await enviar(chatId, `✔️ Tipo: <b>${t === "total" ? "nota inteira" : "parcial"}</b>`);
      return avancar(nova, "tipo");
    }
    case "itens_fim": {
      const n = (await itensDa(sol.id)).length;
      if (!n) return responder("Mande pelo menos 1 item antes.");
      await responder(); await tirarBotoes(chatId, messageId);
      return avancar(sol, "itens");
    }
    case "itens_desf": {
      const itens = await itensDa(sol.id);
      if (!itens.length) return responder("Não há itens para apagar.");
      const ultimo = itens[itens.length - 1];
      await db.from("solicitacao_itens").delete().eq("id", ultimo.id);
      await responder("Item apagado");
      await tirarBotoes(chatId, messageId);
      return enviar(chatId, `🗑️ Apagado: <i>${esc(ultimo.texto)}</i>\nMande o próximo item ou toque em Terminei.`, {
        reply_markup: teclado([[["✅ Terminei os itens", `itens_fim:${sol.id}`], ["↩️ Apagar o último", `itens_desf:${sol.id}`]]]),
      });
    }
    case "fotos_fim": {
      const m = await motivo(sol.motivo_codigo);
      const min = m?.min_fotos ?? 0;
      const qtd = await contarAnexos(sol.id, ["foto_produto"]);
      if (qtd < min) return responder(`Preciso de pelo menos ${min} foto(s). Você mandou ${qtd}.`);
      await responder(); await tirarBotoes(chatId, messageId);
      if (qtd) await enviar(chatId, `✔️ ${qtd} foto(s) recebida(s).`);
      return avancar(sol, "fotos");
    }
    case "can_nao": {
      await responder(); await tirarBotoes(chatId, messageId);
      const m = await motivo(sol.motivo_codigo);
      if (m?.exige_canhoto ?? true) return perguntar(await atualizarSol(sol.id, { etapa: "canhoto_justificativa" }));
      return avancar(sol, "canhoto");
    }
    case "obs_pular": {
      await responder(); await tirarBotoes(chatId, messageId);
      return avancar(sol, "observacoes");
    }
    case "env": {
      const faltas = await pendencias(sol);
      if (faltas.length) { await responder("Ainda falta informação"); return perguntar(sol); }
      if (!(await cfg("sac_grupo_id"))) return responder("O grupo do SAC ainda não foi configurado. Avise o SAC.");
      await responder(); await tirarBotoes(chatId, messageId);
      const nova = await mudarStatus(sol, "aguardando_sac",
        { etapa: null, enviado_sac_em: new Date().toISOString() }, "motorista", nomeMotorista);
      if (!nova) return enviar(chatId, "Não foi possível enviar. Tente de novo.");
      const ok = await publicarNoGrupo(nova);
      if (!ok) console.error(`[env] ${nova.protocolo}: falha ao publicar no grupo`);
      return enviar(chatId,
        `📨 <b>Enviado ao SAC!</b>\nProtocolo: <b>${esc(nova.protocolo)}</b>\n\nA resposta do SAC vai chegar aqui.`,
        { reply_markup: { remove_keyboard: true } });
    }
    case "corr": {
      await responder();
      if (!partes[2]) {
        await tirarBotoes(chatId, messageId);
        return enviar(chatId, "O que você quer corrigir?", {
          reply_markup: teclado([
            [["NF", `corr:${sol.id}:nf`], ["Cliente", `corr:${sol.id}:cliente`], ["Motivo", `corr:${sol.id}:motivo`]],
            [["Total/parcial e itens", `corr:${sol.id}:tipo`], ["Fotos", `corr:${sol.id}:fotos`]],
            [["Canhoto", `corr:${sol.id}:canhoto`], ["Localização", `corr:${sol.id}:localizacao`], ["Observações", `corr:${sol.id}:observacoes`]],
            [["↩️ Voltar ao resumo", `corr:${sol.id}:voltar`]],
          ]),
        });
      }
      await tirarBotoes(chatId, messageId);
      const campo = partes[2];
      const limpar: Record<string, Record<string, unknown>> = {
        nf: { nota_fiscal: null, nf_duplicada_de: null },
        cliente: { cliente_id: null, cliente_codigo: null, cliente_nome: null, cliente_cidade: null },
        motivo: {},
        tipo: { tipo_devolucao: null },
        fotos: {},
        canhoto: { canhoto_justificativa: null },
        localizacao: { latitude: null, longitude: null, localizacao_justificativa: null },
        observacoes: { observacoes: null },
        voltar: {},
      };
      if (!(campo in limpar)) return perguntar(sol);
      if (campo === "tipo") await db.from("solicitacao_itens").delete().eq("solicitacao_id", sol.id);
      if (campo === "fotos") await db.from("solicitacao_anexos").delete().eq("solicitacao_id", sol.id).eq("tipo", "foto_produto");
      if (campo === "canhoto") await db.from("solicitacao_anexos").delete().eq("solicitacao_id", sol.id).eq("tipo", "canhoto");
      if (campo === "observacoes") await db.from("solicitacao_anexos").delete().eq("solicitacao_id", sol.id).in("tipo", ["audio", "observacao"]);
      const nova = await atualizarSol(sol.id, { ...limpar[campo], etapa: campo === "voltar" ? "resumo" : campo, corrigindo: true });
      return perguntar(nova);
    }
  }
  return responder();
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
async function processar(update: any) {
  if (update.callback_query) return tratarCallback(update.callback_query);

  if (update.my_chat_member) {
    const c = update.my_chat_member.chat;
    const novo = update.my_chat_member.new_chat_member?.status;
    if (c.type !== "private" && (novo === "member" || novo === "administrator")) {
      const grupo = await cfg("sac_grupo_id");
      if (grupo && grupo !== String(c.id)) return tg("leaveChat", { chat_id: c.id });
      if (!grupo) return enviar(c.id, "👋 Para usar este grupo como o <b>grupo do SAC</b>, digite /registrar_grupo");
    }
    return;
  }

  const msg = update.message;
  if (!msg || msg.from?.is_bot) return;
  if (msg.chat.type === "private") return tratarPrivado(msg);
  if (msg.chat.type === "group" || msg.chat.type === "supergroup") return tratarGrupo(msg);
}

function chatDoUpdate(u: any): number | null {
  return u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? u.my_chat_member?.chat?.id ?? null;
}

async function configurarWebhook() {
  if (!TOKEN) return { ok: false, erro: "Segredo TELEGRAM_BOT_TOKEN não cadastrado no projeto." };
  const url = `${SUPABASE_URL}/functions/v1/telegram-bot`;
  const r = await tg("setWebhook", {
    url, secret_token: await segredoWebhook(),
    allowed_updates: ["message", "callback_query", "my_chat_member"],
    drop_pending_updates: true, max_connections: 10,
  });
  // Menus de comandos: um para a conversa com o motorista, outro para grupos.
  // Tocando no menu do grupo o Telegram ja escreve "/comando@bot", que o bot
  // recebe mesmo com o modo de privacidade ligado.
  await tg("setMyCommands", {
    scope: { type: "all_private_chats" },
    commands: [
      { command: "nova", description: "Abrir nova solicitação de devolução" },
      { command: "status", description: "Ver minhas solicitações" },
      { command: "cancelar", description: "Cancelar a solicitação em andamento" },
      { command: "ajuda", description: "Como usar o bot" },
    ],
  });
  await tg("setMyCommands", {
    scope: { type: "all_group_chats" },
    commands: [
      { command: "vincular", description: "Gerar link de acesso de um motorista" },
      { command: "desvincular", description: "Encerrar o acesso de um motorista" },
      { command: "pendentes", description: "Solicitações aguardando o SAC" },
      { command: "registrar_grupo", description: "Registrar este grupo como grupo do SAC" },
      { command: "ajuda", description: "Comandos do SAC" },
    ],
  });
  const info = await tg("getWebhookInfo", {});
  return {
    ok: !!r.ok,
    mensagem: r.ok ? "Webhook registrado. O bot já está respondendo." : r.description,
    bot: "@" + (await botUsername()),
    webhook_url: info?.result?.url,
  };
}

async function statusWebhook() {
  if (!TOKEN) return { ok: false, erro: "Segredo TELEGRAM_BOT_TOKEN não cadastrado no projeto." };
  const info = await tg("getWebhookInfo", {});
  const w = info?.result ?? {};
  return {
    ok: !!info.ok,
    bot: "@" + (await botUsername()),
    webhook_url: w.url,
    mensagens_na_fila: w.pending_update_count,
    ultimo_erro: w.last_error_message ?? null,
    ultimo_erro_em: w.last_error_date ? fmtData(new Date(w.last_error_date * 1000)) : null,
    grupo_sac_configurado: !!(await cfg("sac_grupo_id")),
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const acao = url.searchParams.get("acao");
    if (acao === "setup") return json(await configurarWebhook());
    if (acao === "status") return json(await statusWebhook());
    return json({ ok: true, info: "Bot de devoluções JR. Use ?acao=setup ou ?acao=status" });
  }
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  if (!TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await segredoWebhook())) {
    return new Response("Não autorizado", { status: 401 });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response("JSON inválido", { status: 400 }); }

  // Mesma mensagem duas vezes (reenvio do Telegram)? Ignora.
  const { error: errDup } = await db.from("telegram_updates").insert({
    update_id: update.update_id, chat_id: chatDoUpdate(update),
    tipo: Object.keys(update).find((k) => k !== "update_id") ?? null, payload: update,
  });
  if (errDup) {
    if (errDup.code !== "23505") console.error(`[telegram_updates] ${errDup.message}`);
    return new Response("ok");
  }

  try {
    await processar(update);
    await db.from("telegram_updates").update({ processado_em: new Date().toISOString() }).eq("update_id", update.update_id);
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error(`[processar] update ${update.update_id}: ${erro}`);
    await db.from("telegram_updates").update({ erro }).eq("update_id", update.update_id);
    const chat = chatDoUpdate(update);
    if (chat && update.message?.chat?.type === "private") {
      await enviar(chat, "⚠️ Tive um problema para processar sua mensagem. Tente de novo em 1 minuto.").catch(() => {});
    }
  }
  // Sempre 200: devolver erro faria o Telegram reenviar a mesma mensagem sem parar.
  return new Response("ok");
});
