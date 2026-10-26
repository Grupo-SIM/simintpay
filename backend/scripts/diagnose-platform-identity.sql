-- Read-only preflight for 20261014000000_unify_platform_identity.
-- Execute only against an explicitly authorized database.
SELECT u.id AS "userId", u."tenantModuleId", t.slug, t.name,
       p.id AS "platformId", p.tag, p."ownerUserId"
FROM "User" u
JOIN "TenantModule" t ON t.id = u."tenantModuleId"
LEFT JOIN "Platform" p ON p."tenantModuleId" = t.id
ORDER BY (p.id IS NULL) DESC, t.slug, u.id;

-- Every row here blocks migration. Bind an existing Platform explicitly first.
SELECT t.id, t.slug, t.name, count(u.id) AS "affectedUsers"
FROM "TenantModule" t JOIN "User" u ON u."tenantModuleId" = t.id
LEFT JOIN "Platform" p ON p."tenantModuleId" = t.id
WHERE p.id IS NULL GROUP BY t.id, t.slug, t.name;
