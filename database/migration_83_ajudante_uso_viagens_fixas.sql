-- =============================================================================
-- MIGRATION 83 — Uso do ajudante na escala + viagens fixas da carne (26/11/2026)
-- =============================================================================
-- Sai com a v7.8.8. Pedido do Tiago em 26/11.
--
-- 1) ajudantes.uso_escala, como o do motorista (migration 69): ROTA ou FIXA.
--    FIXA sai da Disponibilidade e do SOBREAVISO da convocação, mas segue nas
--    sugestões. Gabriel (ajudante do Silvestre na carne) é o único FIXA.
--    Sem NOT NULL nem CHECK, pelo mesmo motivo da 69 (aparelho antigo manda null).
--
-- 2) Viagens fixas: as duas da carne (Silvestre e Gabriel) saem de segunda a
--    sábado e não passam pela Escala nem pelo Fechamento. Uma delas fecha no
--    decorrer do dia e não vem no Fusion da manhã, então as duas já ficam
--    lançadas no Controle de Viagens, sem carga, para o controlador preencher a
--    carga e a saída. Não dá para garantir qual carga é de qual: por isso cada
--    viagem nasce sozinha, sem ligar ao Fusion.
--    Tabela escala_viagens_fixas (só pelo banco, sem tela) e função
--    jr_criar_viagens_fixas(data). pg_cron às 2h de Brasília lança as do
--    próprio dia; domingo não tem. Idempotente: não duplica rota+data.
--
-- Idempotente.
-- =============================================================================

ALTER TABLE ajudantes ADD COLUMN IF NOT EXISTS uso_escala VARCHAR(12) DEFAULT 'ROTA';
UPDATE ajudantes SET uso_escala = 'ROTA' WHERE uso_escala IS NULL;
UPDATE ajudantes SET uso_escala = 'FIXA' WHERE upper(nome) = 'GABRIEL RODRIGUES DOS SANTOS';

CREATE TABLE IF NOT EXISTS escala_viagens_fixas (
    id           SERIAL PRIMARY KEY,
    rota         VARCHAR(120) NOT NULL,
    motorista    VARCHAR(160),
    ajudante     VARCHAR(160),
    placa        VARCHAR(10),
    setor        VARCHAR(10) NOT NULL DEFAULT 'FRIO',
    dias_semana  SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6}',  -- 1 = segunda ... 7 = domingo
    ativo        BOOLEAN NOT NULL DEFAULT TRUE,
    observacao   TEXT
);
ALTER TABLE escala_viagens_fixas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leitura_anon" ON escala_viagens_fixas;
CREATE POLICY "leitura_anon" ON escala_viagens_fixas FOR SELECT TO anon USING (true);

INSERT INTO escala_viagens_fixas (rota, motorista, ajudante, placa, setor, observacao)
SELECT x.rota, 'SILVESTRE LOPES DE ARAUJO', 'GABRIEL RODRIGUES DOS SANTOS', 'RIN7G15', 'FRIO', x.obs
FROM (VALUES ('ARAGUAINA CARNE', 'VIAGEM FIXA DA MANHÃ (lançada sozinha): informe a carga e a saída'),
             ('CARNE TARDE',     'VIAGEM FIXA DA TARDE (lançada sozinha): informe a carga e a saída')) AS x(rota, obs)
WHERE NOT EXISTS (SELECT 1 FROM escala_viagens_fixas f WHERE f.rota = x.rota);

CREATE OR REPLACE FUNCTION public.jr_criar_viagens_fixas(p_data DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  f   RECORD;
  n   INTEGER := 0;
  base BIGINT := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT * 1000;
BEGIN
  FOR f IN SELECT * FROM escala_viagens_fixas
           WHERE ativo AND extract(isodow FROM p_data)::SMALLINT = ANY (dias_semana)
           ORDER BY id
  LOOP
    IF EXISTS (SELECT 1 FROM controle_viagens v
               WHERE v.is_deleted IS NOT TRUE
                 AND left(v.data_saida, 10) = to_char(p_data, 'YYYY-MM-DD')
                 AND upper(trim(v.rota)) = upper(trim(f.rota))) THEN
      CONTINUE;
    END IF;
    n := n + 1;
    INSERT INTO controle_viagens (id, carga, rota, placa, motorista, ajudante, ajudante_2, setor,
                                  data_saida, hora_saida, status_viagem, observacao, is_deleted, atualizado_em)
    VALUES (base + n, '', f.rota, f.placa, f.motorista, f.ajudante, '', f.setor,
            to_char(p_data, 'YYYY-MM-DD'), '', '', f.observacao, FALSE, now());
  END LOOP;
  RETURN n;
END;
$$;

-- 2h de Brasília (5h UTC): lança as viagens fixas do próprio dia (Tiago, 26/11).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'escala-viagens-fixas';
SELECT cron.schedule('escala-viagens-fixas', '0 5 * * *',
  $$SELECT public.jr_criar_viagens_fixas((now() AT TIME ZONE 'America/Sao_Paulo')::date)$$);
