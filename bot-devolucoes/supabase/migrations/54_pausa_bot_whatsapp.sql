-- 54 - Pausa do bot e janela de 24 h do WhatsApp (depende da 52).
-- Colunas novas e opcionais; nao altera nenhuma linha. Rodar ANTES de publicar
-- a funcao whatsapp-bot nova.
--   pausado_em               -> o SAC entrou na conversa; o bot fica calado
--   ultima_msg_motorista_em  -> hora da ultima mensagem do motorista (sem o
--                               conteudo); define se o bot pode mandar texto
--                               livre ou precisa do modelo aprovado
alter table motoristas_whatsapp add column if not exists pausado_em timestamptz;
alter table motoristas_whatsapp add column if not exists ultima_msg_motorista_em timestamptz;

-- Nome do modelo aprovado na Meta para pedir complemento fora da janela
insert into bot_config (chave, valor) values ('wa_modelo_complemento', 'complemento_devolucao')
on conflict (chave) do nothing;

-- ROLLBACK:
-- alter table motoristas_whatsapp drop column if exists pausado_em, drop column if exists ultima_msg_motorista_em;
-- delete from bot_config where chave = 'wa_modelo_complemento';
