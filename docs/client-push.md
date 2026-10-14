# Web Push do painel do cliente

## Configuração local

Definir `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no ambiente do backend. Exemplo público em `.env.example`; chave privada nunca entra no Git. CLI instalada `web-push generate-vapid-keys` gera par local sem enviar notificações. Backend sem configuração retorna 503 no endpoint de chave pública e mantém processador inativo.

Aplicar migrações somente com `DATABASE_URL` explicitamente apontando para banco descartável local. Nunca usar URL de ambiente compartilhado/remoto para validação. Migração `202610140001_sale_push` cria assinaturas, eventos/entregas, ativação e trigger; também persiste termos de recorrência do plano. Trigger faz parte do contrato durável: `db push` sozinho não o instala.

## Contratos

- GET `/notifications/push/public-key` → `{ data: { publicKey } }`.
- POST `/notifications/push/subscriptions` → assinatura padrão `{ endpoint, expirationTime?, keys: { p256dh, auth } }`; usuário autenticado e aprovado.
- DELETE `/notifications/push/subscriptions` → `{ endpoint }`; remove somente dispositivo do usuário autenticado, mesmo se aprovação foi revogada.

Por defesa do processador, endpoints aceitos pertencem aos provedores HTTPS Apple, Mozilla, Google e Windows; URLs privadas/arbitrárias são rejeitadas. Chaves de autenticação nunca aparecem no payload da venda.

## Validação sem provedor externo

`bun run test -- --runInBand` executa Jest configurado no projeto. Suítes de push, guarda, propriedade e recorrência usam mocks; nenhuma cobrança/envio real. Script `src/modules/sale-push/tests/approval-trigger.sql` roda somente em banco PostgreSQL local vazio e descartável. Cobre aprovação, replay/reaprovação, histórico, rollback, múltiplos dispositivos e exclusão em cascata.

Validação do service worker, conta/dispositivo e layouts fica no frontend. Permissão do navegador só é solicitada em clique. Envio real e entrega com sistema suspenso permanecem sujeitos ao provedor e às permissões de navegador/sistema.
