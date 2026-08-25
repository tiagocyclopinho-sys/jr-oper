-- =============================================================================
-- MIGRATION 31 - FOTOS DA REENTREGA NO MESMO PADRAO DO RESTO DO APP
--
-- JA APLICADA no projeto qxipgnkdbzxtfvuyupow em 25/08/2026.
--
-- POR QUE ELA EXISTE
-- A migration 28 criou foto_recebimento_path / foto_despacho_path TEXT, na
-- ideia de guardar a imagem no Supabase Storage e so o caminho no banco. Errado
-- para ESTE app, por dois motivos:
--
-- 1) OFFLINE. A recepcao acontece na doca do CD. Upload para Storage exige rede
--    NO INSTANTE da captura; sem sinal, o conferente nao registra o recebimento
--    e a operacao trava. O app e PWA offline-first (service worker + localStorage
--    + sincronia diferida) - Storage quebraria essa garantia justamente onde ela
--    mais vale.
--
-- 2) CONSISTENCIA. Devolucao SAC, ocorrencia em rota e sinistro ja guardam foto
--    como base64 em coluna JSONB (fotos_abertura, fotos_investigacao,
--    fotos_danos_*), comprimida por comprimirImagem() em js/app.js: canvas com
--    1280px no maior lado e JPEG 75%, o que derruba foto de celular de ~8MB para
--    ~150-400KB. Esse caminho foi auditado em 20/08/2026, quando foto crua
--    estourava a cota de localStorage no celular.
--
-- CUSTO ASSUMIDO
-- O pull do cloudStore e `select=*` (js/cloudStore.js:320), entao a foto volta a
-- cada ciclo de sincronia de 30s. Isso ja vale hoje para as fotos de devolucao.
-- Com duas fotos por reentrega e volume local de Araguaina, cabe. Se o volume
-- crescer, a migracao para Storage e o proximo passo - e ai vale para TODOS os
-- modulos de uma vez, nao so para reentrega.
-- =============================================================================

-- As colunas da 28 nunca receberam dado (a versao do app que as usaria nao
-- chegou a ser publicada), entao podem sair sem perda.
ALTER TABLE reentregas_rota DROP CONSTRAINT IF EXISTS reentregas_foto_recebimento_check;
ALTER TABLE reentregas_rota DROP CONSTRAINT IF EXISTS reentregas_foto_despacho_check;
ALTER TABLE reentregas_rota DROP COLUMN IF EXISTS foto_recebimento_path;
ALTER TABLE reentregas_rota DROP COLUMN IF EXISTS foto_despacho_path;

-- Plural e array, no mesmo formato de fotos_abertura: o conferente quase sempre
-- tira mais de uma (palete inteiro + etiqueta + avaria).
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS fotos_recebimento JSONB DEFAULT '[]'::jsonb;
ALTER TABLE reentregas_rota ADD COLUMN IF NOT EXISTS fotos_despacho    JSONB DEFAULT '[]'::jsonb;

-- FOTO OBRIGATORIA nas duas etapas novas (pedido de 25/08/2026).
--
-- A trava esta aqui E na tela. So na tela nao bastaria: a garantia ficaria
-- dependendo de a tela se comportar, e qualquer caminho alternativo - outra
-- versao do app em cache, um aparelho desatualizado, um INSERT manual - passaria
-- por cima dela.
--
-- Vale so para os estados NOVOS: as linhas anteriores a esta versao
-- (PENDENTE / REALIZADA) nao tem foto e continuam validas. Exigir foto delas
-- quebraria o historico sem ganho nenhum.
ALTER TABLE reentregas_rota ADD CONSTRAINT reentregas_foto_recebimento_check
  CHECK (
    status NOT IN ('RECEBIDO_CD', 'DESPACHADO')
    OR (fotos_recebimento IS NOT NULL AND jsonb_array_length(fotos_recebimento) > 0)
  );

ALTER TABLE reentregas_rota ADD CONSTRAINT reentregas_foto_despacho_check
  CHECK (
    status <> 'DESPACHADO'
    OR (fotos_despacho IS NOT NULL AND jsonb_array_length(fotos_despacho) > 0)
  );
