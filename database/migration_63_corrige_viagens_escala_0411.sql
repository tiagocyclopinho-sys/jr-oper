-- migration_63: viagens da escala de 04/11/2026 (aprovado pelo Tiago em 04/11).
--
-- As cargas 45119 a 45140 foram montadas em 03/11 para saída em 04/11. O Fusion
-- foi importado também em 05/11 e as viagens de 04/11 ficaram presas no aparelho
-- de quem importou (criado_em nulo, corrigido na 6.11.6). Subiram só viagens
-- erradas, com data 05/11, a partir do aparelho que editava 05/11.
--
-- 1) exclusão lógica das viagens de 05/11 com cargas de 04/11 e do transbordo
--    "TRANSB 05.11.2026 SEM PLACA". Para reverter: is_deleted = false.
-- 2) lança as viagens de 04/11 com o viagem_id das linhas, o mesmo id do aparelho
--    de quem importou: quando ele subir, é o mesmo registro.
-- 3) limpa carga, peso, valor, entregas e viagem_id das linhas de 05/11. Os
--    números continuam nas linhas de 04/11.
--
-- Para antes de gravar se alguma viagem a excluir já tiver saída, status ou retorno.

DO $$
DECLARE
  v_com_dados int;
  v_excluidas int;
  v_lancadas int;
  v_limpas int;
  v_agora timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  CREATE TEMP TABLE _cargas_0411 ON COMMIT DROP AS
    SELECT DISTINCT carga FROM escala_linhas
    WHERE data_escala = '2026-11-04' AND COALESCE(is_deleted, false) = false
      AND COALESCE(carga, '') <> '' AND viagem_id IS NOT NULL;

  CREATE TEMP TABLE _erradas ON COMMIT DROP AS
    SELECT id FROM controle_viagens
    WHERE is_deleted IS NOT TRUE AND data_saida = '2026-11-05'
      AND (carga IN (SELECT carga FROM _cargas_0411) OR carga = 'TRANSB 05.11.2026 SEM PLACA');

  SELECT count(*) INTO v_com_dados FROM controle_viagens
  WHERE id IN (SELECT id FROM _erradas)
    AND (COALESCE(status_viagem, '') <> '' OR COALESCE(hora_saida, '') <> ''
      OR COALESCE(data_retorno, '') <> '' OR COALESCE(data_entrega, '') <> '');
  IF v_com_dados > 0 THEN
    RAISE EXCEPTION '% viagem(ns) a excluir já têm dados lançados', v_com_dados;
  END IF;

  UPDATE controle_viagens
  SET is_deleted = true, deleted_at = v_agora, deleted_by_nome = 'CORRECAO ESCALA 04/11', atualizado_em = now()
  WHERE id IN (SELECT id FROM _erradas);
  GET DIAGNOSTICS v_excluidas = ROW_COUNT;

  INSERT INTO controle_viagens (id, carga, rota, placa, motorista, ajudante, ajudante_2, setor, data_saida,
    hora_saida, data_entrega, hora_entrega, data_retorno, hora_retorno, status_viagem, fusion,
    checklist_saida, checklist_chegada, observacao, is_deleted, criado_em, atualizado_em)
  SELECT l.viagem_id, l.carga, l.rota, COALESCE(l.placa, ''), COALESCE(l.motorista, ''), COALESCE(l.ajudante, ''),
    COALESCE(l.ajudante_2, ''), l.setor, '2026-11-04',
    '', '', '', '', '', '', '', '', '', UPPER(COALESCE(l.observacao, '')), false, v_agora, now()
  FROM escala_linhas l
  WHERE l.data_escala = '2026-11-04' AND COALESCE(l.is_deleted, false) = false
    AND COALESCE(l.carga, '') <> '' AND l.viagem_id IS NOT NULL;
  GET DIAGNOSTICS v_lancadas = ROW_COUNT;

  UPDATE escala_linhas
  SET carga = NULL, peso = NULL, valor = NULL, qt_entregas = NULL, viagem_id = NULL,
      atualizado_em = v_agora, atualizado_por = 'CORRECAO ESCALA 04/11'
  WHERE data_escala = '2026-11-05' AND COALESCE(is_deleted, false) = false
    AND (carga IN (SELECT carga FROM _cargas_0411) OR carga = 'TRANSB 05.11.2026 SEM PLACA');
  GET DIAGNOSTICS v_limpas = ROW_COUNT;

  IF v_lancadas <> 16 OR v_limpas <> 14 THEN
    RAISE EXCEPTION 'Esperado 16 lançadas e 14 limpas; veio % e %', v_lancadas, v_limpas;
  END IF;
  RAISE NOTICE 'excluidas %, lancadas %, limpas %', v_excluidas, v_lancadas, v_limpas;
END $$;
