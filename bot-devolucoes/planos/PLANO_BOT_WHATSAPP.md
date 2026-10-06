# Bot de devoluções no WhatsApp (coexistência via Dualhook)

Atualizado em 01/10/2026. Substitui o formulário (reprovado pela gerência) e o Telegram.

## Como funciona

- O SAC continua usando o **WhatsApp Business** no mesmo número. O bot usa o mesmo número pela API.
- O bot **só entra na conversa** quando o motorista escreve algo como "devolução". Qualquer outra conversa fica com o SAC e **não é gravada**.
- **Primeiro uso de um número:** o motorista escolhe o próprio nome na lista. O resumo avisa o SAC para conferir.
- **Perguntas:** NF → cliente → motivo → total/parcial → itens → fotos → canhoto → localização → observações → resumo → enviar.
- **O SAC vê tudo** na própria conversa do aplicativo, inclusive o resumo final. O painel (`/painel`) também mostra a solicitação.
- **O SAC responde na conversa do motorista** (comandos lidos pelo bot):

| O SAC escreve | O que acontece |
|---|---|
| `DEV 149`, `DEV-016` ou `DEV 2026-016` | Ocorrência aberta, com o número da DEV gravado |
| `#reprovar <motivo>` | Reprovada |
| `#complemento <o que falta>` | O bot pede o complemento ao motorista, com o botão "Terminei" |
| `#desvincular` | Desfaz o vínculo do número com o motorista (cadastro errado) |

## O que a documentação do Dualhook respondeu

- **Respostas do SAC chegam ao bot:** sim, pelo `smb_message_echoes`.
- **Cobrança da Meta (a partir de 01/10/2026):**
  - As mensagens que **o bot** envia são cobradas a partir da **1.001ª do mês**, por número; as primeiras 1.000 são grátis.
  - As mensagens do SAC pelo aplicativo continuam **grátis**.
  - Estimativa: cerca de 15 mensagens do bot por devolução × 122 = cerca de 1.800 por mês, ou seja, uns 800 pagos, a cerca de US$ 0,007 cada. Dá por volta de **US$ 6 (R$ 30) por mês**.
- **Verificação da empresa:** não é obrigatória para a coexistência; pode ser feita antes ou depois.
- **Atenções:**
  - O número precisa ter **pelo menos 7 dias de uso ativo no WhatsApp Business** antes de ligar a coexistência.
  - **O WhatsApp para Windows não é suportado** como aparelho conectado e pode não avisar o bot das respostas do SAC. Isso está perguntado ao Dualhook.
  - Com cerca de **14 dias sem abrir o aplicativo** no celular, a Meta desliga a conexão.
  - Na coexistência não existem mensagens temporárias, visualização única, localização em tempo real nem listas de transmissão.
- **Ainda sem resposta** (e-mail em `EMAIL_DUALHOOK.txt`):
  1. Eles ativam coexistência para o Brasil?
  2. Dá para trocar o número de teste pelo do SAC no mesmo plano?
  3. O WhatsApp Web no navegador gera os avisos das respostas do SAC?

## O que já está pronto (somente no Supabase de TESTE)

- Migration `52_bot_whatsapp.sql` aplicada.
- Função `whatsapp-bot` publicada em **modo simulação**: sem a chave do Dualhook, nada é enviado e as respostas vão para `whatsapp_saida_simulada`.
- Simulação de ponta a ponta feita em 01/10, sem erros:
  - cadastro, NF duplicada, cliente, motivo, itens;
  - 3 fotos juntas com uma resposta só, canhoto, localização, resumo, envio;
  - `DEV 2026-149` do SAC registrado;
  - número sem o 9 reconhecido;
  - conversa comum do SAC não gravada.
- **Ainda não testado:** o fluxo de complemento, a correção e o download real das fotos (precisa do Dualhook).
- As chaves do webhook de teste estão em `WHATSAPP_CHAVES_TESTE.txt`, fora do git.

## Passos

### Agora (Tiago)
1. Mandar o e-mail ao Dualhook (`EMAIL_DUALHOOK.txt`).
2. Passar o **seu número** para o **WhatsApp Business**, depois do backup das conversas, e usar normalmente por **7 dias ou mais**.
3. Separar **outro celular** para fazer o papel do motorista.
4. Confirmar como o SAC usa o WhatsApp no computador: aplicativo do Windows ou WhatsApp Web.

### Ativação do teste (depois das respostas e dos 7 dias)
1. Criar a conta no Dualhook (teste de 14 dias). No cadastro, informar:
   - **URL do webhook:** `https://ywsjvxlasbaytvmwpsbd.supabase.co/functions/v1/whatsapp-bot?k=<wa_webhook_chave>`
   - **Verify token:** `<wa_verify_token>`
2. No Embedded Signup, escolher o portfólio **JR Distribuidora** e o número que já está no WhatsApp Business.
3. Copiar a chave `dh_live_...` para os Secrets da função no Supabase de teste, como `DUALHOOK_KEY`.
4. Gravar `wa_phone_number_id` e `wa_waba_id` no `bot_config`.
5. Testar com o outro celular, conferir as fotos no painel e testar os comandos do SAC.

### Produção (só com aprovação)
1. Migrations 50, 51 e 52 no JR-OPER (só objetos novos).
2. Publicar a função na produção.
3. Ligar o número do SAC.
4. Piloto com 2 ou 3 motoristas.
