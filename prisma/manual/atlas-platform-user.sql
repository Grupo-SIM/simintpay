-- Cria a plataforma Atlas: TenantModule + usuário dedicado + wallet.
-- Rodar uma vez no banco `simpay`. Depois: ATLAS_USER_ID=a71a5000-0000-4000-8000-000000000001
-- O usuário não faz login (password é um valor que nunca confere com bcrypt).
BEGIN;

INSERT INTO "TenantModule" (id, name, slug, "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Atlas', 'atlas', true, now(), now())
ON CONFLICT (slug) DO NOTHING;

INSERT INTO "User" (id, name, email, password, role, "isActive", "tenantModuleId", "createdAt", "updatedAt")
SELECT 'a71a5000-0000-4000-8000-000000000001', 'Atlas', 'contato@atlashosting.com.br', '!', 'USER', true, t.id, now(), now()
FROM "TenantModule" t
WHERE t.slug = 'atlas'
ON CONFLICT (id) DO NOTHING;

INSERT INTO "Wallet" (id, "userId", balance, "lockedBalance", version, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'a71a5000-0000-4000-8000-000000000001', 0, 0, 0, now(), now())
ON CONFLICT ("userId") DO NOTHING;

COMMIT;
