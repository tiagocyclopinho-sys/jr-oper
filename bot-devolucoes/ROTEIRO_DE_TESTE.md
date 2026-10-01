# Roteiro de teste – Bot de Devoluções (ambiente de TESTE)

- **Bot:** @JRDevoltestebot
- **Grupo do SAC:** o grupo de teste que você criou
- **Banco:** projeto `jr-devolucao` (teste). Nada aqui mexe no Jr-Oper nem na produção.

Você faz os dois papéis com o mesmo celular: **SAC** (no grupo) e **motorista** (na conversa com o bot).
Invente os dados: qualquer NF, fotos de qualquer coisa.

Marque cada item: ✅ deu certo · ❌ deu errado (anote o que apareceu).

---

## Dica: como "responder" a uma mensagem no Telegram
Algumas vezes o bot pede *"responda a esta mensagem"*. Para isso:
- **Celular:** segure o dedo sobre a mensagem do bot e toque em **Responder**. Depois escreva e envie.
- **Computador:** clique com o botão direito na mensagem e escolha **Responder**.

A sua mensagem vai aparecer com um "recorte" da mensagem do bot em cima. É assim que o bot sabe a que você está respondendo.

---

## Parte 1 – Preparar (uma vez só)

**1. Registrar o grupo do SAC**
- Abra o grupo de teste. Se já estava aberto, feche e abra de novo, para o menu atualizar.
- Toque no botão **/** (ou em **Menu**) ao lado da caixa de texto e escolha **/registrar_grupo**.
- Se o menu não aparecer, escreva exatamente: `/registrar_grupo@JRDevoltestebot`
- ✅ Esperado: *"Este grupo foi registrado como o grupo do SAC"* + lista de comandos.

**2. Cadastrar você como motorista de teste**
- No grupo, pelo menu, escolha **/vincular**.
- O bot responde *"🔎 Gerar link: responda a esta mensagem com o nome do motorista"*.
- **Responda** a essa mensagem (veja a dica acima) escrevendo: `motorista teste`
- Toque no botão **MOTORISTA TESTE**.
- ✅ Esperado: aparece um link `https://t.me/JRDevoltestebot?start=...`
- Toque no link. Abre a conversa com o bot → toque em **INICIAR** (ou **START**).
- ✅ Esperado na conversa: *"Pronto, MOTORISTA TESTE! Seu acesso está ativo."*
- ✅ Esperado no grupo: *"MOTORISTA TESTE ativou o acesso ao bot"*.

**3. Link usado de novo**
- Volte ao grupo e toque no **mesmo link** outra vez.
- ✅ Esperado: *"Este link é inválido ou já foi usado"*.

---

## Parte 2 – Motorista abre uma devolução (caminho completo)

Na conversa com o bot:

| # | O que fazer | O que deve acontecer |
|---|---|---|
| 4 | Toque em **Menu** → **/nova** | Aparece *"Nova devolução TG-2026-0001"* e a pergunta da NF |
| 5 | Escreva `abc` | *"Não entendi. Mande só os números"* |
| 6 | Escreva `1320080` | *"NF 1320080 anotada"* e pergunta o cliente |
| 7 | Escreva `quartetto` | Dois botões QUARTETTO + *"Não está na lista"* |
| 8 | Toque no primeiro QUARTETTO | *"Cliente: 8145 - QUARTETTO..."* e os botões de motivo |
| 9 | Escreva qualquer texto | *"Toque em uma das opções nos botões"* |
| 10 | Toque em **AVARIA** | Pergunta *nota inteira ou parte* |
| 11 | Toque em **Só uma parte (parcial)** | Pede os itens |
| 12 | Escreva `FRANGO INTEIRO 12 CX`, depois `COXA 5 KG` | *"Item 1…"*, *"Item 2…"* |
| 13 | Toque em **Apagar o último** | *"Apagado: COXA 5 KG"* |
| 14 | Toque em **Terminei os itens** | Pede as fotos (mínimo 2 para avaria) |
| 15 | Mande **1 foto** e toque em **Terminei** | Aviso *"Preciso de pelo menos 2 fotos"* |
| 16 | Mande mais **2 ou 3 fotos juntas** (selecione várias de uma vez) e toque em **Terminei** | Uma resposta só para o álbum, depois pede o canhoto |
| 17 | Mande **1 foto** (finja que é o canhoto) | *"Canhoto recebido"* e aparece o botão **📍 Enviar localização** |
| 18 | Toque em **📍 Enviar localização** e confirme | *"Localização recebida"* e pede observações |
| 19 | Mande um **áudio** (segure o microfone) | *"Áudio recebido"* e mostra o **resumo** |
| 20 | Confira o resumo e toque em **✏️ Corrigir** → **NF** | Pede a NF de novo |
| 21 | Escreva `1320081` | Volta direto ao resumo com a NF nova |
| 22 | Toque em **✅ Enviar ao SAC** | *"Enviado ao SAC! Protocolo TG-2026-0001"* |

## Parte 3 – O SAC recebe e responde

No grupo:

| # | O que fazer | O que deve acontecer |
|---|---|---|
| 23 | Olhe o grupo | Chegaram: álbum de fotos, canhoto, mapa, áudio e o resumo com 3 botões |
| 24 | Toque em **↩️ Pedir complemento** | O bot pede *"responda a esta mensagem com o que falta"* |
| 25 | **Responda** com: `Mande foto da etiqueta` | No grupo: *"Complemento pedido ao motorista"* |
| 26 | Vá para a conversa com o bot | Chegou *"O SAC precisa de mais informações…"* |
| 27 | Mande 1 foto e escreva `segue a etiqueta` | *"Recebido…"*, *"Anotado…"* com botão **Enviar complemento** |
| 28 | Toque em **📨 Enviar complemento ao SAC** | No grupo aparece *"COMPLEMENTO · TG-2026-0001"* com a foto e os botões |
| 29 | No grupo, toque em **✅ Ocorrência aberta** | Pede o número da DEV |
| 30 | **Responda** com `149` | Grupo: *"TG-2026-0001 → DEV-149"*. Motorista: *"registrada pelo SAC como DEV-149"* |
| 31 | Na conversa com o bot, toque em **/status** | Mostra a TG-2026-0001 como *"✅ Registrada no SAC (DEV-149)"* |

## Parte 4 – Outros caminhos

| # | O que fazer | O que deve acontecer |
|---|---|---|
| 32 | **/nova** → NF `555111` → cliente `xyzxyz` | *"Não encontrei cliente"* + botão *Digitar o nome manualmente* |
| 33 | Toque nele e escreva `MERCADINHO DO TESTE` | Segue para o motivo |
| 34 | Motivo **CLIENTE RECUSOU / FECHADO** → **Nota inteira** | Não pede itens; pede 1 foto (fachada) |
| 35 | Mande 1 foto → Terminei → no canhoto toque **Pular** | Pede a localização |
| 36 | Toque em **Não consigo enviar** | Pede o motivo; escreva `sem sinal` |
| 37 | Observações: **Pular** → **Enviar ao SAC** | Chega no grupo |
| 38 | No grupo: **❌ Reprovar** → responda `NF errada` | Motorista recebe *"não foi aprovada. Motivo: NF errada"* |
| 39 | **/nova** e, no meio, toque em **/nova** de novo | Pergunta *Continuar essa / Descartar e começar outra* |
| 40 | Toque em **/cancelar** | *"TG-2026-000X foi cancelada"* |
| 41 | No grupo: **/pendentes** | Lista o que ainda está aguardando o SAC (ou *"Nada pendente"*) |
| 42 | Na conversa com o bot, role para cima e toque num botão **antigo** que sobrou (ex.: um *Terminei as fotos* de uma devolução já enviada) | *"Essa opção não vale mais"* e o botão some |

## Parte 5 – Segurança (se tiver outra pessoa para ajudar)

| # | O que fazer | O que deve acontecer |
|---|---|---|
| 43 | Outra pessoa (sem link) procura **@JRDevoltestebot** e manda qualquer coisa | *"Este bot é de uso exclusivo dos motoristas…"* |
| 44 | Alguém adiciona o bot em **outro grupo** | O bot sai do grupo sozinho |
| 45 | No grupo do SAC: **/desvincular** → responda `motorista teste` → toque no nome | Motorista recebe *"Seu acesso foi encerrado"*; depois disso o **/nova** é recusado |

---

## Se algo der errado
Anote o **número do passo** e o que apareceu (um print ajuda). Eu consulto os registros do banco e da função e corrijo.

Para refazer o teste do zero, é só pedir: eu limpo as solicitações de teste e reinicio a numeração.
