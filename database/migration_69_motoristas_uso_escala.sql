-- =============================================================================
-- MIGRATION 69 — Uso do motorista na escala (04/11/2026)
-- =============================================================================
-- Sai com a v7.1.0. Motorista com infração não pode sair do cadastro, mas nem todo
-- motorista cadastrado faz rota. uso_escala separa isso sem mexer nas outras abas:
--   ROTA       escala e Disponibilidade (vazio vale como ROTA)
--   TRANSBORDO motorista de carreta: fora dos disponíveis, escalável em transbordo
--   FIXA       serviço fixo, fora da escala (Silvestre, carne)
--   NAO        não faz viagem: só nas outras abas
-- Sem NOT NULL nem CHECK de propósito: aparelho em versão antiga manda null no
-- lote do sync, e a recusa derrubaria o envio inteiro.
-- Preenchimento inicial decidido pelo Tiago em 04/11.
-- =============================================================================

ALTER TABLE motoristas ADD COLUMN IF NOT EXISTS uso_escala VARCHAR(12) DEFAULT 'ROTA';

UPDATE motoristas SET uso_escala = 'ROTA' WHERE uso_escala IS NULL;

UPDATE motoristas SET uso_escala = 'TRANSBORDO'
WHERE upper(nome) IN ('FAGNO PEREIRA ALMEIDA', 'CELIO ALVES OLIVEIRA');

UPDATE motoristas SET uso_escala = 'FIXA'
WHERE upper(nome) = 'SILVESTRE LOPES DE ARAUJO';

UPDATE motoristas SET uso_escala = 'NAO'
WHERE upper(nome) IN (
  'EDSON ARRUDA', 'ALEXANDRE ALMEIDA BEZERRA', 'CARLOS ALEXANDRE SANTOS DE SOUZA', 'DEUSIVALDO LEONCO FERREIRA',
  'EDUARDO CARDOSO DUARTE', 'FLÁVIO CANDIDO DE FARIA', 'JAILSON DA SILVA SANTOS', 'JAMIL JOSE DE SOUZA',
  'JOSE SANTANA FONSECA OLIVEIRA', 'LEANDRO ROSEIRA FERREIRA', 'LEOMAR FERREIRA RESPLANDES', 'LEONARDO MACHADO',
  'MARCOS ADRIANO BARBOSA ALENCAR', 'PAULO SILVA ALVES', 'PAULO VIKTOR DA SILVA', 'RENNAN GOMES DOS SANTOS',
  'RUBERLEY MOREIRA MARTINS', 'VICTOR HUGO DE SOUSA SILVA', 'WELITON GOMES DA LUZ'
);
