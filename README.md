# 🚚 JR SAC & Gestão Logística Corporativa

> Sistema corporativo interno desenvolvido sob medida para a **JR Distribuidora**, em substituição ao GLPI.
> Integra os processos de **SAC Interno (Devoluções)**, **Investigação de Causa Raiz**, **Centro de Distribuição (CD)**, **Manutenção de Frota (Ocorrências em Rota)** e **Modelagem de Dados Relacional para o Power BI**.

![Ícone Minimalista JR SAC](public/icon-512.png)

---

## 🌟 Como Executar a Aplicação (Fácil e Rápido)

Como você mencionou que não possui grande conhecimento técnico em programação, o sistema foi projetado para rodar de forma **simples e sem necessidade de instalações complexas**:

### 1. No seu Computador (Windows / Mac):
1. Navegue até a pasta do projeto: `s:\Logistica\02 - ANALISTA DE LOGÍSTICA\Aplicativos criados por mim\jr-sac\`
2. Dê **dois cliques no arquivo `index.html`**.
3. O sistema abrirá imediatamente no seu navegador (**Microsoft Edge**, **Google Chrome** ou **Brave**) com 100% das telas e recursos funcionando!

### 2. Instalação como App no Celular ou Windows (PWA / APK):
- Ao abrir o sistema no navegador, você verá um botão amarelo no topo: **"📱 Instalar PWA / APK"**.
- Clique nele para instalar o **JR SAC** diretamente como um aplicativo nativo na sua área de trabalho ou na tela inicial do celular!

---

## 🔑 Perfis de Acesso para Testes (Quick Login)

Na tela de Login, há 4 botões de acesso rápido com dados pré-carregados para você testar cada perfil:

1. **🟢 SAC / Operação** (`sac@jrdistribuidora.com.br`)
   - Abertura de devoluções com busca de cargas, notas fiscais, clientes e lista relacional dinâmica de produtos.
2. **🟠 Centro de Distribuição - CD** (`cd@jrdistribuidora.com.br`)
   - Alerta visual de retorno físico pendente, recebimento no galpão e destinação (Estoque, Avaria, Devolução Fornecedor, Retrabalho).
3. **🔵 Financeiro & Comercial** (`financeiro@jrdistribuidora.com.br`)
   - Visualização de notas fiscais de devolução e formas de acerto (Abatimento no Boleto vs. JR Paga Diferença).
4. **🔴 Manutenção / Frota** (`manutencao@jrdistribuidora.com.br`)
   - Painel de emergência na rota. **Alerta Crítico Vermelho de "Veículo Parado"** que só desativa quando o mecânico resolve o chamado!

---

## 📊 Estrutura Relacional para o Power BI

O banco de dados do sistema foi modelado na **Terceira Forma Normal (3FN)** no arquivo [`database/schema.sql`](database/schema.sql).

### Tabelas Principais:
- `usuarios` e `setores`: Amarração de responsabilidade direta por setor.
- `ocorrencias_devolucao` e `itens_devolucao`: Relacionamento 1:N permitindo múltiplos produtos por chamado.
- `ocorrencias_rota`: Registro de veículos parados e custeio de socorros mecânicos.
- `auditoria_produtividade`: Cruzamento de falhas de separação e conferência com desconto de pontos.

### Views SQL Pré-Construídas para o Power BI:
1. `vw_bi_produtividade_equipe`: Relatórios de desempenho por Separador e Conferente.
2. `vw_bi_devolucoes_causa_raiz`: Análise comparativa entre o motivo do cliente e a causa raiz real.
3. `vw_bi_frota_veiculos_parados`: Tempo de inatividade (horas paradas) e custo de manutenção.
4. `vw_bi_controle_cd_pendencias`: Painel de devoluções físicas pendentes de chegada no CD.

---

## 📂 Estrutura dos Arquivos do Projeto

```
jr-sac/
├── index.html                  <- Arquivo principal (Dê 2 cliques para abrir o app!)
├── manifest.json               <- Configurações para instalação do App (PWA / APK)
├── sw.js                       <- Service Worker para funcionamento offline
├── README.md                   <- Este guia de instruções
├── database/
│   ├── schema.sql              <- Script SQL relacional completo para PostgreSQL / Supabase
│   └── power_bi_guia.md        <- Passo a passo de conexão com o Power BI Desktop
├── public/
│   ├── icon-512.png            <- Ícone Minimalista JR SAC (Verde com letras brancas)
│   └── logo.png                <- Logo para o cabeçalho corporativo
└── js/
    ├── app.js                  <- Controlador principal da interface e telas
    ├── store.js                <- Gerenciador do Banco de Dados Relacional local
    └── mockData.js             <- Dados iniciais de teste da JR Distribuidora
```

---

## 💡 Dúvidas ou Sugestões?
O projeto está 100% pronto para uso, testes e demonstração gerencial na **JR Distribuidora**!
