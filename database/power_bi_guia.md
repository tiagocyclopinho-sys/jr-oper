# 📊 Guia Completo de Conexão Power BI - JR Oper & Logística Corporativa

Este guia foi elaborado para **gestores, analistas e diretores** da **JR Distribuidora** que desejam conectar o **Power BI Desktop** aos dados operacionais do sistema com **Custo Zero**.

---

## 🚀 3 Métodos de Conexão (Escolha o ideal para o seu momento)

---

### MODO 1: Conexão Direta com Banco na Nuvem (PostgreSQL / Supabase)
*(Ideal para atualização automática diária / tempo real no Power BI Web e Mobile)*

1. Abra o **Power BI Desktop**.
2. Clique em **Obter Dados** -> **Banco de Dados PostgreSQL**.
3. No campo **Servidor**, cole o Host fornecido pelo Supabase (Ex: `db.xyzcompany.supabase.co`).
4. No campo **Banco de dados**, digite `postgres`.
5. Selecione o modo:
   - **Importar**: Carrega os dados para a memória (Mais rápido para gráficos e dashboards).
   - **DirectQuery**: Atualiza instantaneamente a cada clique no gráfico.
6. Em autenticação, informe o usuário `postgres` e a senha definida na criação do Supabase.

---

### MODO 2: Extração em 1 Clique pelo Próprio Aplicativo (SQL Nativo)
*(Ideal para quando você rodar o sistema localmente ou quiser gerar um backup completo em SQL)*

1. No menu lateral do **JR Oper**, clique em **"📊 Conector Power BI"**.
2. Clique no botão verde: **"📥 Baixar Banco de Dados Completo em SQL (.sql)"**.
3. O sistema gerará um arquivo `.sql` contendo todas as tabelas (`ocorrencias_devolucao`, `ocorrencias_rota`, `substituicoes_veiculos`).
4. Você pode rodar esse arquivo no **PostgreSQL local**, **DBeaver** ou **Supabase SQL Editor** para atualizar seu banco imediatamente!

---

### MODO 3: Carga Direta em JSON (Sem Banco de Dados)
1. No menu **"📊 Conector Power BI"**, clique em **"Exportar JSON"**.
2. No Power BI Desktop, escolha **Obter Dados** -> **JSON**.
3. Selecione o arquivo baixado e pronto! O Power BI lerá todas as tabelas automaticamente.

---

## 💡 Views Pré-Construídas Prontas para Uso

O banco de dados disponibiliza 5 Views SQL otimizadas em 3FN:

1. **`vw_bi_produtividade_equipe`**: Total de avarias (R$), erros de separação, falhas de conferência e pontos descontados por colaborador.
2. **`vw_bi_devolucoes_causa_raiz`**: Comparativo entre Motivo Reclamado vs. Causa Raiz Real identificada pelo SAC.
3. **`vw_bi_frota_veiculos_parados`**: Tempo total de inatividade (horas paradas) e custos de socorro mecânico em rota.
4. **`vw_bi_controle_cd_pendencias`**: Auditoria de devoluções físicas pendentes de chegada no Centro de Distribuição.
5. **`vw_bi_trocas_veiculos`**: Rastreamento de substituição de veículos escalados por motivo (peso excedido, manutenção) e autorizador.
