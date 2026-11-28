# Roteiro de ativação do bot de devoluções no WhatsApp

Atualizado em 28/11/2026. **Montado direto na produção (JR-OPER)**, com motoristas reais.
O chip já era usado e está no **celular separado para o SAC**; o atendimento é pelo **WhatsApp Web**.

## Já pronto (28/11)
| Peça | Onde | Situação |
|---|---|---|
| Tabelas, buscas, motivos, fotos | JR-OPER, migration 89 | Aplicada; 12 tabelas fechadas ao público |
| Bot (`whatsapp-bot`) | JR-OPER, Edge Functions | Publicado em **modo simulação** (não envia nada até a chave do Dualhook) |
| Painel (`painel-devolucoes`) | JR-OPER, Edge Functions | Publicado; só funciona com a senha |
| Tela do painel | `bot-devolucoes/painel-sac/index.html` | Pronta; vai ao ar quando a pasta subir no GitHub |
| Chaves e senha da produção | `Documents\JR-bot-whatsapp-SEGREDOS\PRODUCAO_dados_do_bot.txt` | Geradas; fora do GitHub |
| Conversa completa simulada | Produção | Passou (cadastro, pausa, cliente real, complemento, DEV); dados apagados |

## Etapa 1: até 01/12 (Tiago)
1. Usar o chip todo dia com conversas reais; abrir o app no celular.
2. **GitHub:** subir a pasta `bot-devolucoes` atualizada e a `database/migration_89_bot_devolucoes_whatsapp.sql`.
   Apagar pelo site: `bot-devolucoes/WHATSAPP_CHAVES_TESTE.txt` e `bot-devolucoes/SENHA_PAINEL_TESTE.txt`.
3. Abrir o painel `https://jr-oper.vercel.app/bot-devolucoes/painel-sac/` com a senha do arquivo e clicar em "Permitir" nas notificações.

## Etapa 2: ligar (a partir de 01/12, horário calmo, cerca de 30 min)
Pelo computador, com o celular do SAC na mão:
1. Contratar o Dualhook Developer (cartão; 14 dias grátis a partir daqui).
2. Informar **Webhook URL** e **Verify token** do arquivo `PRODUCAO_dados_do_bot.txt`.
3. Cadastro: Facebook do Tiago → portfólio **JR Distribuidora** → número do chip → QR Code → confirmar.
   **Histórico: escolher NÃO compartilhar** (o chip tem conversas antigas que não interessam ao bot).
4. Chave do Dualhook (`dh_live_...`) direto em Supabase JR-OPER → Edge Functions → Secrets → `DUALHOOK_KEY`.
5. Passar ao Claude o **Phone Number ID** e o **WABA ID** (gravar no `bot_config`).
6. Conferir o endereço do item 4 do arquivo: deve dizer `"modo":"real"`.
7. Criar no Dualhook o modelo `complemento_devolucao` (abaixo).
8. Religar o WhatsApp Web (pode levar até 24 h).
Se a Meta recusar o número: não apagar nada; continuar usando e tentar dias depois.

## Etapa 3: primeiro teste real (mesmo dia, 1 h)
Com o celular do Tiago fazendo papel de motorista (escolher o próprio nome se estiver no cadastro, ou um motorista de confiança junto):
| # | Faz | Esperado |
|---|---|---|
| 1 | Escreve "devolução" | Bot pede o nome, depois a NF |
| 2 | Responde tudo com 2 fotos, canhoto e localização | Resumo; após Enviar, alerta no painel |
| 3 | No meio de outra, o SAC escreve pelo Web | Bot pausa; Continuar retoma |
| 4 | SAC: `#complemento foto da etiqueta` | Bot pede; Terminei devolve ao SAC |
| 5 | SAC: `DEV 149` | Painel: ocorrência aberta |
| 6 | Outra; SAC: `#reprovar teste` | Painel: reprovada |
| 7 | Painel | Fotos, canhoto e mapa abrem |
Depois: `#desvincular` na conversa do teste e apagar as solicitações de teste (o Claude faz).

## Etapa 4: piloto (logo depois)
2 ou 3 motoristas que mais abrem devolução. O SAC abre a DEV no Jr-Oper como hoje e responde na conversa.
Medir 1 a 2 semanas: concluídas sem ajuda, tempo de preenchimento, retrabalho do SAC. Decidir antes do 14º dia do Dualhook.

## Cuidados
- Qualquer contato que escrever só "devolução" (até 4 palavras) recebe a pergunta do nome. Quem não é motorista toca em "Não sou nenhum destes".
- O motorista escolhe o próprio nome no primeiro uso; o resumo avisa o SAC para conferir. Errado: `#desvincular` na conversa.
- Abrir o app no celular pelo menos a cada 13 dias.

## Modelo de mensagem (Etapa 2)
- Nome `complemento_devolucao` · Categoria **UTILITY** · Idioma **Portuguese (BR)**
- Texto: `Olá! O SAC da JR Distribuidora precisa de um complemento na solicitação de devolução {{1}}: {{2}}. Responda por aqui com o que foi pedido.`
- Exemplos: {{1}} = `SD-2026-0012` · {{2}} = `mandar a foto da etiqueta do produto`
