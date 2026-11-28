# Bot de devoluções no WhatsApp: etapa do chip exclusivo

Atualizado em 28/11/2026 (tarde). Caminho: **coexistência** (SAC e bot no mesmo número) pelo Dualhook, plano Developer.

## Resposta do Dualhook (24/11/2026)
1. Brasil: atendem; a Meta avalia cada número no cadastro.
2. Prazo: cerca de 7 dias de uso real (01/12), sem garantia. Se a Meta recusar, continuar usando e tentar depois. NUNCA apagar e registrar o número de novo (zera a atividade).
3. WhatsApp Web: as respostas chegam ao bot. Windows não. Ligar desconecta todos os aparelhos conectados; religar pode levar até 24 h. O Web não conta como uso: abrir o app no celular pelo menos a cada 14 dias.
4. Troca de celular: backup, horário calmo, registrar no WhatsApp Business do novo celular com "reconectar" marcado. A Meta costuma reconectar sozinha (mesmos IDs e chave). Enquanto isso o bot não envia. Religar o Web à mão.
5. Trocar pelo número do SAC depois: sim, no mesmo plano; vira conexão nova (IDs, chave e webhook novos; modelos de mensagem refeitos). Os dois ao mesmo tempo: plano Team.
- O teste de 14 dias começa no checkout (pede cartão) e o número só conecta depois dele. Contratar só com o webhook pronto.
- A Meta não exige forma de pagamento para concluir; só para passar das 1.000 mensagens grátis.

## Passos
Ver ROTEIRO_ATIVACAO.md (etapas 1 a 7, com o que fazer em cada uma).

## Pronto em 28/11 (não publicado)
- Pausa do bot quando o SAC escreve; chave no caminho do endereço.
- Janela de 24 h: fora dela, o pedido de complemento sai pelo modelo complemento_devolucao.
- Painel: alerta de solicitação nova (som, contador no título, aviso do Windows); solicitações do WhatsApp mostram os comandos da conversa em vez dos botões.
- Chaves novas em Documents\JR-bot-whatsapp-SEGREDOS (fora do GitHub); arquivos antigos tirados da pasta.
- Produção: migrations/producao/PRODUCAO_bot_whatsapp.sql (50 a 54 juntas, nomes de motivo iguais aos do SAC).
- 28 verificações locais sem erro.

## Custo previsto
| Item | Mês |
|---|---|
| Dualhook Developer | US$ 12 (cerca de R$ 70 com IOF) |
| Meta: 1.000 mensagens do bot grátis por mês | R$ 0 |
| Meta: excedente (cerca de US$ 0,007 cada) | R$ 0 a 55 |
| Mensagens do SAC pelo app | Grátis |
| **Total** | **cerca de R$ 70 a 125; perto de R$ 80 no volume de novembro** |
Teste e piloto: R$ 0 nos 14 dias grátis. Volume: 75 a 120 devoluções por mês x 15 a 20 mensagens do bot.

## Se não der certo
A. Outro fornecedor com coexistência (YCloud, 360dialog). B. Esperar e tentar de novo. C. Decisões pelo painel. D. Direto na Meta com chat no painel. E. Telegram.
