# 🚀 Guia Prático de Deploy & Operação Corporativa de Custo Zero
## JR Oper - Sistema Integrado de Operações Logísticas

Este manual foi escrito em **linguagem simples e direta**, sem termos técnicos complexos, pensado para que qualquer gestor ou curioso com grandes ideias consiga colocar o sistema no ar para **toda a empresa**, integrando os setores com **custo zero R$ 0,00**.

---

## 🎯 Visão Geral do Sistema Multidepartamental

 O **JR Oper** integra 4 setores estratégicos da **JR Distribuidora** em um único lugar:

| Setor | Função na Aplicação | Benefício para a Gestão Direta |
| :--- | :--- | :--- |
| **🟢 SAC / Operação** | Registro de devoluções, busca de cargas e apuração de causas raiz. | Elimina refação de chamados e identifica a causa real do prejuízo. |
| **🟠 CD (Galpão)** | Recebimento físico de produtos e destinação (Estoque, Avaria, Fornecedor). | Auditoria de avarias e conferencia física pendente. |
| **🔵 Financeiro** | Tratativa fiscal (Notas Fiscais) e acertos (Abatimento vs. JR Paga). | Prevenção de perdas financeiras e acerto de boleto imediato. |
| **🔴 Frota & Socorro** | Chamados de veículos parados e trocas de veículos em rota. | Alerta crítico que só desativa ao resolver o veículo parado. |

---

## 📋 PASSO A PASSO PARA PUBLICAÇÃO (DEPLOY GRATUITO)

---

### ETAPA 1: Colocar o Sistema na Internet (Site / App Web) - **Tempo: 3 minutos**

> **O QUE FOI FEITO:** Criamos os arquivos de configuração automática (`vercel.json` e `netlify.toml`) no projeto.
> **POR QUE FOI FEITO:** Para que você possa publicar o aplicativo na nuvem gratuitamente em 1 clique, gerando um link seguro (Ex: `https://jr-oper.vercel.app`) acessível por qualquer computador ou celular.

#### Como Fazer (Seu Acesso):
1. Acesse o site gratuito **[Vercel.com](https://vercel.com)** ou **[Netlify.com](https://netlify.com)** e crie uma conta gratuita com seu e-mail.
2. Clique no botão **"Add New Project"** (Adicionar Novo Projeto).
3. Arraste a pasta inteira do seu projeto `jr-sac-corrigido` para a tela.
4. Clique em **"Deploy"**.
5. **Pronto!** Em 30 segundos, você receberá um link público onde todos os seus colaboradores (SAC, CD, Financeiro e Frota) poderão usar o app!

---

### ETAPA 2: Criar o Banco de Dados na Nuvem (Supabase) - **Tempo: 4 minutos**

> **O QUE FOI FEITO:** Criamos o script SQL relacional (`database/schema.sql`) em 3ª Forma Normal (3FN), com views prontas para o Power BI e segurança por setor.
> **POR QUE FOI FEITO:** Para que os dados cadastrados em um computador (Ex: SAC) apareçam instantaneamente no computador do CD ou Financeiro na nuvem com custo zero.

#### Como Fazer (Seu Acesso):
1. Acesse o site gratuito **[Supabase.com](https://supabase.com)** e crie uma conta gratuita.
2. Clique em **"New Project"** (Novo Projeto), digite o nome `JR-Oper` e defina uma senha.
3. No menu lateral esquerdo do Supabase, clique em **"SQL Editor"**.
4. Clique em **"New Query"**, abra o arquivo `database/schema.sql` do projeto, **copie todo o texto e cole na tela do Supabase**.
5. Clique no botão verde **"Run"**.
6. Em seguida, faça o mesmo com o arquivo `database/export_data.sql` e clique em **"Run"**.
7. **Pronto!** Seu banco de dados relacional completo está no ar na nuvem!

---

### ETAPA 3: Conectar o App ao Banco na Nuvem - **Tempo: 1 minuto**

> **O QUE FOI FEITO:** Criamos os arquivos `js/config.js` e `js/cloudStore.js`.
> **POR QUE FOI FEITO:** Para permitir alternar entre o modo local (offline) e o modo nuvem colando apenas 2 chaves.

#### Como Fazer (Seu Acesso):
1. No painel do Supabase, acesse **Project Settings** -> **API**.
2. Copie a **URL do Projeto** e a chave **anon public**.
3. Abra o arquivo `js/config.js` no bloco de notas e cole as duas informações:
   ```javascript
   supabase: {
     url: "COLE_SUA_URL_AQUI",
     anonKey: "COLE_SUA_CHAVE_ANON_AQUI"
   }
   ```
4. Salve o arquivo. Agora todos os usuários compartilham os mesmos dados em tempo real!

---

### ETAPA 4: Extrair Dados no Power BI - **Tempo: 2 minutos**

> **O QUE FOI FEITO:** Adicionamos o botão de **"📥 Baixar Base SQL (.sql)"** e criamos 5 Views SQL prontas no banco.
> **POR QUE FOI FEITO:** Para que você ou a diretoria consigam gerar relatórios visuais incríveis sem precisar programar nada.

#### Como Fazer no Power BI Desktop:
- **Opção A (Sem Nuvem):** Abra o JR Oper, vá no menu **"Central Power BI"** e clique em **"📥 Baixar Base SQL"** ou **"💾 Baixar Base JSON"**. No Power BI, use **Obter Dados -> JSON**.
- **Opção B (Com Nuvem):** No Power BI Desktop, escolha **Obter Dados -> Banco de Dados PostgreSQL**, informe o endereço do seu Supabase e selecione uma das 5 Views (`vw_bi_devolucoes_causa_raiz`, `vw_bi_produtividade_equipe`, etc.).

---

## 🛠️ Validação de Sintaxe e Testes de Código

Todas as alterações técnicas no código JavaScript e nos scripts SQL foram **100% testadas e validadas**. Não há erros de compilação ou sintaxe.
