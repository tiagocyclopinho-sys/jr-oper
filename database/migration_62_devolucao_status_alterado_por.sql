-- =====================================================================
-- migration_62 — Quem mudou o status da devolução (6.11.5, 03/11/2026)
-- =====================================================================
-- Pedido do Tiago: a grade do Retorno Físico CD mostra RECEBIDO_CD, mas não
-- quem deu a entrada nem com qual perfil. atualizado_por não serve: muda a
-- cada edição de qualquer pessoa (o monitoramento edita depois da entrada).
--
-- Duas colunas próprias, gravadas só quando o status_fechamento MUDA
-- (store.js updateDestinoCd). O perfil (usuarios.role) é guardado no momento
-- da ação: se o usuário trocar de perfil depois, o registro não muda.
--
-- ocorrencias_devolucao não tem lista branca em cloudStore: o app envia o
-- registro inteiro, então a coluna precisa existir ANTES do deploy.

ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS status_alterado_por    VARCHAR(255);
ALTER TABLE ocorrencias_devolucao ADD COLUMN IF NOT EXISTS status_alterado_perfil VARCHAR(50);

-- Recuperação do histórico: quem gravou a entrada é o atualizado_por da
-- versão (registro_versoes guarda o estado anterior a cada edição) ou do
-- próprio registro cujo atualizado_em bate com data_entrada_cd (até 2 min).
-- data_entrada_cd é timestamptz; atualizado_em é hora de Brasília sem fuso.
-- Sem essa batida (registro editado depois, sem versão), fica em branco em
-- vez de chutar. Em 03/11: 59 de 222 recuperadas.
WITH base AS (
  SELECT d.id, (d.data_entrada_cd AT TIME ZONE 'America/Sao_Paulo') AS entrada
  FROM ocorrencias_devolucao d
  WHERE d.data_entrada_cd IS NOT NULL AND d.status_alterado_por IS NULL
),
cand AS (
  SELECT b.id, d.atualizado_por AS ap, d.atualizado_em AS ae
  FROM base b JOIN ocorrencias_devolucao d ON d.id = b.id
  UNION ALL
  SELECT b.id, v.dados_json->>'atualizado_por', (v.dados_json->>'atualizado_em')::timestamp
  FROM base b JOIN registro_versoes v
    ON v.collection = 'ocorrencias_devolucao' AND v.registro_id = b.id::text
  WHERE COALESCE(v.dados_json->>'status_fechamento', '') <> 'PENDENTE_FISICO'
),
achado AS (
  SELECT DISTINCT ON (b.id) b.id, c.ap, u.role
  FROM base b
  JOIN cand c ON c.id = b.id AND c.ap IS NOT NULL
             AND abs(extract(epoch FROM c.ae - b.entrada)) <= 120
  LEFT JOIN usuarios u ON upper(u.nome) = upper(c.ap)
  ORDER BY b.id, c.ae
)
UPDATE ocorrencias_devolucao d
SET status_alterado_por    = a.ap,
    status_alterado_perfil = a.role
    -- atualizado_em fica como está de propósito: ocorrencias_devolucao é lida
    -- inteira a cada ciclo (não por cursor), então os aparelhos recebem as
    -- colunas sem carimbo novo — e o SLA do gestor, que ainda usa
    -- atualizado_em, não é empurrado para hoje.
FROM achado a
WHERE d.id = a.id;
