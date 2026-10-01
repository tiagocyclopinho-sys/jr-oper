# Guia: criar a conta de desenvolvedor na Meta (para o colega)

Objetivo: criar o app de teste do WhatsApp do bot de devoluções e dar acesso de administrador ao Tiago.
Tempo estimado: 20 a 30 minutos. Não tem custo.

Os nomes dos botões podem variar um pouco, porque a Meta muda as telas com frequência.

## Antes de começar

- Use o **seu Facebook pessoal real**, com o celular atual cadastrado e acesso ao e-mail dele.
- Se a verificação em duas etapas não estiver ligada, ligue antes: Central de Contas → Senha e segurança.
- Tenha em mãos: o nome da empresa, o CNPJ e um e-mail corporativo.

## Parte 1: Conta de desenvolvedor

1. Acesse **developers.facebook.com** e entre com o seu Facebook.
2. Clique em **Começar** e aceite os termos.
3. **Verificar conta:** confirme o código que chega por SMS no seu celular.
4. Confirme o e-mail.
5. Em "Qual opção descreve você melhor?", escolha **Desenvolvedor**.

## Parte 2: Criar o app

1. Clique em **Meus apps → Criar app**.
2. Preencha:
   - **Nome do app:** `JR Devolucoes Teste`
   - **E-mail de contato:** o e-mail corporativo
3. **Caso de uso:** escolha **"Conectar-se com clientes pelo WhatsApp"**.
4. **Portfólio empresarial:** se aparecer a opção, crie um novo com o nome da empresa, o seu nome e o e-mail corporativo.
5. Conclua a criação do app.

## Parte 3: Dar acesso ao Tiago

### 3a. Portfólio empresarial (o mais importante)

1. Acesse **business.facebook.com → Configurações** (ícone de engrenagem).
2. Vá em **Usuários → Pessoas → Adicionar**.
3. Informe o e-mail do Tiago e escolha **Acesso total (administrador)**.
4. Em **Ativos**, marque o app `JR Devolucoes Teste` e a conta do WhatsApp com **controle total**.
5. Envie o convite. O Tiago aceita pelo e-mail.

### 3b. Função no app

1. No painel do app (developers.facebook.com), abra **Funções do app → Funções → Adicionar pessoas**.
2. Escolha **Administrador** e informe o Tiago.

> Observação: a Meta pode exigir que o Tiago também tenha conta de desenvolvedor para aceitar a parte 3b, e é exatamente aí que ele está bloqueado. Se o convite não funcionar, tudo bem: o acesso da parte 3a já resolve quase tudo. O que faltar, você faz nos passos abaixo.

## Parte 4: Cadastrar os celulares de teste (só se a parte 3b não funcionar)

1. No painel do app, abra **WhatsApp → Configuração da API**.
2. Em **"Para"**, clique em **Gerenciar lista de números de telefone**.
3. Adicione até 5 celulares que o Tiago indicar. Cada celular recebe um código no WhatsApp; a pessoa do celular informa o código.

## O que NÃO fazer

- Não envie senha, código de SMS nem token por WhatsApp ou e-mail. O Tiago entra com o próprio acesso.
- Não crie Facebook genérico ou "da empresa": é contra as regras da Meta e pode bloquear o bot.
- Não conecte o número real do SAC ainda. Por enquanto, só o número de teste gratuito da Meta.

## Recomendação

Mantenha pelo menos **2 administradores** no portfólio (você e o Tiago), para a empresa não depender de uma pessoa só.
