-- =============================================================================
-- MIGRATION 52 — reentregas_rota: guarda contra carimbo regressivo (19/10/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO (projeto JR-OPER) em 19/10/2026. Independe da build do
-- aparelho: e protecao do banco. Nao exige deploy.
--
-- O DEFEITO (a mesma classe da migration 45, numa tabela que ficou de fora)
--
-- 17/10/2026, 08:44-08:46 (Brasilia). O Tiago recebeu no CD e despachou as 3
-- reentregas da carga 44728. Todos os POST em reentregas_rota voltaram 200 —
-- o banco chegou a ter DESPACHADO. As 08:48:00 (11:48:00 UTC) um POST de
-- 3.919 bytes reenviou os 3 registros na versao que o Lucas deixou na noite
-- anterior (PENDENTE, atualizado_em 2026-10-17 00:07 UTC), e o banco aceitou,
-- porque esta tabela nao tinha o trigger que a 45 criou para retencoes_frota.
-- Os aparelhos aceitaram o PENDENTE no pull seguinte e as reentregas voltaram
-- a pedir "Receber no CD" na tela. Prova: audit_logs (o "depois" de cada
-- EDICAO tem o estado DESPACHADO) e os logs do PostgREST de 17/10.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Liga em reentregas_rota a mesma funcao jr_recusar_carimbo_regressivo() da
-- migration 45: um BEFORE UPDATE que IGNORA (nao da erro) a gravacao que
-- faria atualizado_em andar para tras. Ver a 45 para o porque de ignorar em
-- vez de recusar com erro.
--
-- E restaura os 3 registros da carga 44728 a partir do ultimo "depois" do
-- audit_logs de cada um, com atualizado_em = agora, para que todos os
-- aparelhos aceitem esta versao no proximo pull.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_reentregas_rota_guarda_carimbo ON public.reentregas_rota;
CREATE TRIGGER trg_reentregas_rota_guarda_carimbo
  BEFORE UPDATE ON public.reentregas_rota
  FOR EACH ROW EXECUTE FUNCTION public.jr_recusar_carimbo_regressivo();

-- Restauracao da carga 44728 (estado final registrado no audit_logs).
WITH ultimo AS (
  SELECT DISTINCT ON (registro_id) registro_id, diff->'depois' AS d
  FROM public.audit_logs
  WHERE modulo = 'reentregas'
    AND registro_id::text IN ('1792195514205703','1792195576051703','1792195607329703')
    AND diff->'depois'->>'status' = 'DESPACHADO'
  ORDER BY registro_id, data_hora DESC, id DESC
),
r AS (
  SELECT u.registro_id, x.*
  FROM ultimo u, jsonb_populate_record(NULL::public.reentregas_rota, u.d) x
)
UPDATE public.reentregas_rota t SET
  status                      = r.status,
  recebido_cd_em              = r.recebido_cd_em,
  recebido_cd_por             = r.recebido_cd_por,
  qtd_recebida_cd             = r.qtd_recebida_cd,
  condicao_recebimento        = r.condicao_recebimento,
  observacao_recebimento      = r.observacao_recebimento,
  local_armazenagem           = r.local_armazenagem,
  fotos_recebimento           = r.fotos_recebimento,
  fotos_recebimento_paths     = r.fotos_recebimento_paths,
  fotos_recebimento_pendentes = r.fotos_recebimento_pendentes,
  despachado_em               = r.despachado_em,
  despachado_por              = r.despachado_por,
  despacho_placa              = r.despacho_placa,
  despacho_carga_numero       = r.despacho_carga_numero,
  qtd_despachada              = r.qtd_despachada,
  fotos_despacho              = r.fotos_despacho,
  fotos_despacho_paths        = r.fotos_despacho_paths,
  fotos_despacho_pendentes    = r.fotos_despacho_pendentes,
  atualizado_por              = r.atualizado_por,
  atualizado_em               = now()
FROM r
WHERE t.id = r.id;
