# 📄 PROPOSTA TÉCNICA DE INFRAESTRUTURA, CAPACIDADE EM NUVEM E CUSTOS
## Sistema Integrado de Operações Logísticas — JR Oper
**Empresa:** JR Distribuidora  
**Setor Responsável:** Logística & Operações  
**Data:** 14 de Agosto de 2026  
**Versão:** 1.0  

---

### 1. RESUMO EXECUTIVO

Esta proposta técnica detalha o dimensionamento de infraestrutura, capacidade de armazenamento de banco de dados, gestão de mídias (fotos e vídeos) e projeção de custos do **JR Oper (Sistema Integrado de Operações Logísticas)**.

A arquitetura foi projetada sob o princípio de **Eficiência Máxima e Custo Zero Inicial (R$ 0,00)**, garantindo estabilidade, segurança e suporte à integração dos setores de **SAC, Centro de Distribuição (CD), Financeiro e Gestão de Frota**.

---

### 2. ARQUITETURA TECNOLÓGICA ADOTADA

| Componente | Plataforma | Finalidade | Custo Inicial |
| :--- | :--- | :--- | :--- |
| **Hospedagem Web & PWA** | **Vercel** | Publicação do sistema na nuvem com link criptografado (HTTPS) acessível por PC e celulares. | **R$ 0,00** (Gratuito) |
| **Repositório de Código** | **GitHub** | Versionamento seguro, histórico de alterações e deploy automatizado. | **R$ 0,00** (Gratuito) |
| **Banco de Dados Relacional & Mídias** | **Supabase (PostgreSQL)** | Armazenamento de dados transacionais em tempo real e arquivos anexados (fotos/vídeos). | **R$ 0,00** (Plano Free) |
| **Camada de Inteligência / BI** | **Microsoft Power BI** | Painéis gerenciais conectados diretamente às Views SQL do banco de dados. | **R$ 0,00** (Desktop) |

---

### 3. DIMENSIONAMENTO DA CAPACIDADE: PLANO GRATUITO (FREE TIER)

O sistema inicia sua operação corporativa no plano gratuito do **Supabase**, cujos limites atendem com folga a rotina operacional inicial da empresa.

#### A. Capacidade de Dados Estruturados (Tabelas e Textos)
* **Limite Disponível:** 500 MB de armazenamento em disco PostgreSQL.
* **Volume Médio por Registro:** Uma ocorrência completa com itens, motorista, cliente, causa raiz e auditoria consome cerca de **1,5 KB** a **2,0 KB**.
* **Capacidade Prática:** Mais de **250.000 a 300.000 ocorrências** cadastradas.
* **Autonomia Estimada:** Superior a **3 a 5 anos de operação** ininterrupta apenas para dados tabulares.

#### B. Capacidade de Mídias (Fotos de Avarias, Comprovantes e Vídeos de Rota)
* **Limite Disponível:** 1,0 GB de armazenamento de arquivos + 2,0 GB de transferência mensal.
* **Comportamento das Imagens:**
  * Foto bruta de celular: ~3 MB a 5 MB por foto.
  * Foto otimizada/comprimida pelo sistema: ~100 KB a 150 KB por foto.
* **Capacidade Prática:**
  * **Com imagens otimizadas:** Suporta entre **7.000 e 10.000 fotos de ocorrências** no plano gratuito.
  * **Com vídeos curtos (10-15s):** Suporta cerca de **30 a 50 vídeos** simultâneos de socorro mecânico.

---

### 4. DIRETRIZES OPERACIONAIS DE GOVERNANÇA DE MÍDIAS

Para preservar o custo zero sem comprometer a visibilidade operacional da diretoria e dos setores:

1. **Compressão Automática:** O sistema redimensiona fotos capturadas pela câmera ou galeria para resolução HD otimizada antes do envio, reduzindo o tamanho em até 95% sem perda de legibilidade de notas fiscais ou avarias.
2. **Vídeos Críticos:** Uso restrito a situações essenciais (ex.: socorro mecânico de veículos ou avarias complexas no CD), priorizando durações curtas de até 15 segundos.
3. **Política de Backup e Arquivamento Histórico:** O sistema conta com ferramentas nativas de exportação (Power BI, JSON, SQL e Excel) permitindo o arquivamento periódico de ocorrências antigas resolvidas.

---

### 5. PLANO DE ESCALABILIDADE E PROJEÇÃO DE CUSTOS (SE HOUVER NECESSIDADE)

Caso a operação atinja volumes muito elevados de mídias pesadas ou a diretoria decida manter anos de arquivos em altíssima definição sem qualquer rotina de expurgo, o upgrade é simples, transparente e de baixo custo corporativo.

#### Tabela Comparativa de Planos (Supabase):

| Recurso | Plano Free (Atual) | Plano Pro (Expansão) |
| :--- | :--- | :--- |
| **Custo Mensal** | **R$ 0,00** | **US$ 25 / mês (~R$ 135 a R$ 145)** |
| **Armazenamento de Banco de Dados** | 500 MB | **8 GB** (16x mais) |
| **Armazenamento de Fotos e Vídeos** | 1 GB | **100 GB** (100x mais) |
| **Transferência de Dados Mensal** | 2 GB / mês | **250 GB / mês** |
| **Pausa por Inatividade** | Após 7 dias sem uso | **Nunca pausa (100% 24/7)** |
| **Backups Automáticos** | Manuais via exportação | **Backups diários automáticos retidos por 7 dias** |
| **Custo por GB adicional (se passar de 100 GB)** | Não aplicável | US$ 0,021 por GB (~R$ 0,11 / GB) |

---

### 6. ANÁLISE DE CUSTO-BENEFÍCIO E RETORNO SOBRE O INVESTIMENTO (ROI)

* **Referência de Mercado (Valores Conservadores):** Implantação em torno de **R$ 20.000 a R$ 25.000** com mensalidades de suporte de **R$ 1.500 a R$ 2.000 / mês** (R$ 18.000 a R$ 24.000 / ano).
* **Custo do JR Oper para a JR Distribuidora:** **R$ 0,00 de licença** e **R$ 0,00 de infraestrutura inicial**.
* **Economia Direta no 1º Ano:** Mais de **R$ 45.000,00 economizados no caixa**, com a vantagem de integrar não apenas o estoque, mas toda a operação (SAC, CD, Financeiro e Frota).
* **Retorno Imediato:**
  * Redução de avarias não identificadas através do cruzamento CD × Separador × Conferente.
  * Agilidade no acerto financeiro de boletos e NFs de devolução.
  * Monitoramento em tempo real do tempo de veículos parados em rota.
  * Mesmo no cenário de adoção do Plano Pro futuro (~R$ 140/mês), o valor é irrisório perante a economia gerada ao evitar uma única perda de carga ou glosa fiscal.

---

### 7. RECOMENDAÇÃO TÉCNICA FINAL

1. **Aprovação Imediata da Implantação:** Iniciar a operação em **Plano Gratuito (Custo Zero)**.
2. **Monitoramento Mensal:** A equipe de Logística acompanhará a volumetria de armazenamento diretamente no painel administrativo do Supabase (`Settings ➔ Usage`).
3. **Gatilho de Upgrade:** Somente solicitar a contratação do plano Pro de US$ 25/mês caso o consumo de mídias ultrapasse 80% da cota gratuita ou haja solicitação expressa da Diretoria para retenção ilimitada de vídeos de alta resolução.

---

**Elaborado por:** Analista de Logística / Responsável pelo Projeto  
**Aprovado por:** Diretoria de Operações & Logística  
