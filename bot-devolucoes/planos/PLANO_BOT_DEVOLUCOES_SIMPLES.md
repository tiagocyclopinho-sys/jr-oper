# Plano: Bot de Devoluções no Telegram (versão simples, sem IA)

Status: **PROPOSTA — aguardando aprovação.** Data: 30/09/2026.
Substitui, por enquanto, o `PLANO_DEVOLUCOES_TELEGRAM.md` (versão com agente de IA, que fica para depois).

## Objetivo
O motorista responde perguntas fixas com botões → o bot junta tudo num resumo → publica no **grupo do SAC no Telegram** → o atendente abre a ocorrência no Jr-Oper como faz hoje → clica num botão → o motorista é avisado.

**Custo mensal:** zero (Telegram grátis; sem IA; teste em organização Free do Supabase; produção dentro do plano atual).
**Jr-Oper:** nenhuma alteração nesta fase.

## Ambientes
| | Teste | Produção (só depois de aprovado) |
|---|---|---|
| Supabase | `jr-devolucao` (`ywsjvxlasbaytvmwpsbd`, org Free) | `JR-OPER` (`qxipgnkdbzxtfvuyupow`) |
| Bot | bot de teste | bot oficial (a criar) |
| Grupo SAC | "SAC Devoluções – TESTE" | grupo real do SAC |
| Cadastros | cópia de `motoristas` (telefone mascarado) + amostra de ~500 `clientes` (incluindo os que aparecem nas DEVs recentes) | tabelas reais |

O código da função é **o mesmo** nos dois ambientes. Muda só o token do bot e o grupo.

## Conversa do motorista
```
/start <código>  → vincula (link gerado pelo SAC no grupo). "Olá, JOÃO! Você já pode usar /nova."
/nova
 1. NF ................ texto (só números, 4 a 10 dígitos)
 2. Cliente ........... código ou nome → até 6 botões → escolhe (ou "Não está na lista" → texto livre)
 3. Motivo ............ botões (tabela motivos_devolucao)
 4. Total ou parcial .. botões
 5. Itens (parcial) ... uma mensagem por item, texto livre ("frango 12 cx") → [Terminei]
 6. Fotos ............. mínimo conforme o motivo → [Terminei (3 fotos)]
 7. Canhoto ........... 1 foto (se o motivo exigir) → [Não tenho canhoto] exige explicação
 8. Localização ....... botão [📍 Enviar localização] (se o motivo exigir)
 9. Observações ....... texto ou áudio → [Pular]
10. Resumo ............ [✅ Enviar ao SAC]  [✏️ Corrigir]  [❌ Cancelar]
/status   → últimas 5 solicitações e situação
/cancelar → cancela a que está em andamento
/ajuda    → explica o uso
```
- Resposta fora do esperado (ex.: texto quando pede foto) → o bot repete a pergunta explicando o que precisa.
- **Corrigir** mostra botões com cada campo; refaz só aquele e volta ao resumo.
- Uma solicitação aberta por vez. Se ficar parada por mais de 24 h, é cancelada automaticamente na próxima vez que o motorista usar `/nova`.
- Chat não vinculado → "Este canal é só para motoristas cadastrados. Peça o link ao SAC." e nada mais.
- Mensagens em outros grupos que não o do SAC → o bot sai do grupo.

## No grupo do SAC
Quando o motorista envia, o bot publica:
1. álbum com as fotos e o canhoto;
2. a localização (mapa);
3. o áudio, se houver;
4. o resumo:
```
📦 SOLICITAÇÃO TG-2026-0012
Motorista: JOÃO DA SILVA
NF: 1320080
Cliente: 7202 - DANIELA RODRIGUES MORAES (Araguaína)
Motivo: AVARIA   |   Tipo: PARCIAL
Itens:
 • PEITO BF RESF 12 BDJ
 • COXA SOBRECOXA 5 KG
Observações: CLIENTE ACEITOU O RESTANTE DA NOTA.
Fotos: 3 + canhoto   |   Localização: enviada
Recebida em 30/09/2026 14:32
[✅ Ocorrência aberta]  [↩ Pedir complemento]  [❌ Reprovar]
```
| Botão | O que acontece |
|---|---|
| **Ocorrência aberta** | O bot pede: "Responda a esta mensagem com o número da DEV". O atendente responde `DEV-149` → status `ocorrencia_aberta` → motorista recebe "✅ Sua devolução TG-2026-0012 foi registrada no SAC como DEV-149." |
| **Pedir complemento** | O bot pede o texto → envia ao motorista ("📝 O SAC pediu: ...") → o motorista responde (texto/foto) → o bot publica o complemento no grupo, respondendo à mensagem original. |
| **Reprovar** | O bot pede o motivo → envia ao motorista ("❌ ... não aprovada. Motivo: ..."). |

Comandos no grupo:
- `/vincular joão` → botões com os motoristas encontrados → gera link de uso único, válido por 48 h → o SAC encaminha pelo WhatsApp.
- `/desvincular joão` → corta o acesso.
- `/pendentes` → lista o que ainda não teve ação.

Segurança do lado do SAC: só valem cliques e comandos **vindos do grupo cadastrado**; qualquer membro do grupo age como SAC, e o nome de quem clicou fica gravado no histórico.

## Banco (tabelas novas, sem tocar nas existentes)
No **teste**, são criadas também cópias mínimas de `motoristas`, `clientes` e `motivos_devolucao` com as mesmas colunas da produção, para o código funcionar igual.

| Tabela | Para quê |
|---|---|
| `bot_config` | id do grupo do SAC e outras configurações (não secretas). |
| `motoristas_telegram` | vínculo motorista ↔ chat, código de uso único, revogação. |
| `solicitacoes_devolucao` | a solicitação: NF, cliente, motivo, tipo, observações, localização, `etapa` da conversa, `status`, nº DEV informado pelo SAC. Protocolo `TG-AAAA-NNNN` gerado pelo banco. |
| `solicitacao_itens` | uma linha por item, texto livre. |
| `solicitacao_anexos` | fotos/canhoto/áudio: id do arquivo no Telegram + cópia no Storage privado. |
| `solicitacao_historico` | cada mudança de status, quem fez e a mensagem enviada ao motorista. |
| `telegram_updates` | não processar a mesma mensagem duas vezes (o Telegram reenvia). |
| `sac_acoes_pendentes` | liga o "responda a esta mensagem" do grupo à solicitação e à ação. |

Na `motivos_devolucao` (vazia e fora da sincronização do Jr-Oper), acrescento as colunas: `codigo`, `visivel_motorista`, `min_fotos`, `exige_canhoto`, `exige_localizacao`, `ordem`. A lista inicial é a da seção 3.3 do plano anterior, **a validar com o SAC**.

Status: `em_coleta` → `aguardando_sac` ⇄ `pendente_complemento` → `ocorrencia_aberta` | `reprovada`; `cancelada` a partir de `em_coleta`/`pendente_complemento`. As transições são garantidas por trigger no banco.
`recebida_deposito` fica para a fase seguinte: exige ligar o nº DEV informado com `ocorrencias_devolucao` da produção.

Todas as tabelas novas: **RLS ligado, sem policy** → a chave pública não enxerga nada; só a função do bot acessa. Bucket `devolucoes-telegram` **privado**.

## Função
Uma Edge Function só, `telegram-bot` (TypeScript/Deno, sem biblioteca de IA):
- `POST` do Telegram → confere o cabeçalho secreto → grava em `telegram_updates` → processa → responde.
- `GET /telegram-bot/setup` → registra o webhook no Telegram apontando para ela mesma. Pode ser chamado mais de uma vez sem efeito colateral.
- O segredo do webhook é **derivado do token** dentro da função. Você só cadastra **um** segredo: `TELEGRAM_BOT_TOKEN`.

## Testes (no projeto de teste)
1. Banco: transições válidas/inválidas; chave pública não lê as tabelas nem o bucket.
2. Segurança: requisição sem o cabeçalho secreto → 401; mensagem repetida → ignorada; chat não vinculado → recusado; link vencido/reutilizado → recusado; clique vindo de outro grupo → ignorado.
3. Fluxos no celular: avaria parcial completa; cliente fechado (total + localização); tentar pular foto; texto no lugar de foto; álbum de 5 fotos; áudio nas observações; corrigir um campo; cancelar; complemento (ida e volta); reprovação; ocorrência aberta com DEV.
4. Uso real simulado: você + 1 atendente + 1–2 motoristas no bot de teste, com casos fictícios, por 2–3 dias.

## Produção (só depois da sua aprovação dos testes)
1. Criar o bot oficial no BotFather e o grupo real do SAC.
2. Em horário de baixo movimento: migration no `JR-OPER` **só com objetos novos** + colunas novas na `motivos_devolucao` (vazia). Script de rollback pronto.
3. Deploy da mesma função; cadastrar o token do bot oficial; `setup`.
4. Piloto com 2–3 motoristas por 2 semanas → expandir.
5. Para desligar: remover o webhook (o bot para na hora). As tabelas não afetam o Jr-Oper.

## O que preciso de você
1. Aprovar este plano (ou pedir ajustes).
2. Cadastrar o segredo `TELEGRAM_BOT_TOKEN` no projeto `jr-devolucao`: Edge Functions → Secrets.
3. Validar a lista de motivos com o SAC (pode ser durante os testes).
