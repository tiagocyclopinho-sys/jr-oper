-- =============================================================================
-- MIGRACAO 25 - FAXINA DO CONTROLE DE VIAGENS E CHAVE NATURAL (22/08/2026)
--
-- Implementa a ETAPA 1 do GO_LIVE.md. Dimensionada pela ETAPA 0, que mediu
-- o banco em 22/08/2026: das 331 linhas de controle_viagens,
--   247 sao FANTASMAS   (data_saida guardando estado de checklist)
--    44 sao DUPLICATAS  (15 cargas importadas ate 4x)
--   ~39 sao viagens reais e unicas
--
-- PRE-REQUISITO, e nao e formalidade: TODO aparelho tem que estar na build
-- nova antes de rodar isto. Os fantasmas tem id estavel e o envio usa
-- Prefer: resolution=merge-duplicates - um aparelho com cache anterior
-- reenvia as mesmas linhas e desfaz a faxina no ciclo seguinte, inclusive
-- o is_deleted. Confira em Governanca -> Aparelhos que os tres aparelhos
-- da frota aparecem em sync-4.8.1. A guarda de escrita da 4.8.0+ e o que
-- torna esta limpeza definitiva.
--
-- NADA E APAGADO FISICAMENTE. Tudo aqui e is_deleted = true, reversivel com
-- um UPDATE. Existe um unico DELETE no sistema inteiro e ele so roda no
-- Reset Global.
--
-- Rode este arquivo inteiro no SQL Editor do Supabase. E idempotente.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------
-- 25.1  EXPURGO DOS FANTASMAS
--
-- A impressao digital veio da ETAPA 0: 247 linhas com data_saida em
-- ('INICIADO','NAO INICIADO') e status_viagem = 'FIN. NORMAL'. Nesta build
-- esses dois valores sao legitimos, mas de OUTROS campos (fusion,
-- checklist_saida, checklist_chegada). E assinatura de uma build antiga
-- gravando com o mapeamento de coluna trocado - os dois vocabularios nunca
-- se misturaram em 331 registros, o que da um teste deterministico.
--
-- Os ids sao pequenos e sequenciais (42218-42222), nada parecido com o
-- Date.now() das builds atuais: confirma origem em build antiga, mas nao
-- diz QUAL aparelho, e isso deixou de importar - a guarda de escrita
-- impede qualquer aparelho na 4.8.0+ de reenviar fantasma.
-- -----------------------------------------------------------------------
UPDATE controle_viagens
   SET is_deleted      = TRUE,
       deleted_at      = now(),
       deleted_by_nome = 'MIGRACAO 25 - FANTASMA (ETAPA 0)'
 WHERE is_deleted IS NOT TRUE
   AND data_saida IN ('INICIADO', 'NÃO INICIADO', 'NAO INICIADO');

-- -----------------------------------------------------------------------
-- 25.2  DUPLICATAS DE IMPORTACAO
--
-- Decisao 1 de 22/08: uma carga nao sai em duas datas nem em dois veiculos.
-- Toda carga repetida e duplicidade, sem excecao - inclusive os 5 pares
-- PALMAS, que a ETAPA 0 mostrou serem Forma B (fantasma) e ja saem no 25.1.
--
-- Mantem a linha de MENOR id de cada grupo (a lancada primeiro) e marca as
-- demais. Como as copias sao identicas em data e placa, nao ha escolha a
-- fazer: nenhuma revisao manual e necessaria.
--
-- Roda DEPOIS do 25.1 de proposito: assim o "menor id" e escolhido entre as
-- linhas reais, e nao entre fantasmas ja expurgados.
-- -----------------------------------------------------------------------
WITH ranqueadas AS (
  SELECT id,
         row_number() OVER (PARTITION BY carga ORDER BY id ASC) AS posicao
    FROM controle_viagens
   WHERE is_deleted IS NOT TRUE
     AND coalesce(carga, '') <> ''
)
UPDATE controle_viagens cv
   SET is_deleted      = TRUE,
       deleted_at      = now(),
       deleted_by_nome = 'MIGRACAO 25 - DUPLICATA DE IMPORTACAO'
  FROM ranqueadas r
 WHERE cv.id = r.id
   AND r.posicao > 1;

-- -----------------------------------------------------------------------
-- 25.3  CONSERTO DO criado_em
--
-- A ETAPA 0 achou 24 linhas com criado_em nulo, todas reais - por isso ele
-- nao podia sustentar a paginacao (que ficou no id) e precisa ser
-- consertado para a janela operacional.
--
-- ATENCAO A FORMULA. O GO_LIVE.md trazia to_timestamp(id / 1000.0), "porque
-- o id e o Date.now() do aparelho". Isso vale so para ids gerados ate
-- 20/08/2026. De la para ca, gerarIdUnico() devolve Date.now() * 1000 +
-- carimbo do aparelho - mil vezes maior. Aplicar id/1000 num id desses da
-- um carimbo no ano 57000, e a linha nunca mais sairia de nenhuma janela de
-- tempo. Os dois formatos convivem na mesma coluna e se distinguem pela
-- ordem de grandeza (~1,7e12 contra ~1,7e15).
-- -----------------------------------------------------------------------
UPDATE controle_viagens
   SET criado_em = to_timestamp(
         CASE WHEN id > 1e14 THEN id / 1000000.0   -- gerarIdUnico(): ms * 1000 + carimbo
              ELSE id / 1000.0                     -- Date.now() puro
         END)
 WHERE criado_em IS NULL;

ALTER TABLE controle_viagens ALTER COLUMN criado_em SET DEFAULT now();

-- SET NOT NULL so depois do backfill acima, senao a migracao falha aqui.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM controle_viagens WHERE criado_em IS NULL) THEN
    ALTER TABLE controle_viagens ALTER COLUMN criado_em SET NOT NULL;
  ELSE
    RAISE NOTICE 'criado_em ainda tem nulos - NOT NULL nao aplicado. Investigue antes de seguir.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 25.4  CHAVE NATURAL SOBRE carga
--
-- E esta constraint que passa a barrar duplicidade NO BANCO, em vez de
-- depender de uma checagem em JavaScript que so enxerga o cache do proprio
-- aparelho - que foi o que deixou a importacao rodar quatro vezes.
--
-- PARCIAL de proposito, pelo mesmo motivo da migration_24: em Postgres
-- varios NULL convivem numa coluna unica, mas varias strings VAZIAS nao.
-- Um UNIQUE simples derrubaria o lote inteiro na primeira viagem sem numero
-- de carga. E ignorar as excluidas e o que permite excluir uma viagem
-- lancada errada e reimportar a carga certa.
--
-- Roda DEPOIS de 25.1 e 25.2: criar o indice com duplicatas ainda vivas faz
-- a migracao inteira falhar e dar rollback.
-- -----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_controle_viagens_carga
    ON controle_viagens (carga)
 WHERE is_deleted IS NOT TRUE AND coalesce(carga, '') <> '';

-- -----------------------------------------------------------------------
-- 25.5  ocorrencias_viagens.viagem_id  (decisao 9)
--
-- Hoje o vinculo entre ocorrencia e viagem e so copia de texto (carga, rota,
-- placa). Esta coluna cria a ligacao de verdade.
--
-- DESVIO DELIBERADO DO GO_LIVE.md, e o motivo importa: a decisao 9 pedia
-- "BIGINT REFERENCES controle_viagens(id)". A coluna entra, a FK NAO.
--
-- Em 22/08 passamos o dia consertando exatamente esse tipo de dano: a unica
-- tabela do schema que ainda tinha integridade referencial (sinistros) era a
-- unica cuspindo 23503, porque apontava para uma ocorrencia que a nuvem nao
-- tinha. A migration_22 ja havia derrubado praticamente todas as FKs do
-- schema justamente porque a sincronizacao nao tem como honra-las: o envio
-- e por tabela, o cache de cada aparelho e parcial, e o POST do PostgREST e
-- transacional - um filho orfao derruba o lote inteiro, para sempre.
--
-- Criar uma FK nova agora seria plantar o proximo 23503 numa tabela que
-- acabou de voltar a funcionar. O indice abaixo da o beneficio de consulta
-- que a decisao 9 queria, sem o risco. Se um dia o sync passar a ser
-- transacional entre tabelas, a FK entra numa linha.
-- -----------------------------------------------------------------------
ALTER TABLE ocorrencias_viagens ADD COLUMN IF NOT EXISTS viagem_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_ocorrencias_viagens_viagem_id
    ON ocorrencias_viagens (viagem_id);

-- Backfill pelo unico vinculo que existe hoje: o numero da carga. So liga a
-- viagens vivas, e so quando ha exatamente uma candidata - depois de 25.4
-- isso e garantido para toda carga preenchida.
UPDATE ocorrencias_viagens ov
   SET viagem_id = cv.id
  FROM controle_viagens cv
 WHERE ov.viagem_id IS NULL
   AND cv.is_deleted IS NOT TRUE
   AND coalesce(ov.carga, '') <> ''
   AND cv.carga = ov.carga;

-- -----------------------------------------------------------------------
-- 25.6  atualizado_em NAS TRANSACIONAIS
--
-- Estava no plano para sustentar a mesclagem por registro da Onda 1. Vale
-- registrar que essa justificativa caducou: o item 2 acabou implementado
-- com hash do registro, e nao com carimbo de tempo, por dois motivos - a
-- coluna so nasceria aqui (bloqueando o item por uma etapa posterior) e
-- comparar relogio entre aparelhos exige que eles concordem, o que celular
-- com hora errada nao garante.
--
-- Entra assim mesmo porque a sincronizacao incremental (mandar so o que
-- mudou desde a ultima leitura, em vez da tabela toda) depende dela, e e o
-- proximo teto depois do de 1.000 linhas. Coluna aditiva e nula: nenhum
-- codigo atual escreve ou le, entao nao muda comportamento nenhum.
-- -----------------------------------------------------------------------
ALTER TABLE controle_viagens    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE ocorrencias_viagens ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE ocorrencias_rota    ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE itens_devolucao     ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE retencoes_frota     ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE reentregas_rota     ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;
ALTER TABLE trocas_veiculos     ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ;

-- -----------------------------------------------------------------------
-- 25.7  INDICES DE APOIO PARA A JANELA OPERACIONAL
--
-- NAO indexar data_saida: a ETAPA 0 mostrou que ela guarda estado de
-- checklist em 75% das linhas e, no resto, data em dois formatos. Indice ali
-- nao serve para janela nenhuma enquanto o campo nao for normalizado.
-- -----------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_controle_viagens_criado_em    ON controle_viagens (criado_em);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_viagens_criado_em ON ocorrencias_viagens (criado_em);

COMMIT;

-- =============================================================================
-- CONFERENCIA OBRIGATORIA - rode DEPOIS, separado.
-- Esperado: 1, 1, 1, 0, 0, 0  e viagens_vivas por volta de 39.
-- =============================================================================
-- SELECT
--   (SELECT count(*) FROM pg_indexes
--     WHERE tablename='controle_viagens'
--       AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%carga%')          AS chave_natural,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='ocorrencias_viagens' AND column_name='viagem_id')  AS coluna_viagem_id,
--   (SELECT count(*) FROM information_schema.columns
--     WHERE table_name='controle_viagens' AND column_name='atualizado_em') AS coluna_atualizado_em,
--   (SELECT count(*) FROM controle_viagens WHERE criado_em IS NULL)        AS criado_em_nulos,
--   (SELECT count(*) FROM controle_viagens
--     WHERE is_deleted IS NOT TRUE
--       AND data_saida IN ('INICIADO','NÃO INICIADO','NAO INICIADO'))      AS fantasmas_restantes,
--   (SELECT count(*) FROM (
--      SELECT carga FROM controle_viagens
--       WHERE is_deleted IS NOT TRUE AND coalesce(carga,'') <> ''
--       GROUP BY carga HAVING count(*) > 1) d)                             AS cargas_duplicadas,
--   (SELECT count(*) FROM controle_viagens WHERE is_deleted IS NOT TRUE)   AS viagens_vivas;
--
-- fantasmas_restantes > 0 depois disto significa que ALGUM aparelho esta
-- reenviando cache contaminado: pare, ache o aparelho fora da 4.8.1 na tela
-- de Governanca -> Aparelhos, e so entao rode a faxina do 25.1 de novo.
