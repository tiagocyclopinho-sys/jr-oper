-- =============================================================================
-- MIGRATION 28 - CUSTODIA DA REENTREGA (recepcao no CD + despacho), com foto
--
-- JA APLICADA no projeto qxipgnkdbzxtfvuyupow em 25/08/2026, junto com a 29 e
-- a 31. Este arquivo existe para o repositorio espelhar o banco e para uma
-- instalacao nova conseguir chegar ao mesmo estado.
--
-- Antes: reentregas_rota tinha 2 estados (PENDENTE -> REALIZADA). O registro
-- dizia que EXISTIA reentrega e quem IA levar, mas entre o motorista voltar
-- com o produto e o produto ser entregue ninguem assinava por ele.
--
-- Agora: 4 estados no caminho feliz, mais o cancelamento.
--
--     PENDENTE -> RECEBIDO_CD -> DESPACHADO -> REALIZADA
--                                           \-> CANCELADA (abre Devolucao SAC)
--
-- Reentrega so existe em carga local de Araguaina - as de outras cidades ja
-- voltam como devolucao - e TODA reentrega passa pelo CD. Por isso nao ha
-- caminho que pule a recepcao.
--
-- Despacho e UNICO por reentrega. O negocio confirmou que dividir em duas
-- remessas pode acontecer mas nao deve, e pediu para tratar como nao. E por
-- isso que os campos de despacho sao COLUNAS e nao tabela filha: se um dia
-- dividir passar a ser permitido, o modelo aqui precisa mudar de forma.
-- =============================================================================

-- --- Recepcao fisica no CD ---------------------------------------------------
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS recebido_cd_em         TIMESTAMP;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS recebido_cd_por        VARCHAR(120);
-- qtd_recebida_cd e separada de entregas_reentrega de proposito: a segunda e o
-- que o motorista DECLAROU na rota, a primeira e o que o CD CONTOU na doca. E
-- justamente onde as duas divergem que esta etapa se paga.
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS qtd_recebida_cd        INT;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS condicao_recebimento   VARCHAR(20);
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS observacao_recebimento TEXT;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS local_armazenagem      VARCHAR(60);

-- --- Despacho para o veiculo (mesmo ou outro) --------------------------------
-- Nao existe despacho_motorista: quem leva continua sendo novo_motorista, que
-- ja existia. Dois campos com o mesmo significado sempre acabam divergindo.
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS despachado_em          TIMESTAMP;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS despachado_por         VARCHAR(120);
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS despacho_placa         VARCHAR(20);
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS despacho_carga_numero  VARCHAR(50);
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS qtd_despachada         INT;

-- --- Fecho e cancelamento ----------------------------------------------------
-- realizada_em nao existia: so havia atualizado_em, que muda a cada edicao e
-- por isso nao serve para medir o ciclo da reentrega.
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS realizada_em           TIMESTAMP;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS cancelada_em           TIMESTAMP;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS cancelada_por          VARCHAR(120);
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS motivo_cancelamento    TEXT;
-- Preenchido quando a Devolucao SAC aberta a partir do cancelamento e salva.
-- A devolucao NAO nasce junto com o cancelamento: ela pede cliente, nota e
-- itens, que o CD nao tem na mao naquele momento.
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS devolucao_gerada_id    BIGINT;

-- --- Novo vocabulario de status ----------------------------------------------
-- O CHECK antigo so aceitava PENDENTE/REALIZADA: sem trocar, todo UPDATE para
-- RECEBIDO_CD seria recusado pelo banco. O nome da constraint varia conforme
-- como a tabela foi criada, entao derrubamos qualquer CHECK que mencione
-- status em vez de chutar o nome.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'reentregas_rota'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE reentregas_rota DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE reentregas_rota ADD CONSTRAINT reentregas_status_check
  CHECK (status IN ('PENDENTE', 'RECEBIDO_CD', 'DESPACHADO', 'REALIZADA', 'CANCELADA'));

ALTER TABLE reentregas_rota ADD CONSTRAINT reentregas_condicao_check
  CHECK (condicao_recebimento IS NULL
         OR condicao_recebimento IN ('OK', 'AVARIA', 'FALTA_PARCIAL'));

CREATE INDEX IF NOT EXISTS idx_reentregas_recebido_em   ON reentregas_rota(recebido_cd_em);
CREATE INDEX IF NOT EXISTS idx_reentregas_despachado_em ON reentregas_rota(despachado_em);

-- As colunas de foto e as travas que as exigem estao na migration 31: a 28
-- nasceu apontando para Supabase Storage e isso foi revisto.
