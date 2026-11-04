-- =============================================================================
-- MIGRATION 61 — Novatos na matriz e nomes da escala de 02/11 (30/10/2026)
-- =============================================================================
-- APLICADA EM PRODUCAO em 30/10/2026. So dados.
--
-- O Tiago cadastrou GUSTAVO COSTA DA SILVA e KAUA CAIRO DOS SANTOS DE SOUZA
-- (ajudantes) e passou GUSTAVO ALVES PIMENTEL de motorista para ajudante.
--   * Matriz: "GUSTAVO COSTA" (terca Seco-Araguaina, quarta Maracana) e
--     "GUSTAVO" (sexta Araguaina III, confirmado pelo Tiago) -> nome completo.
--   * Escala de 02/11/2026: montada antes da migration 59, ainda sem carga e
--     sem viagem; recebe os mesmos nomes do cadastro que a matriz recebeu.
-- OZIEL GOMES DE JESUS continua sem cadastro (fica como esta).
-- =============================================================================

UPDATE escala_matrizes SET ajudante = 'LUCAS CARLOS DA ROCHA / GUSTAVO COSTA DA SILVA',
       atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE id = 37 AND ajudante = 'LUCAS CARLOS DA ROCHA / GUSTAVO COSTA';
UPDATE escala_matrizes SET ajudante = 'RENIO BARBOSA ARAUJO / GUSTAVO COSTA DA SILVA',
       atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE id = 44 AND ajudante = 'RENIO BARBOSA ARAUJO / GUSTAVO COSTA';
UPDATE escala_matrizes SET ajudante = 'GUSTAVO COSTA DA SILVA / RAIMUNDO NONATO DE JESUS PEREIRA',
       atualizado_por = 'CORRECAO DE NOMES (CADASTRO)', atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE id = 90 AND ajudante = 'GUSTAVO / RAIMUNDO NONATO DE JESUS PEREIRA';

UPDATE escala_linhas l SET
  motorista = CASE l.motorista
    WHEN 'NILMAR PEREIRA DOS SANTOS SOUZA' THEN 'NILMAR PEREIRA DOS SANTOS'
    WHEN 'EDSON / ALESSANCO' THEN 'EDSON VELOSO MENDES / ALESSANCO BARROS DE MOURA'
    WHEN 'RAIMUNDO / OZIEL GOMES' THEN 'RAIMUNDO CAVALCANTE SILVA FILHO / OZIEL GOMES'
    ELSE l.motorista END,
  ajudante = CASE l.ajudante
    WHEN 'ANOEL FILHO T. DOS SANTOS' THEN 'ANOEL FILHO TEIXEIRA DOS SANTOS'
    WHEN 'EDUARDO MEDANHA DO SANTOS' THEN 'EDUARDO MENDANHA DOS SANTOS'
    WHEN 'WESLY DA CONCEIÇAO LIMA' THEN 'WESLY DA CONCEICAO LIMA'
    WHEN 'RUBENS SILVA GONÇALVES VIANA' THEN 'RUBENS SILVA GONCALVES VIANA'
    ELSE l.ajudante END,
  atualizado_por = 'CORRECAO DE NOMES (CADASTRO)',
  atualizado_em = (now() AT TIME ZONE 'America/Sao_Paulo')
 WHERE l.data_escala = '2026-11-02' AND coalesce(l.is_deleted, false) = false
   AND l.carga IS NULL AND l.viagem_id IS NULL
   AND (l.motorista IN ('NILMAR PEREIRA DOS SANTOS SOUZA', 'EDSON / ALESSANCO', 'RAIMUNDO / OZIEL GOMES')
     OR l.ajudante IN ('ANOEL FILHO T. DOS SANTOS', 'EDUARDO MEDANHA DO SANTOS', 'WESLY DA CONCEIÇAO LIMA', 'RUBENS SILVA GONÇALVES VIANA'));
