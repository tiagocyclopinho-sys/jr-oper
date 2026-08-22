# 🚚 JR Oper — Gestão Logística Integrada

> Sistema corporativo interno da **JR Distribuidora**, em substituição ao GLPI.
> Integra **SAC Interno (Devoluções)**, **Investigação de Causa Raiz**,
> **Centro de Distribuição**, **Transporte e Frota** e a **modelagem de dados
> para o Power BI**.

![Ícone JR Oper](public/icon-512.png)

---

## Estado atual — leia antes de usar

| Módulo | Situação |
|---|---|
| SAC / Devoluções | ✅ Em operação, sincronizando entre aparelhos |
| Centro de Distribuição | ✅ Em operação, sincronizando |
| Financeiro / Acertos | ✅ Em operação, sincronizando |
| **Transporte e Frota** | ⚠️ **Em correção** — ver [`GO_LIVE.md`](GO_LIVE.md) |

A sincronização do módulo de **Transporte** está com defeitos identificados em
22/08/2026: registros excluídos que voltam sozinhos, edições de um aparelho
sobrescrevendo as de outro, e cadastros antigos reinjetados por máquinas com
versão desatualizada do app.

**Enquanto a correção não sai:** o dado nunca se perde no aparelho que o criou
— tudo é gravado localmente primeiro. O risco é de **divergência entre
aparelhos**, não de perda. Confira o indicador da nuvem no cabeçalho antes de
confiar num número que veio de outra máquina.

O diagnóstico completo, as decisões tomadas e o passo a passo da implantação
estão em **[`GO_LIVE.md`](GO_LIVE.md)**.

---

## Como executar

O sistema não precisa de instalação, servidor local nem compilação.

- **No navegador:** abra o endereço publicado (Vercel/Netlify).
- **Como aplicativo:** ao abrir o sistema, aparece o botão amarelo
  **"📱 Instalar PWA / APK"** no topo. Ele instala o JR Oper como aplicativo
  nativo na área de trabalho ou na tela inicial do celular.
- **Sem internet:** o app continua funcionando e gravando no aparelho. A
  sincronização retoma sozinha quando a conexão voltar.

### Indicador da nuvem (cabeçalho)

| Indicador | Significa |
|---|---|
| 🟢 **Nuvem Ativa** | Conectado e gravando no banco |
| 🔴 **Dados NÃO salvos na nuvem** | O banco recusou alguma gravação. Os dados estão salvos **só neste aparelho**. Passe o mouse por cima para ler o erro |
| 🟡 **Conectando** | Tentando conectar |
| ⚫ **Modo Local** | Sem banco configurado — nada é compartilhado |

Para o detalhe técnico de uma falha, abra o console (F12) e rode:

```
jrDiagnosticoSync()
```

Ele mostra a build do aparelho, as tabelas com pendência e o último erro exato.

---

## Perfis de acesso

Cadastro com **nome, senha e departamento**. Departamentos disponíveis:

Analista · Carregamento · Manutenção · Supervisão · Administrativo · SAC ·
Monitoramento · Gerente CD · Gerente Geral

A senha de administrador (exclusão definitiva, Reset Global, telas de
governança) fica centralizada em `js/config.js`.

> ⚠️ A senha de administrador protege **as telas do app**, não o banco. A
> policy do Supabase hoje é aberta para acesso anônimo — dívida técnica
> registrada em [`GO_LIVE.md`](GO_LIVE.md), *Decisões em aberto*.

---

## Como o sistema guarda os dados

Entender isso evita a maior parte dos sustos.

**Três camadas:**

1. **`jr_sac_db`** (localStorage) — a fatia operacional: devoluções, viagens,
   ocorrências, retenções. É o que sincroniza com a nuvem.
2. **`jr_sac_static`** (localStorage) — o catálogo da planilha *Dados SAC*:
   4.010 produtos e 15.139 clientes, embarcados no `js/mockData.js`. Ocupa
   ~2,9 MB e **não passa pela sincronização** — já vem igual em todo aparelho.
3. **Supabase (PostgreSQL)** — o banco compartilhado. A sincronização roda a
   cada 30 segundos, nos dois sentidos.

**Consequências práticas:**

- Se uma lista de produto ou cliente aparecer vazia, não é a planilha que
  sumiu: é o cache da tela. `Ctrl + Shift + R` resolve.
- Um produto ou cliente cadastrado pela tela do app **fica só naquele
  aparelho**. Para todos verem, precisa entrar na planilha *Dados SAC*.
  (Migrar essas duas listas para a nuvem é a próxima onda de trabalho.)
- Campos como "Número da Carga" e "Produto" são `<input list=...>`: viram
  texto livre quando a lista por trás está vazia. Não é defeito do campo — é o
  comportamento padrão do HTML quando a lista de apoio não carregou.

---

## Estrutura relacional e Power BI

O banco foi modelado na **Terceira Forma Normal (3FN)** em
[`database/schema.sql`](database/schema.sql).

### Tabelas principais

- `usuarios` e `setores` — responsabilidade direta por setor
- `ocorrencias_devolucao` e `itens_devolucao` — 1:N, múltiplos produtos por chamado
- `controle_viagens` e `ocorrencias_viagens` — largadas e ocorrências operacionais
- `ocorrencias_rota`, `retencoes_frota`, `trocas_veiculos`, `sinistros` — frota
- `auditoria_produtividade` — falhas de separação e conferência

### Views prontas para o Power BI

Em [`database/schema_views.sql`](database/schema_views.sql):

1. `vw_bi_produtividade_equipe` — desempenho por separador e conferente
2. `vw_bi_devolucoes_causa_raiz` — motivo do cliente × causa raiz real
3. `vw_bi_frota_veiculos_parados` — horas paradas e custo de manutenção
4. `vw_bi_controle_cd_pendencias` — devoluções pendentes de chegada no CD
5. `vw_bi_trocas_veiculos` — trocas de veículo em rota
6. `vw_bi_disponibilidade_frota` — disponibilidade da frota

Passo a passo de conexão: [`database/power_bi_guia.md`](database/power_bi_guia.md).

> As views leem `is_deleted`. Registro na Lixeira não entra em relatório.

---

## Estrutura dos arquivos

```
jr-sac-corrigido/
├── index.html                     <- Aplicação (ponto de entrada)
├── manifest.json                  <- Configuração do PWA
├── sw.js                          <- Service worker (funcionamento offline)
├── vercel.json / netlify.toml     <- Cabeçalhos de cache da hospedagem
├── README.md                      <- Este arquivo
├── GO_LIVE.md                     <- Diagnóstico e roteiro de implantação
├── DEPLOY_GUIDE.md                <- Como publicar
├── Dados SAC.xlsx                 <- Planilha-base (produtos, clientes, frota, equipe)
├── FECHAMENTO.xlsx                <- Modelo da escala importada em Controle de Viagens
├── database/
│   ├── schema.sql                 <- Estrutura completa (PostgreSQL / Supabase)
│   ├── schema_views.sql           <- As 6 views de BI
│   ├── migration_22_fix_sync.sql  <- Colunas ausentes e chaves estrangeiras
│   ├── migration_23_checks_e_reset.sql <- CHECKs e carimbo de reset
│   ├── migration_24_unique_parcial.sql <- UNIQUE que tolera campo em branco
│   ├── export_data.sql            <- Extração de dados
│   └── power_bi_guia.md           <- Conexão com o Power BI Desktop
├── public/                        <- Ícones e logos
├── documents/                     <- Modelos (advertência, suspensão, alíneas)
└── js/
    ├── app.js                     <- Interface e telas (1,3 MB)
    ├── store.js                   <- Banco de dados local e regras de negócio
    ├── cloudStore.js              <- Sincronização com o Supabase
    ├── config.js                  <- Chaves, senha de admin e parâmetros gerais
    ├── mockData.js                <- Catálogo da planilha Dados SAC (3,1 MB)
    ├── tailwind.cdn.js            <- Estilos (embarcado, sem CDN externo)
    └── xlsx.full.min.js           <- Leitura de planilhas (SheetJS)
```

---

## Governança

Na tela de **Configurações / Governança**:

- **Lixeira** — exclusões lógicas, com restauração e exclusão definitiva por senha
- **Conflitos** — colisões de campo único entre aparelhos, para revisão manual
- **Uso de armazenamento** — quanto da cota do navegador já foi consumida
- **Reset Global de Treinamento** — zera os dados operacionais no aparelho **e**
  na nuvem, preservando os cadastros mestre

> ⚠️ O Reset Global é irreversível e afeta **todos os aparelhos**. Antes de
> rodar, confirme que todos estão na mesma versão do app — o roteiro está em
> [`GO_LIVE.md`](GO_LIVE.md), ETAPA 5.

---

## Configuração do banco

URL e chave pública ficam em [`js/config.js`](js/config.js) e podem ser
sobrescritas por aparelho na tela de configuração da nuvem. Sincronização a
cada 30 segundos.

---

## Dúvidas

O diagnóstico técnico, as decisões de arquitetura e o roteiro de implantação
estão em **[`GO_LIVE.md`](GO_LIVE.md)**. Para publicar uma versão nova,
consulte [`DEPLOY_GUIDE.md`](DEPLOY_GUIDE.md).
