# WhatsApp de teste (Meta): identificadores

Criado em 01/10/2026 pelo Tiago, com a conta pessoal dele do Facebook.
Estes números não são segredo. O token NÃO fica aqui.

| Item | Valor |
|---|---|
| App | JR Devolucao teste (App ID 1901177484187217) |
| Portfólio empresarial | JR Distribuidora (business_id 1098685229573998), criado junto com o app |
| Número de teste da Meta | +1 (555) 139-2690 |
| Phone Number ID | 1350911574772654 |
| ID da conta do WhatsApp Business (WABA) | 1773402427216984 |

Resultado do primeiro envio (01/10/2026, 13:21):
- Erro 130497 ("Business account is restricted from messaging users in this country"). O número de teste é dos EUA (+1), e a Meta bloqueia o envio de um país para outro, com restrição especial para o Brasil. Por isso o número de teste da Meta não serve para testar com celulares brasileiros.
- A Meta devolveu `wa_id` = 556391189339 (SEM o 9) para o celular +55 63 99118-9339. O bot precisa reconhecer o motorista com e sem o 9 depois do DDD.

Cuidados:
- Não usar a "Etapa 2. Configuração da produção" com o número do SAC: o número sairia do aplicativo. O número real entra pela coexistência (Dualhook).
- O token temporário do painel vale 24 h. Para o bot, criar um token permanente (usuário do sistema no portfólio).
