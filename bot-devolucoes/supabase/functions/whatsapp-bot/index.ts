// deno-lint-ignore-file no-explicit-any
// =============================================================================
// BOT DE DEVOLUCOES NO WHATSAPP - JR DISTRIBUIDORA (sem IA)
//
// Coexistencia via Dualhook: o SAC continua no app WhatsApp Business e o bot
// usa o mesmo numero pela Cloud API. A Meta entrega as mensagens direto aqui
// (Webhook Override); as respostas saem pela Runtime API do Dualhook.
//
// Comportamento
//   - O bot so entra na conversa quando o motorista pede ("devolucao").
//     Qualquer outra conversa fica com o SAC e NAO e gravada.
//   - Primeiro uso de um numero: o motorista escolhe o proprio nome na lista.
//   - Perguntas fixas (mesma ordem do bot do Telegram); no fim, resumo e envio.
//   - O SAC responde no proprio app, na conversa do motorista:
//       DEV 149              -> ocorrencia aberta (grava o numero da DEV)
//       #reprovar <motivo>   -> reprovada
//       #complemento <texto> -> pede complemento ao motorista
//       #desvincular         -> desfaz o vinculo deste numero com o motorista
//     (chegam aqui pelo webhook smb_message_echoes)
//
// Rotas
//   GET  ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...  verificacao da Meta
//   POST ?k=<wa_webhook_chave>                                       webhook (Meta)
//   GET  ?acao=status&k=<wa_webhook_chave>                           situacao (simulacao ou real)
//
// Segredo: DUALHOOK_KEY (dh_live_...). Sem ele = MODO SIMULACAO: nada e
// enviado, as respostas vao para a tabela whatsapp_saida_simulada.
// Deploy com verify_jwt = false (quem chama e a Meta); a protecao e a chave
// na URL + a conferencia do WABA e do phone_number_id.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const DH_KEY = Deno.env.get("DUALHOOK_KEY") ?? "";
const DH = "https://api.dualhook.com/v25.0";
const SIMULACAO = !DH_KEY;
const BUCKET = "devolucoes-telegram";
const HORAS_ABANDONO = 24;
const ESPERA_ALBUM_MS = 3500;

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
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const corta = (s: unknown, n: number) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// DDD + 8 ultimos digitos: casa o numero com e sem o 9 (a Meta as vezes manda sem)
function chaveTelefone(waId: string): string {
  const d = String(waId ?? "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    let num = d.slice(4);
    if (num.length === 9 && num.startsWith("9")) num = num.slice(1);
    return ddd + num;
  }
  return d;
}

async function cfg(chave: string): Promise<string | null> {
  const { data } = await db.from("bot_config").select("valor").eq("chave", chave).maybeSingle();
  return data?.valor ?? null;
}

// ---------------------------------------------------------------------------
// Envio (Dualhook Runtime API ou simulacao)
// ---------------------------------------------------------------------------
async function enviarWA(para: string, msg: Record<string, unknown>): Promise<any> {
  const corpo = { messaging_product: "whatsapp", recipient_type: "individual", to: para, ...msg };
  if (SIMULACAO) {
    await db.from("whatsapp_saida_simulada").insert({ para, corpo });
    return { simulado: true };
  }
  const phoneId = await cfg("wa_phone_number_id");
  const r = await fetch(`${DH}/${phoneId}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${DH_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.error(`[envio] ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

const texto = (para: string, body: string) =>
  enviarWA(para, { type: "text", text: { body: corta(body, 4096), preview_url: false } });

// ate 3 botoes; titulo ate 20 caracteres
const botoes = (para: string, body: string, lista: [string, string][]) =>
  enviarWA(para, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: corta(body, 1024) },
      action: { buttons: lista.slice(0, 3).map(([id, t]) => ({ type: "reply", reply: { id, title: corta(t, 20) } })) },
    },
  });

// ate 10 linhas; titulo ate 24, descricao ate 72
const listaOpcoes = (para: string, body: string, botao: string, linhas: { id: string; title: string; description?: string }[]) =>
  enviarWA(para, {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: corta(body, 1024) },
      action: {
        button: corta(botao, 20),
        sections: [{
          title: "Opções",
          rows: linhas.slice(0, 10).map((l) => ({
            id: l.id, title: corta(l.title, 24), ...(l.description ? { description: corta(l.description, 72) } : {}),
          })),
        }],
      },
    },
  });

const pedirLocalizacao = (para: string, body: string) =>
  enviarWA(para, {
    type: "interactive",
    interactive: { type: "location_request_message", body: { text: corta(body, 1024) }, action: { name: "send_location" } },
  });

// ---------------------------------------------------------------------------
// Banco
// ---------------------------------------------------------------------------
async function vinculoDo(waId: string) {
  const { data } = await db.from("motoristas_whatsapp").select("*, motoristas(nome, ativo, is_deleted)")
    .eq("telefone_chave", chaveTelefone(waId)).eq("ativo", true).maybeSingle();
  if (!data || data.motoristas?.is_deleted || data.motoristas?.ativo === false) return null;
  return data;
}

async function carregarSol(id: number) {
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
    .update({ ...campos, ultima_interacao_em: new Date().toISOString() }).eq("id", id).select("*").single();
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
  const { data } = await db.from("solicitacao_itens").select("id, texto").eq("solicitacao_id", solId).order("id");
  return data ?? [];
}

async function historico(solId: number, de: string | null, para: string | null,
                         autorTipo: string, autorNome: string, comentario: string | null) {
  await db.from("solicitacao_historico").insert({
    solicitacao_id: solId, status_anterior: de, status_novo: para,
    autor_tipo: autorTipo, autor_nome: autorNome, comentario,
  });
}

async function mudarStatus(sol: any, novo: string, campos: Record<string, unknown>,
                           autorTipo: string, autorNome: string, comentario: string | null) {
  const nova = await atualizarSol(sol.id, { ...campos, status: novo });
  await historico(sol.id, sol.status, novo, autorTipo, autorNome, comentario);
  return nova;
}

// Baixa a midia pelo Dualhook e guarda no bucket privado
async function salvarAnexo(sol: any, msg: any, tipo: string) {
  const midiaWa = msg.image ?? msg.document ?? msg.audio ?? msg.video;
  const midia = msg.type === "image" ? "photo" : msg.type === "audio" ? (msg.audio?.voice ? "voice" : "audio") : msg.type;
  const { data: anexo, error } = await db.from("solicitacao_anexos").insert({
    solicitacao_id: sol.id, tipo, midia, whatsapp_media_id: midiaWa?.id ?? null,
    mime_type: midiaWa?.mime_type ?? null,
  }).select("id").single();
  if (error) throw new Error(`salvarAnexo: ${error.message}`);
  if (SIMULACAO || !midiaWa?.id) return anexo.id;
  try {
    const r = await fetch(`${DH}/${midiaWa.id}/content`, { headers: { authorization: `Bearer ${DH_KEY}` } });
    if (!r.ok) throw new Error(`download ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const mime = midiaWa.mime_type ?? r.headers.get("content-type") ?? "application/octet-stream";
    const ext = (mime.split("/")[1] ?? "bin").split(";")[0].replace("jpeg", "jpg");
    const caminho = `whatsapp/${sol.id}/${tipo}-${anexo.id}.${ext}`;
    const up = await db.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: false });
    if (up.error) throw new Error(up.error.message);
    await db.from("solicitacao_anexos").update({ storage_path: caminho, tamanho_bytes: bytes.length }).eq("id", anexo.id);
  } catch (e) {
    console.error(`[midia] ${(e as Error).message}`); // fica so o media_id; o SAC ve a foto na conversa
  }
  return anexo.id;
}

// ---------------------------------------------------------------------------
// Fluxo de perguntas
// ---------------------------------------------------------------------------
const ORDEM = ["nf", "cliente", "motivo", "tipo", "itens", "fotos", "canhoto", "localizacao", "observacoes", "resumo"];

async function pendencias(sol: any) {
  const m = await motivo(sol.motivo_codigo);
  const faltas: { etapa: string; texto: string }[] = [];
  if (!sol.nota_fiscal) faltas.push({ etapa: "nf", texto: "número da nota fiscal" });
  if (!sol.cliente_id && !sol.cliente_nome) faltas.push({ etapa: "cliente", texto: "cliente" });
  if (!sol.motivo_codigo) faltas.push({ etapa: "motivo", texto: "motivo" });
  if (!sol.tipo_devolucao) faltas.push({ etapa: "tipo", texto: "se é total ou parcial" });
  if (sol.tipo_devolucao === "parcial" && (await itensDa(sol.id)).length === 0) {
    faltas.push({ etapa: "itens", texto: "itens devolvidos" });
  }
  const min = m?.min_fotos ?? 0;
  if (min > 0 && (await contarAnexos(sol.id, ["foto_produto"])) < min) {
    faltas.push({ etapa: "fotos", texto: `pelo menos ${min} foto(s)` });
  }
  if ((m?.exige_canhoto ?? true) && !sol.canhoto_justificativa && (await contarAnexos(sol.id, ["canhoto"])) === 0) {
    faltas.push({ etapa: "canhoto", texto: "foto do canhoto" });
  }
  if ((m?.exige_localizacao ?? true) && sol.latitude == null && !sol.localizacao_justificativa) {
    faltas.push({ etapa: "localizacao", texto: "localização" });
  }
  return faltas;
}

function proximaEtapa(atual: string, sol: any): string {
  if (sol.corrigindo) return atual === "tipo" && sol.tipo_devolucao === "parcial" ? "itens" : "resumo";
  const atalhos: Record<string, string> = {
    cliente_manual: "motivo", canhoto_justificativa: "localizacao", localizacao_justificativa: "observacoes",
  };
  if (atalhos[atual]) return atalhos[atual];
  let i = ORDEM.indexOf(atual) + 1;
  if (ORDEM[i] === "itens" && sol.tipo_devolucao !== "parcial") i++;
  return ORDEM[i] ?? "resumo";
}

async function avancar(sol: any, atual: string) {
  const nova = await atualizarSol(sol.id, { etapa: proximaEtapa(atual, sol) });
  return perguntar(nova);
}

async function perguntar(sol: any): Promise<unknown> {
  const wa = sol.wa_id;
  const id = sol.id;
  switch (sol.etapa) {
    case "nf":
      return texto(wa, "🧾 Qual o *número da nota fiscal*?\n_Só os números. Ex.: 1320080_");
    case "cliente":
      return texto(wa, "🏪 Qual o *cliente*?\n_Digite o código ou parte do nome. Ex.: AURORA_");
    case "cliente_manual":
      return texto(wa, "✍️ Digite o *nome do cliente* como está na nota:");
    case "motivo": {
      const { data } = await db.from("motivos_devolucao").select("codigo, nome")
        .eq("ativo", true).eq("visivel_motorista", true).order("ordem").limit(10);
      return listaOpcoes(wa, "❓ Qual o *motivo* da devolução?", "Escolher motivo",
        (data ?? []).map((m: any) => ({ id: `mot:${id}:${m.codigo}`, title: m.nome, description: m.nome.length > 24 ? m.nome : undefined })));
    }
    case "tipo":
      return botoes(wa, "📦 A devolução é da *nota inteira* ou *só de uma parte*?",
        [[`tipo:${id}:total`, "Nota inteira"], [`tipo:${id}:parcial`, "Só uma parte"]]);
    case "itens": {
      const itens = await itensDa(id);
      const corpo = "📝 Quais *itens* voltaram?\nMande *um item por mensagem*, com a quantidade.\n_Ex.: FRANGO INTEIRO 12 CX_" +
        (itens.length ? `\n\nJá anotados: ${itens.length}` : "");
      return itens.length
        ? botoes(wa, corpo, [[`itens_fim:${id}`, "✅ Terminei"], [`itens_desf:${id}`, "↩️ Apagar último"]])
        : texto(wa, corpo);
    }
    case "fotos": {
      const m = await motivo(sol.motivo_codigo);
      const min = m?.min_fotos ?? 0;
      const qtd = await contarAnexos(id, ["foto_produto"]);
      const orient = m?.orientacao_fotos ? ` ${m.orientacao_fotos}` : "";
      const corpo = `📷 Mande as *fotos*${orient}.` +
        (min > 0 ? `\nMínimo: *${min}*.` : "\n_Fotos são opcionais para este motivo._") +
        (qtd ? `\nRecebidas até agora: ${qtd}` : "");
      return botoes(wa, corpo, [[`fotos_fim:${id}`, min === 0 && qtd === 0 ? "Não tenho fotos" : "✅ Terminei"]]);
    }
    case "canhoto": {
      const m = await motivo(sol.motivo_codigo);
      return botoes(wa, "🧾 Mande uma *foto do canhoto* (ou da nota) assinado.",
        [[`can_nao:${id}`, (m?.exige_canhoto ?? true) ? "Não tenho canhoto" : "Pular"]]);
    }
    case "canhoto_justificativa":
      return texto(wa, "✍️ Por que não tem o canhoto? Escreva em poucas palavras.");
    case "localizacao":
      await pedirLocalizacao(wa, "📍 Toque em *Enviar localização* para mandar onde você está.");
      return botoes(wa, "Se não conseguir, toque aqui:", [[`loc_nao:${id}`, "Não consigo"]]);
    case "localizacao_justificativa":
      return texto(wa, "✍️ Por que não conseguiu enviar a localização? Escreva em poucas palavras.");
    case "observacoes":
      return botoes(wa, "💬 Alguma *observação*? Escreva ou mande um *áudio*.", [[`obs_pular:${id}`, "Pular"]]);
    case "resumo": {
      const faltas = await pendencias(sol);
      if (faltas.length) {
        await texto(wa, `⚠️ Ainda falta: *${faltas[0].texto}*.`);
        return perguntar(await atualizarSol(id, { etapa: faltas[0].etapa, corrigindo: true }));
      }
      await texto(wa, await montarResumo(sol));
      return botoes(wa, "*Está tudo certo?*",
        [[`env:${id}`, "✅ Enviar ao SAC"], [`corr:${id}`, "✏️ Corrigir"], [`canc:${id}`, "❌ Cancelar"]]);
    }
  }
}

async function montarResumo(sol: any, aviso = ""): Promise<string> {
  const m = await motivo(sol.motivo_codigo);
  const itens = await itensDa(sol.id);
  const nFotos = await contarAnexos(sol.id, ["foto_produto"]);
  const nCanhoto = await contarAnexos(sol.id, ["canhoto"]);
  const nAudio = await contarAnexos(sol.id, ["audio"]);
  const cliente = sol.cliente_id
    ? `${sol.cliente_codigo} - ${sol.cliente_nome}${sol.cliente_cidade ? ` (${sol.cliente_cidade})` : ""}`
    : `${sol.cliente_nome} _(digitado, não achado no cadastro)_`;
  const l = [
    `📦 *SOLICITAÇÃO ${sol.protocolo}*`,
    `👤 Motorista: *${sol.motorista_nome}*`,
    `🧾 NF: *${sol.nota_fiscal}*` + (sol.nf_duplicada_de ? `  ⚠️ _mesma NF da ${sol.nf_duplicada_de}_` : ""),
    `🏪 Cliente: ${cliente}`,
    `❓ Motivo: *${m?.nome ?? sol.motivo_codigo}*`,
    `📦 Tipo: *${sol.tipo_devolucao === "total" ? "TOTAL (nota inteira)" : "PARCIAL"}*`,
  ];
  if (itens.length) l.push("📝 Itens:\n" + itens.map((i: any) => `   • ${i.texto}`).join("\n"));
  l.push(`📷 Fotos: ${nFotos}   |   🧾 Canhoto: ${nCanhoto ? "sim" : `não (${sol.canhoto_justificativa ?? "-"})`}`);
  l.push(sol.latitude != null ? "📍 Localização: enviada" : `📍 Localização: não enviada (${sol.localizacao_justificativa ?? "-"})`);
  if (sol.observacoes) l.push(`💬 Observações: ${sol.observacoes}`);
  if (nAudio) l.push(`🎤 Áudio: ${nAudio}`);
  if (aviso) l.push(aviso);
  return l.join("\n");
}

// ---------------------------------------------------------------------------
// Mensagens do motorista
// ---------------------------------------------------------------------------
const PALAVRA_GATILHO = (t: string) => {
  const s = semAcento(t);
  return s.split(/\s+/).length <= 4 && /devolu|devolver/.test(s);
};

// O que o motorista "disse": texto, id do botao/lista ou tipo de midia
function lerMensagem(msg: any) {
  const botao = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id ?? null;
  const txt = (msg.text?.body ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "").trim();
  return { botao: botao as string | null, txt: txt as string, tipo: msg.type as string };
}

async function tratarMotorista(msg: any, waId: string, nomePerfil: string) {
  const { botao, txt } = lerMensagem(msg);
  const vinc = await vinculoDo(waId);

  // --- numero ainda sem vinculo
  if (!vinc) {
    const chave = chaveTelefone(waId);
    const { data: cad } = await db.from("whatsapp_cadastro").select("*").eq("telefone_chave", chave).maybeSingle();
    const cadValido = cad && Date.now() - new Date(cad.criado_em).getTime() < HORAS_ABANDONO * 3600e3;
    if (botao?.startsWith("cad:")) {
      if (!cadValido) return;
      return concluirCadastro(waId, nomePerfil, botao.split(":")[1]);
    }
    if (cadValido) return buscarNomeCadastro(waId, txt);
    if (!PALAVRA_GATILHO(txt)) return; // conversa normal com o SAC: o bot nao se mete
    await db.from("whatsapp_cadastro").upsert({ telefone_chave: chave, wa_id: waId, etapa: "nome", criado_em: new Date().toISOString() });
    return texto(waId,
      "👋 Olá! Sou o assistente de devoluções da *JR Distribuidora*.\n" +
      "Este número ainda não está cadastrado. Digite o seu *nome* (como está no cadastro de motoristas):");
  }

  const nomeMot = vinc.motoristas?.nome ?? "motorista";
  if (vinc.wa_id !== waId) await db.from("motoristas_whatsapp").update({ wa_id: waId }).eq("id", vinc.id);

  // --- complemento pedido pelo SAC
  if (vinc.solicitacao_ativa_id) {
    const alvo = await carregarSol(vinc.solicitacao_ativa_id);
    if (alvo?.status === "pendente_complemento") return tratarComplemento(alvo, msg, vinc, nomeMot);
    await db.from("motoristas_whatsapp").update({ solicitacao_ativa_id: null }).eq("id", vinc.id);
  }

  // --- botoes que valem fora do preenchimento
  if (botao?.startsWith("cont:") || botao?.startsWith("desc:")) {
    const sol = await carregarSol(Number(botao.split(":")[1]));
    if (!sol || sol.status !== "em_coleta" || sol.motorista_id !== vinc.motorista_id) return;
    if (botao.startsWith("cont:")) return perguntar(sol);
    await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMot, "descartada para abrir outra");
    return novaSolicitacao(vinc, nomeMot, waId);
  }

  const sol = await solEmColeta(vinc.motorista_id);
  if (!sol) {
    if (PALAVRA_GATILHO(txt)) return novaSolicitacao(vinc, nomeMot, waId);
    return; // conversa normal com o SAC
  }
  if (semAcento(txt) === "cancelar") {
    await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMot, "cancelada pelo motorista");
    return texto(waId, `🚫 A solicitação *${sol.protocolo}* foi cancelada.`);
  }
  if (sol.wa_id !== waId) await atualizarSol(sol.id, { wa_id: waId });
  if (botao) return tratarBotao({ ...sol, wa_id: waId }, botao, nomeMot, vinc);
  return tratarEtapa({ ...sol, wa_id: waId }, msg);
}

async function buscarNomeCadastro(waId: string, txt: string) {
  if (txt.length < 3) return texto(waId, "Digite pelo menos *3 letras* do seu nome.");
  const { data, error } = await db.rpc("bot_buscar_motoristas", { p_termo: txt, p_limite: 9 });
  if (error) throw new Error(`bot_buscar_motoristas: ${error.message}`);
  if (!data?.length) return texto(waId, `Não encontrei motorista com "${txt}". Tente só o primeiro nome ou o sobrenome.`);
  return listaOpcoes(waId, "Qual destes é você? 👇", "Escolher nome",
    [...data.map((m: any) => ({ id: `cad:${m.id}`, title: m.nome, description: m.nome.length > 24 ? m.nome : undefined })),
     { id: "cad:nenhum", title: "Não sou nenhum destes" }]);
}

async function concluirCadastro(waId: string, nomePerfil: string, escolha: string) {
  if (escolha === "nenhum") {
    return texto(waId, "Tudo bem. Digite o seu nome de novo (ou parte dele). Se não aparecer, fale com o SAC aqui mesmo.");
  }
  const { data: mot } = await db.from("motoristas").select("id, nome, ativo, is_deleted").eq("id", Number(escolha)).maybeSingle();
  if (!mot || mot.is_deleted || mot.ativo === false) return texto(waId, "Esse cadastro não está ativo. Fale com o SAC.");
  const chave = chaveTelefone(waId);
  const { error } = await db.from("motoristas_whatsapp").insert({
    motorista_id: mot.id, wa_id: waId, telefone_chave: chave, nome_perfil: nomePerfil || null,
  });
  if (error) throw new Error(`concluirCadastro: ${error.message}`);
  await db.from("whatsapp_cadastro").delete().eq("telefone_chave", chave);
  await texto(waId, `✔️ Pronto, *${mot.nome}*! Este número ficou ligado ao seu cadastro.`);
  const vinc = await vinculoDo(waId);
  return novaSolicitacao(vinc, mot.nome, waId);
}

async function novaSolicitacao(vinc: any, nomeMot: string, waId: string) {
  const existente = await solEmColeta(vinc.motorista_id);
  if (existente) {
    const parada = Date.now() - new Date(existente.ultima_interacao_em).getTime() > HORAS_ABANDONO * 3600e3;
    if (!parada) {
      return botoes(waId, `Você já tem a *${existente.protocolo}* em preenchimento.`,
        [[`cont:${existente.id}`, "Continuar essa"], [`desc:${existente.id}`, "Começar outra"]]);
    }
    await mudarStatus(existente, "cancelada", { etapa: null }, "sistema", "bot", `sem resposta por mais de ${HORAS_ABANDONO} h`);
  }
  const { data: sol, error } = await db.from("solicitacoes_devolucao").insert({
    origem: "whatsapp", motorista_id: vinc.motorista_id, motorista_nome: nomeMot, wa_id: waId,
    telefone_motorista: waId, etapa: "nf",
  }).select("*").single();
  if (error) throw new Error(`novaSolicitacao: ${error.message}`);
  await historico(sol.id, null, "em_coleta", "motorista", nomeMot, "aberta pelo WhatsApp");
  await texto(waId, `📦 Nova devolução *${sol.protocolo}*\n_Para desistir a qualquer momento, escreva: cancelar_`);
  return perguntar(sol);
}

async function tratarEtapa(sol: any, msg: any) {
  const wa = sol.wa_id;
  const { txt, tipo } = lerMensagem(msg);

  if (tipo === "location") {
    await atualizarSol(sol.id, { latitude: msg.location.latitude, longitude: msg.location.longitude, localizacao_justificativa: null });
    await texto(wa, "📍 Localização recebida.");
    const atual = await carregarSol(sol.id);
    return sol.etapa === "localizacao" || sol.etapa === "localizacao_justificativa"
      ? avancar(atual, "localizacao") : perguntar(atual);
  }

  switch (sol.etapa) {
    case "nf": {
      const nf = txt.replace(/\D/g, "");
      if (nf.length < 3 || nf.length > 10) return texto(wa, "Não entendi. Mande *só os números* da nota. Ex.: 1320080");
      const { data: dup } = await db.from("solicitacoes_devolucao").select("protocolo")
        .eq("nota_fiscal", nf).neq("id", sol.id).not("status", "in", "(cancelada,reprovada)").limit(1);
      const nfDup = dup?.[0]?.protocolo ?? null;
      const nova = await atualizarSol(sol.id, { nota_fiscal: nf, nf_duplicada_de: nfDup });
      await texto(wa, `✔️ NF *${nf}* anotada.` + (nfDup ? `\n⚠️ Já existe a ${nfDup} com esta NF. Pode seguir; o SAC vai ver as duas.` : ""));
      return avancar(nova, "nf");
    }
    case "cliente": {
      if (txt.length < 3) return texto(wa, "Digite pelo menos *3 letras* do nome ou o *código* do cliente.");
      const { data: achados, error } = await db.rpc("bot_buscar_clientes", { p_termo: txt, p_limite: 9 });
      if (error) throw new Error(`bot_buscar_clientes: ${error.message}`);
      if (!achados?.length) {
        return botoes(wa, `Não encontrei cliente com "${txt}".\nTente outra parte do nome ou o código.`,
          [[`cli:${sol.id}:manual`, "Digitar o nome"]]);
      }
      return listaOpcoes(wa, "Qual destes? 👇\n_Se não estiver, digite outra parte do nome._", "Escolher cliente",
        [...achados.map((c: any) => ({
          id: `cli:${sol.id}:${c.id}`, title: c.razao_social,
          description: `Cód. ${c.codigo_cliente}${c.cidade ? " · " + c.cidade : ""}${c.razao_social.length > 24 ? " · " + c.razao_social : ""}`,
        })), { id: `cli:${sol.id}:manual`, title: "Não está na lista" }]);
    }
    case "cliente_manual": {
      if (txt.length < 3) return texto(wa, "Digite o nome do cliente (pelo menos 3 letras).");
      const nova = await atualizarSol(sol.id, { cliente_id: null, cliente_codigo: null, cliente_cidade: null, cliente_nome: txt.toUpperCase() });
      await texto(wa, `✔️ Cliente: *${txt.toUpperCase()}*`);
      return avancar(nova, "cliente_manual");
    }
    case "itens": {
      if (!txt) return texto(wa, "Mande o item *escrito*, com a quantidade. Ex.: FRANGO INTEIRO 12 CX");
      await db.from("solicitacao_itens").insert({ solicitacao_id: sol.id, texto: txt.toUpperCase() });
      await atualizarSol(sol.id, {});
      const n = (await itensDa(sol.id)).length;
      return botoes(wa, `✔️ Item ${n}: _${txt.toUpperCase()}_\nMande o próximo ou toque em *Terminei*.`,
        [[`itens_fim:${sol.id}`, "✅ Terminei"], [`itens_desf:${sol.id}`, "↩️ Apagar último"]]);
    }
    case "fotos":
    case "canhoto": {
      if (tipo !== "image") {
        if (sol.etapa === "fotos") {
          return botoes(wa, "Estou esperando *fotos* 📷. Se já mandou todas, toque em *Terminei*.", [[`fotos_fim:${sol.id}`, "✅ Terminei"]]);
        }
        return perguntar(sol);
      }
      const tipoAnexo = sol.etapa === "fotos" ? "foto_produto" : "canhoto";
      const anexoId = await salvarAnexo(sol, msg, tipoAnexo);
      await atualizarSol(sol.id, tipoAnexo === "canhoto" ? { canhoto_justificativa: null } : {});
      // Varias fotos chegam juntas: responde so depois da ultima
      await dormir(ESPERA_ALBUM_MS);
      const { data: ultimo } = await db.from("solicitacao_anexos").select("id")
        .eq("solicitacao_id", sol.id).eq("tipo", tipoAnexo).order("id", { ascending: false }).limit(1).maybeSingle();
      if (ultimo && ultimo.id !== anexoId) return;
      const atual = await carregarSol(sol.id);
      if (atual?.etapa !== sol.etapa) return;
      if (tipoAnexo === "canhoto") {
        await texto(wa, "✔️ Canhoto recebido.");
        return avancar(atual, "canhoto");
      }
      const qtd = await contarAnexos(sol.id, ["foto_produto"]);
      return botoes(wa, `📷 ${qtd} foto(s) recebida(s). Pode mandar mais ou tocar em *Terminei*.`, [[`fotos_fim:${sol.id}`, "✅ Terminei"]]);
    }
    case "canhoto_justificativa": {
      if (txt.length < 3) return perguntar(sol);
      return avancar(await atualizarSol(sol.id, { canhoto_justificativa: txt.toUpperCase() }), "canhoto_justificativa");
    }
    case "localizacao":
      return perguntar(sol);
    case "localizacao_justificativa": {
      if (txt.length < 3) return perguntar(sol);
      return avancar(await atualizarSol(sol.id, { localizacao_justificativa: txt.toUpperCase() }), "localizacao_justificativa");
    }
    case "observacoes": {
      if (tipo === "audio") {
        await salvarAnexo(sol, msg, "audio");
        await texto(wa, "🎤 Áudio recebido.");
        return avancar(sol, "observacoes");
      }
      if (tipo === "image") {
        await salvarAnexo(sol, msg, "observacao");
        await texto(wa, "📷 Imagem guardada junto das observações.");
        return avancar(sol, "observacoes");
      }
      if (!txt) return perguntar(sol);
      const obs = sol.observacoes ? `${sol.observacoes} ${txt.toUpperCase()}` : txt.toUpperCase();
      return avancar(await atualizarSol(sol.id, { observacoes: obs }), "observacoes");
    }
    default:
      await texto(wa, "Toque em uma das *opções* 👇");
      return perguntar(sol);
  }
}

async function tratarBotao(sol: any, botao: string, nomeMot: string, vinc: any) {
  const [acao, idTxt, valor] = botao.split(":");
  if (Number(idTxt) !== sol.id) return texto(sol.wa_id, "Essa opção é de uma solicitação antiga. Use as opções da mensagem mais recente.");
  const wa = sol.wa_id;
  switch (acao) {
    case "cli": {
      if (valor === "manual") return perguntar(await atualizarSol(sol.id, { etapa: "cliente_manual" }));
      const { data: c } = await db.from("clientes").select("id, codigo_cliente, razao_social, cidade").eq("id", Number(valor)).maybeSingle();
      if (!c) return perguntar(sol);
      const nova = await atualizarSol(sol.id, { cliente_id: c.id, cliente_codigo: c.codigo_cliente, cliente_nome: c.razao_social, cliente_cidade: c.cidade });
      await texto(wa, `✔️ Cliente: *${c.codigo_cliente} - ${c.razao_social}*`);
      return avancar(nova, "cliente");
    }
    case "mot": {
      const m = await motivo(valor);
      if (!m) return perguntar(sol);
      const nova = await atualizarSol(sol.id, { motivo_codigo: m.codigo });
      await texto(wa, `✔️ Motivo: *${m.nome}*`);
      return avancar(nova, "motivo");
    }
    case "tipo": {
      if (valor !== "total" && valor !== "parcial") return perguntar(sol);
      if (valor === "total") await db.from("solicitacao_itens").delete().eq("solicitacao_id", sol.id);
      const nova = await atualizarSol(sol.id, { tipo_devolucao: valor });
      return avancar(nova, "tipo");
    }
    case "itens_fim": {
      if (!(await itensDa(sol.id)).length) return perguntar(sol);
      return avancar(sol, "itens");
    }
    case "itens_desf": {
      const itens = await itensDa(sol.id);
      if (itens.length) await db.from("solicitacao_itens").delete().eq("id", itens[itens.length - 1].id);
      return perguntar(await atualizarSol(sol.id, {}));
    }
    case "fotos_fim":
      return avancar(sol, "fotos");
    case "can_nao": {
      const m = await motivo(sol.motivo_codigo);
      if (m?.exige_canhoto ?? true) return perguntar(await atualizarSol(sol.id, { etapa: "canhoto_justificativa" }));
      return avancar(sol, "canhoto");
    }
    case "loc_nao": {
      const m = await motivo(sol.motivo_codigo);
      if (m?.exige_localizacao ?? true) return perguntar(await atualizarSol(sol.id, { etapa: "localizacao_justificativa" }));
      return avancar(sol, "localizacao");
    }
    case "obs_pular":
      return avancar(sol, "observacoes");
    case "canc":
      await mudarStatus(sol, "cancelada", { etapa: null }, "motorista", nomeMot, "cancelada pelo motorista");
      return texto(wa, `🚫 A solicitação *${sol.protocolo}* foi cancelada.`);
    case "corr":
      return listaOpcoes(wa, "O que você quer corrigir?", "Escolher", [
        { id: `fix:${sol.id}:nf`, title: "Nota fiscal" },
        { id: `fix:${sol.id}:cliente`, title: "Cliente" },
        { id: `fix:${sol.id}:motivo`, title: "Motivo" },
        { id: `fix:${sol.id}:tipo`, title: "Total ou parcial" },
        { id: `fix:${sol.id}:itens`, title: "Itens", description: "apaga os itens e anota de novo" },
        { id: `fix:${sol.id}:fotos`, title: "Fotos", description: "apaga as fotos e manda de novo" },
        { id: `fix:${sol.id}:canhoto`, title: "Canhoto" },
        { id: `fix:${sol.id}:localizacao`, title: "Localização" },
        { id: `fix:${sol.id}:observacoes`, title: "Observações", description: "apaga e escreve de novo" },
      ]);
    case "fix": {
      const campos: Record<string, unknown> = { etapa: valor, corrigindo: true };
      if (valor === "itens") await db.from("solicitacao_itens").delete().eq("solicitacao_id", sol.id);
      if (valor === "fotos") await db.from("solicitacao_anexos").delete().eq("solicitacao_id", sol.id).eq("tipo", "foto_produto");
      if (valor === "canhoto") { await db.from("solicitacao_anexos").delete().eq("solicitacao_id", sol.id).eq("tipo", "canhoto"); campos.canhoto_justificativa = null; }
      if (valor === "localizacao") Object.assign(campos, { latitude: null, longitude: null, localizacao_justificativa: null });
      if (valor === "observacoes") campos.observacoes = null;
      if (!ORDEM.includes(valor)) return perguntar(sol);
      return perguntar(await atualizarSol(sol.id, campos));
    }
    case "env": {
      const faltas = await pendencias(sol);
      if (faltas.length) return perguntar(await atualizarSol(sol.id, { etapa: "resumo" }));
      const aviso = vinc.primeiro_uso ? "⚠️ _Primeiro uso deste número: SAC, confira se é mesmo este motorista._" : "";
      const enviada = await mudarStatus(sol, "aguardando_sac",
        { etapa: null, corrigindo: false, enviado_sac_em: new Date().toISOString() },
        "motorista", nomeMot, "enviada pelo WhatsApp");
      if (vinc.primeiro_uso) await db.from("motoristas_whatsapp").update({ primeiro_uso: false }).eq("id", vinc.id);
      await texto(wa, (await montarResumo(enviada, aviso)) +
        "\n\n✅ *Enviado ao SAC.* A resposta vem aqui mesmo nesta conversa.");
      return;
    }
    default:
      return perguntar(sol);
  }
}

// ---------------------------------------------------------------------------
// Complemento pedido pelo SAC
// ---------------------------------------------------------------------------
async function tratarComplemento(sol: any, msg: any, vinc: any, nomeMot: string) {
  const wa = vinc.wa_id;
  const { botao, txt, tipo } = lerMensagem(msg);
  if (botao === `comp_fim:${sol.id}`) {
    await mudarStatus(sol, "aguardando_sac", {}, "motorista", nomeMot, "complemento enviado");
    await db.from("motoristas_whatsapp").update({ solicitacao_ativa_id: null }).eq("id", vinc.id);
    return texto(wa, `✅ Complemento da *${sol.protocolo}* enviado ao SAC.`);
  }
  if (tipo === "image" || tipo === "audio" || tipo === "document") {
    await salvarAnexo({ ...sol, wa_id: wa }, msg, "complemento");
  } else if (tipo === "location") {
    await atualizarSol(sol.id, { latitude: msg.location.latitude, longitude: msg.location.longitude, localizacao_justificativa: null });
  } else if (txt) {
    const resp = sol.complemento_resposta ? `${sol.complemento_resposta} ${txt.toUpperCase()}` : txt.toUpperCase();
    await atualizarSol(sol.id, { complemento_resposta: resp });
  } else {
    return;
  }
  await dormir(ESPERA_ALBUM_MS);
  const { data: ultimo } = await db.from("solicitacao_anexos").select("criado_em")
    .eq("solicitacao_id", sol.id).order("id", { ascending: false }).limit(1).maybeSingle();
  if (ultimo && Date.now() - new Date(ultimo.criado_em).getTime() < ESPERA_ALBUM_MS - 500) return;
  return botoes(wa, "Recebido. Mande mais, se precisar, ou toque em *Terminei*.", [[`comp_fim:${sol.id}`, "✅ Terminei"]]);
}

// ---------------------------------------------------------------------------
// Respostas do SAC no app (smb_message_echoes)
// ---------------------------------------------------------------------------
type ComandoSac = { acao: "abrir" | "reprovar" | "complemento" | "desvincular"; valor: string };

function lerComandoSac(t: string): ComandoSac | null {
  const s = t.trim();
  // "DEV 149", "DEV-016", "dev 2026-016", "DEV-2026-016" (formato do Jr-Oper)
  let m = s.match(/^dev\b[\s:#º°.\-]*((?:\d{4}[\-\/])?\d{1,6})\b/i);
  if (m) return { acao: "abrir", valor: `DEV-${m[1].replace("/", "-")}` };
  m = s.match(/^#reprov\w*\s+([\s\S]+)/i);
  if (m) return { acao: "reprovar", valor: m[1].trim() };
  m = s.match(/^#complemento\s+([\s\S]+)/i);
  if (m) return { acao: "complemento", valor: m[1].trim() };
  if (/^#desvincular\b/i.test(s)) return { acao: "desvincular", valor: "" };
  return null;
}

async function tratarEcoSac(eco: any) {
  if (eco.type !== "text") return false;
  const cmd = lerComandoSac(eco.text?.body ?? "");
  if (!cmd) return false;
  const waId = String(eco.to ?? "");
  const vinc = await vinculoDo(waId);
  if (!vinc) return false;
  const autor = "SAC (WhatsApp)";

  if (cmd.acao === "desvincular") {
    await db.from("motoristas_whatsapp").update({ ativo: false, revogado_em: new Date().toISOString(), revogado_por: autor }).eq("id", vinc.id);
    return true;
  }

  const { data: sol } = await db.from("solicitacoes_devolucao").select("*")
    .eq("motorista_id", vinc.motorista_id).in("status", ["aguardando_sac", "pendente_complemento"])
    .order("enviado_sac_em", { ascending: false }).limit(1).maybeSingle();
  if (!sol) return false;
  const agora = new Date().toISOString();

  if (cmd.acao === "abrir") {
    await mudarStatus(sol, "ocorrencia_aberta", { numero_devolucao: cmd.valor, decidido_por: autor, decidido_em: agora },
      "sac", autor, `Ocorrencia ${cmd.valor}`);
  } else if (cmd.acao === "reprovar") {
    await mudarStatus(sol, "reprovada", { decisao_motivo: cmd.valor, decidido_por: autor, decidido_em: agora }, "sac", autor, cmd.valor);
  } else if (cmd.acao === "complemento") {
    if (sol.status !== "aguardando_sac") return true;
    await mudarStatus(sol, "pendente_complemento", { complemento_pedido: cmd.valor }, "sac", autor, cmd.valor);
    await db.from("motoristas_whatsapp").update({ solicitacao_ativa_id: sol.id }).eq("id", vinc.id);
    await botoes(vinc.wa_id, `📎 O SAC pediu um complemento na *${sol.protocolo}*. Mande aqui (texto, foto ou áudio) e depois toque em *Terminei*.`,
      [[`comp_fim:${sol.id}`, "✅ Terminei"]]);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
// So entra (e so e gravado) o que e conversa com o bot. Conversa normal do
// motorista com o SAC nao e gravada.
async function relevanteDoMotorista(msg: any, waId: string): Promise<boolean> {
  const vinc = await vinculoDo(waId);
  if (vinc) {
    const { botao, txt } = lerMensagem(msg);
    return !!(vinc.solicitacao_ativa_id || botao || PALAVRA_GATILHO(txt) || (await solEmColeta(vinc.motorista_id)));
  }
  const { data: cad } = await db.from("whatsapp_cadastro").select("criado_em").eq("telefone_chave", chaveTelefone(waId)).maybeSingle();
  if (cad) return true;
  return PALAVRA_GATILHO(msg.text?.body ?? "");
}

async function registrarEvento(id: string, campo: string, waId: string, tipo: string, payload: unknown): Promise<boolean> {
  const { data, error } = await db.from("whatsapp_eventos")
    .upsert({ mensagem_id: id, campo, wa_id: waId, tipo, payload }, { onConflict: "mensagem_id", ignoreDuplicates: true })
    .select("mensagem_id");
  if (error) throw new Error(`registrarEvento: ${error.message}`);
  return (data?.length ?? 0) > 0; // false = ja processado (a Meta reenviou)
}

async function concluirEvento(id: string, erro: string | null) {
  await db.from("whatsapp_eventos").update({ processado_em: new Date().toISOString(), erro }).eq("mensagem_id", id);
}

async function processar(corpo: any) {
  const wabaOk = await cfg("wa_waba_id");
  const phoneOk = await cfg("wa_phone_number_id");
  for (const entry of corpo?.entry ?? []) {
    if (wabaOk && String(entry.id) !== wabaOk) { console.warn("[webhook] WABA desconhecido"); continue; }
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (phoneOk && v.metadata?.phone_number_id && String(v.metadata.phone_number_id) !== phoneOk) continue;

      if (ch.field === "messages") {
        const nomes = Object.fromEntries((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name ?? ""]));
        for (const msg of v.messages ?? []) {
          const waId = String(msg.from ?? "");
          if (!waId || !(await relevanteDoMotorista(msg, waId))) continue;
          if (!(await registrarEvento(msg.id, "messages", waId, msg.type, msg))) continue;
          try { await tratarMotorista(msg, waId, nomes[waId] ?? ""); await concluirEvento(msg.id, null); }
          catch (e) { console.error("[motorista]", (e as Error).message); await concluirEvento(msg.id, (e as Error).message); }
        }
      } else if (ch.field === "smb_message_echoes") {
        for (const eco of v.message_echoes ?? []) {
          if (eco.type !== "text" || !lerComandoSac(eco.text?.body ?? "")) continue;
          if (!(await registrarEvento(eco.id, "smb_message_echoes", String(eco.to ?? ""), eco.type, eco))) continue;
          try { await tratarEcoSac(eco); await concluirEvento(eco.id, null); }
          catch (e) { console.error("[eco]", (e as Error).message); await concluirEvento(eco.id, (e as Error).message); }
        }
      }
      // demais campos (statuses, history, etc.): ignorados de proposito
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificacao do endpoint pela Meta (feita uma vez, ao configurar no Dualhook)
  if (req.method === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
    const token = await cfg("wa_verify_token");
    if (token && url.searchParams.get("hub.verify_token") === token) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  const chave = await cfg("wa_webhook_chave");
  if (!chave || url.searchParams.get("k") !== chave) return new Response("not found", { status: 404 });

  if (req.method === "GET" && url.searchParams.get("acao") === "status") {
    return json({ ok: true, modo: SIMULACAO ? "simulacao" : "real", phone_number_id: await cfg("wa_phone_number_id") });
  }

  if (req.method === "POST") {
    let corpo: any;
    try { corpo = await req.json(); } catch (_) { return new Response("ok"); }
    const tarefa = processar(corpo).catch((e) => console.error("[processar]", (e as Error).message));
    // Responde 200 na hora; a Meta reenvia se demorar
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(tarefa);
    else await tarefa;
    return new Response("ok");
  }

  return new Response("not found", { status: 404 });
});
