-- Grandfather: contas que já existiam viram clientes SimintPay APROVADOS.
-- Novas contas auto-cadastradas continuam PENDING (definido no fluxo de register).
-- Exclusões: admins/master (role <> USER) e as contas operadoras nomeadas (Bosque/Renovada).
UPDATE "User"
SET "clientStatus" = 'APPROVED'::"ClientStatus",
    "clientApprovedAt" = now()
WHERE "clientStatus" IS NULL
  AND "role" = 'USER'::"Role"
  AND lower("email") NOT IN ('contato@bosque.com.br', 'contato@renovada12.com.br');