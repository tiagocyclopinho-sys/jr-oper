# Bot de Devoluções – resumo para continuar (01/10/2026)

## Objetivo
O motorista abre a solicitação de devolução por mensagem (NF, cliente, motivo, total/parcial,
itens, fotos, canhoto, localização, observações). O bot junta tudo num resumo para o SAC,
que abre a ocorrência no Jr-Oper como já faz hoje e responde ao motorista.
**Foco: só a abertura.** A versão com agente de IA foi adiada por custo.

## Regras do usuário
- Nada em produção sem aprovação. Testar em ambiente separado, com bot de teste.
- Explicar de forma simples: o usuário tem base técnica (SQL, Supabase, Power BI), mas não é desenvolvedor e não conhece Telegram.

## Onde está cada coisa
- **Jr-Oper atual:** `C:\Users\thiago.ferreira\Downloads\jr-oper-main (2)\jr-oper-main` (git, v6.8.4).
  A cópia em `S:\...\Aplicativos criados por mim\jr-oper-main` é **antiga** (v6.7.0) e não deve ser usada.
- **Arquivos do bot:** `bot-devolucoes/` dentro do repositório (sem commit):
  - `supabase/migrations/00_espelho_producao_SOMENTE_TESTE.sql` – cópia mínima de motoristas/clientes/motivos (só no teste)
  - `supabase/migrations/50_bot_devolucoes_telegram.sql` – tabelas do bot, trava de status, buscas, RLS, bucket privado
  - `supabase/functions/telegram-bot/index.ts` – bot do Telegram (sem IA)
  - `ROTEIRO_DE_TESTE.md` – 45 passos de teste do Telegram
  - `planos/PLANO_BOT_DEVOLUCOES_SIMPLES.md` (aprovado) e `planos/PLANO_DEVOLUCOES_TELEGRAM.md` (versão com IA, adiada)
- **Supabase de produção:** `JR-OPER` (`qxipgnkdbzxtfvuyupow`, org Comercial, Pro). **Intocado**; foi feita só leitura.
- **Supabase de teste:** `jr-devolucao` (`ywsjvxlasbaytvmwpsbd`, org Free "JR-devolucao-teste").
  Migrations 00 e 50 aplicadas, 64 motoristas (incluindo "MOTORISTA TESTE", id 900001), 90 clientes, 10 motivos.

## Decisões técnicas
- O bot **não grava** em `ocorrencias_devolucao`: o protocolo DEV é gerado no navegador e
  renumerado pela sincronização do Jr-Oper (confirmado na v6.8.4). O bot grava em
  `solicitacoes_devolucao` (protocolo TG-AAAA-NNNN) e o SAC informa o número da DEV.
- As tabelas novas têm RLS ligado e nenhuma policy: só a Edge Function, com a chave secreta, acessa.
  Atenção: em produção, todas as tabelas atuais têm `acesso_total_anon`; é um risco conhecido, fora do escopo.
- O único segredo do bot é o token. A senha do webhook é derivada dele.
- Status da solicitação: em_coleta → aguardando_sac ⇄ pendente_complemento → ocorrencia_aberta | reprovada; cancelada.

## Situação do Telegram (pronto, teste parado)
- Bot de teste **@JRDevoltestebot**, função `telegram-bot` publicada e webhook ligado no projeto de teste.
- Grupo de teste do SAC criado e registrado. O usuário começou o teste do vínculo e depois mudou o foco para o WhatsApp.
- Verificado: webhook recusa chamadas sem a senha (401), trava de status, uma solicitação em preenchimento por motorista, busca sem acento, verificador de segurança sem alertas.
- A conversa de ponta a ponta no Telegram **não chegou a ser testada**.

## Direção atual: WhatsApp no MESMO número do SAC
- Hoje o número do SAC está no **WhatsApp comum**, é corporativo e recebe mensagens de motoristas **e de outras pessoas**.
- Escolha: **coexistência** (o bot e o SAC dividem o número; o SAC continua no aplicativo) por meio do parceiro **Dualhook**:
  - plano Developer US$ 12/mês, 14 dias grátis, sem acréscimo por mensagem, Meta cobra direto;
  - total estimado de **~R$ 70/mês**, aceito pelo usuário.
- Comportamento planejado:
  - o bot só age quando um motorista **cadastrado** pede ("devolução" ou botão);
  - as demais conversas ficam com o SAC;
  - mensagens de quem não é motorista **não são gravadas**;
  - o motorista é reconhecido pelo **telefone** do cadastro, sem link;
  - o SAC vê a conversa e o resumo no próprio aplicativo.
- Volume de referência (setembro/2026): 122 devoluções, 31 motoristas, pico de 14 por dia.
- **Pendências a confirmar antes de contratar:**
  1. o Dualhook ativa coexistência para números do **Brasil**?
  2. a Meta passa a cobrar **mensagens de atendimento a partir de 1º/10/2026**? Sites de parceiros dizem que sim (1.000 grátis por número); a página oficial da Meta não diz. Se for verdade, somam-se ~R$ 50 a 100/mês.
  3. como o bot captura a resposta do SAC enviada pelo aplicativo (ex.: "DEV 149") na coexistência.
- Requisitos: passar o número do SAC para o **WhatsApp Business** (gratuito, mantém as conversas), verificar a empresa na Meta (CNPJ), app do Business na versão 2.24.17 ou mais nova.
- Perdas no aplicativo com coexistência: mensagens temporárias, visualização única, localização em tempo real e listas de transmissão.

## Onde parou (bloqueio)
- Criação da conta de desenvolvedor na Meta (developers.facebook.com), no passo **Verificar conta**.
  O Facebook do usuário tem um **celular antigo** cadastrado, e a Central de Contas exige código nesse número para trocar.
- Saídas possíveis:
  - verificar com **cartão de crédito** (opção na própria tela);
  - **recuperar o Facebook** ("Tentar outra forma" / documento);
  - **outra pessoa real da empresa** faz o cadastro.
- **Não** criar um Facebook falso ou genérico: vai contra as regras da Meta e o risco de bloqueio derruba o bot.

## Próximos passos
1. Resolver quem cria a conta de desenvolvedor na Meta e terminar o cadastro.
2. Criar o app "JR Devolucoes Teste" (uso: WhatsApp), o portfólio da empresa e cadastrar até 5 celulares de teste no número de teste gratuito da Meta.
3. Adaptar a função do bot para o WhatsApp no projeto de teste, reaproveitando o banco e a lógica das perguntas. O SAC acompanha pelo aplicativo.
4. Em paralelo: passar o número do SAC para o WhatsApp Business; perguntar as pendências 1 a 3 ao Dualhook.
5. Ativação: usar os 14 dias grátis do Dualhook para ligar a coexistência no número real, num horário tranquilo; testar com motoristas reais.
6. Produção (só com aprovação): migration 50 no JR-OPER (só objetos novos), deploy da função, piloto com 2 ou 3 motoristas.
