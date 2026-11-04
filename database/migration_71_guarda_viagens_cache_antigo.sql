-- =============================================================================
-- MIGRATION 71 - controle_viagens: guarda contra cache antigo (04/11/2026)
-- =============================================================================
-- Aprovada pelo Tiago em 04/11/2026. E protecao do banco: vale para qualquer
-- build de aparelho, sem depender de deploy.
--
-- O DEFEITO
--
-- 04/11, 13:04 (Brasilia). Um PC subiu 39 viagens de 19 e 20/08 (cargas 43412 a
-- 43472), presas no cache dele desde agosto. O NOT NULL de criado_em (migration
-- 25) recusava esse lote por acidente: 24 das 39 tinham o campo nulo. A 6.11.6
-- passou a preencher criado_em no envio e o lote entrou.
--
-- A migration 25 nao pegava este caso. Ela barra carga repetida e data_saida
-- com vocabulario de checklist. Estas viagens tinham carga unica e data valida.
-- Faltava uma regra para "registro velho que a nuvem nao tem".
--
-- O QUE ESTA MIGRATION FAZ
--
-- 1) Guarda, so para gravacoes vindas da API (o app). SQL manual nao passa nela.
--    INSERT: viagem nova com id de mais de 7 dias e ignorada. O id e o relogio
--    do aparelho na criacao. Nas 975 viagens do banco, a unica folga acima de
--    3 dias entre o id e o criado_em eram 24 destas 39.
--    UPDATE: desfazer exclusao so passa com carimbo mais novo que o do banco,
--    que e o caso da restauracao de verdade.
--
--    Ignora sem dar erro, como a migration 45: erro derrubaria o lote inteiro.
--    O aparelho recebe 200, e no pull seguinte descarta a linha sozinho.
--    Nada se perde: o registro completo fica em controle_viagens_recusadas.
--
-- 2) Exclusao logica das 38 viagens vivas de 19 e 20/08. Para reverter:
--    UPDATE controle_viagens SET is_deleted = false, deleted_at = NULL,
--      deleted_by_nome = NULL WHERE deleted_by_nome = 'MIGRACAO 71 - CACHE ANTIGO';
--
-- 3) Carga 45113: a viagem existe (confirmado pelo Tiago). So a data vai para
--    o formato do banco, para ordenar direito.
--
-- atualizado_em aqui e now() puro: nesta tabela o app grava o instante real.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.controle_viagens_recusadas (
  id          BIGSERIAL PRIMARY KEY,
  viagem_id   BIGINT NOT NULL,
  motivo      TEXT NOT NULL,
  carga       TEXT,
  data_saida  TEXT,
  registro    JSONB NOT NULL,
  tentativas  INT NOT NULL DEFAULT 1,
  primeira_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultima_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (viagem_id, motivo)
);

-- Sem politica de proposito: so a guarda (SECURITY DEFINER) e o SQL manual usam.
ALTER TABLE public.controle_viagens_recusadas ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.jr_guarda_controle_viagens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_motivo TEXT := NULL;
  v_ms     NUMERIC;
BEGIN
  -- So o que vem do PostgREST. Migration e correcao manual passam direto.
  IF coalesce(current_setting('request.method', true), '') = '' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- O upsert dispara este gatilho antes de saber que e atualizacao. Linha que
    -- ja existe segue para o caminho de UPDATE.
    IF EXISTS (SELECT 1 FROM public.controle_viagens c WHERE c.id = NEW.id) THEN
      RETURN NEW;
    END IF;
    -- Dois formatos de id: Date.now() e Date.now() * 1000 + contador.
    v_ms := CASE WHEN NEW.id > 100000000000000 THEN NEW.id / 1000
                 WHEN NEW.id > 100000000000 THEN NEW.id
                 ELSE 0 END;
    IF v_ms < extract(epoch FROM now() - interval '7 days') * 1000 THEN
      v_motivo := 'CACHE_ANTIGO';
    END IF;
  ELSIF OLD.is_deleted IS TRUE AND NEW.is_deleted IS NOT TRUE
    AND NOT (NEW.atualizado_em IS NOT NULL
             AND (OLD.atualizado_em IS NULL OR NEW.atualizado_em > OLD.atualizado_em)) THEN
    v_motivo := 'DESFAZ_EXCLUSAO';
  END IF;

  IF v_motivo IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.controle_viagens_recusadas (viagem_id, motivo, carga, data_saida, registro)
  VALUES (NEW.id, v_motivo, NEW.carga, NEW.data_saida, to_jsonb(NEW))
  ON CONFLICT (viagem_id, motivo) DO UPDATE
    SET tentativas = public.controle_viagens_recusadas.tentativas + 1,
        ultima_em  = now();
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_controle_viagens_guarda ON public.controle_viagens;
CREATE TRIGGER trg_controle_viagens_guarda
  BEFORE INSERT OR UPDATE ON public.controle_viagens
  FOR EACH ROW EXECUTE FUNCTION public.jr_guarda_controle_viagens();

DO $$
DECLARE
  v_com_dados INT;
  v_excluidas INT;
  v_agora TIMESTAMP := now() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  SELECT count(*) INTO v_com_dados FROM public.controle_viagens
  WHERE data_saida IN ('19/08/2026', '20/08/2026')
    AND (coalesce(status_viagem, '') <> '' OR coalesce(hora_saida, '') <> ''
      OR coalesce(data_retorno, '') <> '' OR coalesce(data_entrega, '') <> '');
  IF v_com_dados > 0 THEN
    RAISE EXCEPTION '% viagem(ns) a excluir ja tem dados lancados', v_com_dados;
  END IF;

  UPDATE public.controle_viagens
  SET is_deleted = true, deleted_at = v_agora,
      deleted_by_nome = 'MIGRACAO 71 - CACHE ANTIGO', atualizado_em = now()
  WHERE data_saida IN ('19/08/2026', '20/08/2026') AND is_deleted IS NOT TRUE;
  GET DIAGNOSTICS v_excluidas = ROW_COUNT;
  IF v_excluidas <> 38 THEN
    RAISE EXCEPTION 'Esperava 38 viagens, achou %', v_excluidas;
  END IF;

  UPDATE public.controle_viagens
  SET data_saida = '2026-11-03', atualizado_em = now()
  WHERE carga = '45113' AND data_saida = '03/11/2026';
END $$;
