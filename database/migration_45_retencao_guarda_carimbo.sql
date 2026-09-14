-- =============================================================================
-- MIGRATION 45 — retencoes_frota: guarda contra carimbo regressivo (14/09/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO (projeto JR-OPER) em 14/09/2026, junto com a 44, ANTES
-- do deploy da 6.7.0. Independe da build do aparelho: e protecao do banco.
--
-- O DEFEITO (terceira vez que a mesma classe atinge esta tabela)
--
-- 11/09/2026, 19:13 UTC. Os aparelhos abriram a 6.6.3, que levou a lista
-- branca COLUNAS_POR_TABELA.retencoes_frota (cloudStore.js). A lista muda o
-- calculo do hash de sincronia, entao TODA retencao de TODO aparelho ficou
-- "suja" no primeiro ciclo — exatamente a janela que a migration 43 previu
-- por escrito. Um PC que ainda tinha RET-2026-001/002 como RETIDO em cache
-- (copia anterior a liberacao, sem atualizado_em) venceu o desempate do pull
-- (_mesclarPorRegistro so cede a nuvem quando OS DOIS lados tem carimbo) e
-- empurrou RETIDO por cima do LIBERADO que tinha chegado as 13:30. O envio e
-- POST com resolution=merge-duplicates, a projecao manda atualizado_em: null
-- explicitamente, e o banco nao tinha trigger nenhum nesta tabela: aceitou.
-- Os demais aparelhos, ja confirmados, aceitaram o RETIDO no pull seguinte.
-- Prova: logs do PostgREST (rajada de 8 POSTs em retencoes_frota entre
-- 19:13 e 19:18) e as duas linhas com atualizado_em NULL depois disso.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Um BEFORE UPDATE que IGNORA a gravacao quando ela tentaria fazer o carimbo
-- andar para tras: NEW.atualizado_em nulo, ou mais velho que o que ja esta na
-- linha. Ignorar, e nao dar erro, e deliberado: erro derruba o lote inteiro
-- do PostgREST e recria o "sujo para sempre, retentando a cada 30s" que a
-- migration 43 descreve. Ignorando, o aparelho recebe 200, confirma o hash,
-- deixa de considerar o registro sujo e aceita a versao da nuvem no pull
-- seguinte — o aparelho atrasado se corrige sozinho.
--
-- O QUE ELA NAO FAZ
--
--   - Nao carimba. Quem carimba atualizado_em nesta tabela e o app
--     (Store#carimbarEdicao, liberarVeiculo, updateRetencaoFrota). Linha que
--     esta com carimbo NULO continua aceitando qualquer gravacao — a guarda
--     so passa a valer para uma linha depois que alguem a edita numa build
--     que carimba (6.6.3+). E o caso das duas retencoes hoje: estao nulas,
--     entao o PC da oficina (ainda na 6.6.2, que nao carimba a liberacao)
--     consegue devolver o LIBERADO quando abrir.
--   - Nao protege as outras tabelas. A funcao e generica de proposito, mas
--     so anexar a uma tabela depois de conferir que TODO caminho de edicao
--     dela carimba — senao a guarda engole edicao legitima de build antiga.
--   - Nao mexe em INSERT nem em DELETE (Reset Global apaga de verdade).
--
-- Idempotente: pode rodar duas vezes.
-- =============================================================================

CREATE OR REPLACE FUNCTION jr_recusar_carimbo_regressivo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.atualizado_em IS NOT NULL
     AND (NEW.atualizado_em IS NULL OR NEW.atualizado_em < OLD.atualizado_em) THEN
    -- Devolver NULL num BEFORE trigger pula a operacao para esta linha, sem
    -- erro e sem escrever nada. Vale tambem para o UPDATE do ON CONFLICT
    -- que o PostgREST gera para resolution=merge-duplicates.
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION jr_recusar_carimbo_regressivo() IS
  'Ignora UPDATE cujo atualizado_em seja nulo ou mais velho que o da linha. Protege contra aparelho com cache antigo sobrescrever edicao mais nova (migration 45).';

DROP TRIGGER IF EXISTS trg_retencoes_frota_guarda_carimbo ON retencoes_frota;
CREATE TRIGGER trg_retencoes_frota_guarda_carimbo
  BEFORE UPDATE ON retencoes_frota
  FOR EACH ROW
  EXECUTE FUNCTION jr_recusar_carimbo_regressivo();

-- Conferencia
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'retencoes_frota'::regclass AND NOT tgisinternal;
--
-- Prova de bancada (nao roda sozinha; copiar e rodar a mao):
--   UPDATE retencoes_frota SET atualizado_em = now() WHERE numero_retencao = 'RET-2026-001';
--   UPDATE retencoes_frota SET status = 'RETIDO', atualizado_em = NULL WHERE numero_retencao = 'RET-2026-001';
--   -- o segundo UPDATE responde "UPDATE 0" e a linha fica como estava.
