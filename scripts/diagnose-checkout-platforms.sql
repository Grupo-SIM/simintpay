-- Read-only diagnostic for the current Platform schema.
-- Run only against an explicitly authorized database. Never returns credentials.
BEGIN TRANSACTION READ ONLY;

-- Compare persisted link identifiers with the exact normalization used by checkout.
-- Includes every product; no identity inferred from a product's display name.
WITH references AS (
  SELECT l.id AS "linkId", l."userId", l.plataformas,
         COALESCE(l.plataformas[1], member.tag, 'GLOBAL') AS reference
  FROM "PaymentLink" l
  JOIN "User" u ON u.id = l."userId"
  LEFT JOIN "Platform" member ON member.id = u."platformId"
), normalized AS (
  SELECT *, CASE upper(replace(reference, '_', '-'))
    WHEN 'EBOOKSIM' THEN 'EBOOK'
    ELSE upper(replace(reference, '_', '-')) END AS tag
  FROM references
)
SELECT n.*, p.id AS "platformId", p."isActive" AS "platformActive",
       owner."isActive" AS "platformOwnerActive", owner."isPurged" AS "platformOwnerPurged",
       p."ownerUserId" = n."userId" AS "linkOwnedByCurrentPlatformOwner",
       EXISTS (SELECT 1 FROM "PlatformIntegration" i
               WHERE i."platformId" = p.id AND i.key = 'DOM_TOKEN'
                 AND i."encryptedValue" IS NOT NULL) AS "domCredentialStored",
       CASE
         WHEN n.tag IN ('GLOBAL', 'SIMINTPAY') OR n.tag LIKE 'CLIENT:%' THEN 'GLOBAL_CONTEXT'
         WHEN p.id IS NULL AND by_id.id IS NOT NULL THEN 'UUID_STORED_INSTEAD_OF_TAG'
         WHEN p.id IS NULL THEN 'PLATFORM_TAG_NOT_REGISTERED'
         WHEN NOT p."isActive" THEN 'PLATFORM_INACTIVE'
         WHEN NOT owner."isActive" OR owner."isPurged" THEN 'PLATFORM_OWNER_INACTIVE'
         ELSE 'REGISTERED_ACTIVE'
       END AS diagnosis
FROM normalized n
LEFT JOIN "Platform" p ON p.tag = n.tag
LEFT JOIN "Platform" by_id ON by_id.id = n.reference
LEFT JOIN "User" owner ON owner.id = p."ownerUserId"
ORDER BY diagnosis, n.tag, n."linkId";

-- Creation uses the selected platform tag and requires its own DOM credential.
-- Stored ciphertext does not prove that the server can decrypt the credential.
SELECT p.id, p.tag, p.name, p."isActive", p.acquirer,
       u."isActive" AS "ownerActive", u."isPurged" AS "ownerPurged",
       EXISTS (SELECT 1 FROM "PlatformIntegration" i
               WHERE i."platformId" = p.id AND i.key = 'DOM_TOKEN'
                 AND i."encryptedValue" IS NOT NULL) AS "domCredentialStored"
FROM "Platform" p
JOIN "User" u ON u.id = p."ownerUserId"
ORDER BY p.tag;

ROLLBACK;
