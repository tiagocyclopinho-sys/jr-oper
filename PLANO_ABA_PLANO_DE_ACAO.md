# Aba "Plano de Ação" — plano de implementação

Escrito em **26/11/2026**, com a 7.8.8 no ar. Sai como **v7.9.0** + **migration 84**.
Substitui a planilha `S:\Logistica\01 - LOGISTICA INFORMATIVO\20 - VICTOR HUGO\
Reunião Manutenção Quinzenal\Plano de Ação.xlsx` (estava vazia: começa do zero).

Status: **pronta em 26/11 — migration 84 aplicada e conferida; código testado localmente; falta subir no GitHub.** Decisões de implementação: fotos sobem direto para o bucket (sem mexer no fotoStore.js); Excel com abas AÇÕES e ETAPAS.

---

## 1. Decisões do Tiago (26/11)

| Tema | Decisão |
|---|---|
| Uso | Qualquer ação, de qualquer origem (campo **Origem/Reunião** + data). |
| Menu | **Visão Geral → Plano de Ação**, todos os perfis. Aba em Tratativas do Gestor: **fora por enquanto**. |
| Permissões | Sem travas: todos criam e editam tudo. |
| Responsável | Escolhe entre os usuários cadastrados **ou digita um nome novo**. Quem não tem login aparece numa lista "Pessoas sem acesso", para virar usuário depois. A área **sugere** o responsável, mas dá para trocar. |
| Status | Não iniciada · Em andamento · Aguardando (pede motivo) · Em validação · Realizada · Cancelada. **Atrasada** é calculada pelo app, ninguém marca. |
| Prazo | Ao adiar, guarda o prazo original, o novo e o motivo. Conta quantas vezes a ação foi adiada. |
| Etapas + linha do tempo | As duas, cada uma podendo **abrir e recolher** na tela. |
| Imagens | A qualquer momento, em cada etapa ou atualização; **até 5 por etapa ou atualização**. |
| Filtros | Data (seletor **Início / Prazo / Realizada** + De/Até), Status, Responsável, Área. |
| Cards | Quantidade e % por status, por área e por responsável (com atrasadas). **Respeitam os filtros.** |
| Exportação | **PDF do painel = cards + lista principal** (sem etapas). **PDF de uma ação** (ficha completa) quando precisar. **XLSX** com logo novo e cores (ExcelJS aprovado). |
| Logo | `public/logo_jr_verde.png` (novo) no lugar do antigo da planilha. |

### Área → responsável sugerido (lista inicial, editável)

SAC – Adriana · Rastreamento – Breno · Monitoramento – Cláudio · Faturamento –
Luizinho · Manutenção – Leonardo · Compras – David Palhares · Supervisão – Victor
Hugo · Gerência – Paulo · Gerência CD – Robinho · Supervisão CD - Frio – Gustavo ·
Supervisão CD - Seco – Marquinhos · Analista – Tiago · Mont. Cargas – Lucas ·
Tecnologia – Rusívell.

---

## 2. Regras de cálculo

- **Atrasada:** status *Não iniciada* ou *Em andamento* com prazo menor que hoje.
  *Aguardando* com prazo vencido **não** vira Atrasada (é justamente o que separa
  "travada por terceiro" de "devendo"); aparece como "Aguardando · prazo vencido".
  *Em validação*, *Realizada* e *Cancelada* nunca atrasam.
- **Tempo (dias)**, igual à planilha: em aberto = prazo − hoje; realizada = prazo −
  data realizada; cancelada = vazio. Cores: verde > 2, amarelo 0 a 2, vermelho < 0.
- **Progresso** = etapas realizadas ÷ etapas (canceladas fora). Sem etapas, não mostra.
- Marcar a ação como *Realizada* com etapa aberta: só **avisa**, não impede.
- **Código** da ação: `PA-001`, `PA-002`… gerado pelo banco (sequência), para dois
  aparelhos não criarem o mesmo número.

---

## 3. Banco — migration 84 (idempotente)

| Tabela | O que guarda |
|---|---|
| `pa_acoes` | numero, origem, origem_data, acao (o quê), descricao (como), local (onde), area, responsavel_nome, responsavel_usuario_id (vazio = pessoa sem login), inicio, prazo_original, prazo, qtd_adiamentos, data_realizada, status, motivo_status, criado_por/em, atualizado_por/em, is_deleted |
| `pa_etapas` | acao_id, ordem, descricao, responsavel_nome/usuario_id, prazo, status, data_realizada, fotos_paths, is_deleted |
| `pa_eventos` | linha do tempo, **só inclusão**: acao_id, etapa_id, tipo (CRIACAO, STATUS, PRAZO, ETAPA, COMENTARIO, EDICAO), de, para, motivo/texto, fotos_paths, autor, criado_em |
| `pa_areas` | area, responsavel_sugerido, ativo (a lista acima já entra semeada) |

- Bucket novo **`plano-acao-fotos`** (público, ~2 MB, só imagem), no mesmo modelo das
  migrations 41/80. O banco guarda só o caminho da foto, nunca base64.
- Policies anon iguais às do Cross Palmas (migration 81).
- `atualizado_em` sempre no horário de Brasília (lição da guarda da Escala).

**Por que tabelas próprias e gravação direta, como o Cross Palmas:** a tela lê da
nuvem quando abre (e relê a cada 2 min) e grava direto no Supabase. Não entra no
pull do `cloudStore` nem no localStorage. Assim não pesa no egress nem na cota do
aparelho, e um aparelho com versão velha não sobrescreve nada.
**Consequência:** para salvar precisa de internet (é uso de escritório).

---

## 4. Telas (`js/planoAcao.js`, módulo novo)

1. **Painel**
   - Filtros no topo + busca por texto e Origem.
   - Três faixas de cards: status, área e responsável (com atrasadas). Clicar num card aplica o filtro.
   - Lista principal com as colunas da planilha (Ação, Como, Área, Responsável, Onde, Início, Prazo, Realizada, Status, Tempo) e o progresso das etapas.
   - Botões **+ Nova ação**, **PDF**, **Excel**, **Áreas** (edita a lista de área → responsável) e **Pessoas sem acesso**.
2. **Ficha da ação** (o rascunho mostrado na conversa)
   - Cabeçalho com status, área, responsável, prazo (com o original, se adiado) e progresso.
   - **Etapas** (recolhível): + Etapa, cada uma com responsável, prazo, status e fotos.
   - **Linha do tempo** (recolhível): eventos automáticos + atualização livre com até 5 fotos.
   - Botões: mudar status (Aguardando pede motivo), **Adiar prazo** (pede motivo), Editar, Excluir (exclusão lógica), **Imprimir esta ação**.

## 5. Exportações

- **PDF do painel** (html2pdf, que já está no app): logo novo, título, filtros aplicados, cards e lista principal.
- **PDF da ação:** ficha + etapas + linha do tempo + miniaturas das fotos.
- **XLSX** (ExcelJS em `js/exceljs.min.js`, carregado **só na hora de exportar**, para não pesar na abertura do app):
  - aba *Ações*, no layout da planilha antiga com logo novo, cores de status e de Tempo;
  - aba *Etapas* com as etapas de cada ação.

---

## 6. Arquivos que mudam

`database/migration_84_plano_de_acao.sql` (novo) · `js/planoAcao.js` (novo) ·
`js/exceljs.min.js` (novo) · `js/app.js` (menu + rota) · `js/fotoStore.js` (módulo
`planoacao` → bucket) · `index.html` (script) · versão 7.9.0 nos 4 lugares
(`js/config.js`, `js/cloudStore.js`, `sw.js`, `version.json`).

## 7. Ordem

1. Aplicar a migration 84 no JR-OPER e conferir as tabelas e o bucket.
2. Escrever o módulo e testar localmente (criar, etapa, foto, adiar, filtros, cards, PDF, Excel).
3. Ritual de versão + `node --check`.
4. Tiago sobe no GitHub; limpar o cache dos aparelhos.
