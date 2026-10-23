ALTER TABLE "CoproductionAgreement" DROP CONSTRAINT IF EXISTS "CoproductionAgreement_product_check";
ALTER TABLE "CoproductionAgreement" ADD CONSTRAINT "CoproductionAgreement_product_check"
 CHECK (product IN ('links-pagamento','links-assinatura','boletos','planos','planos-pix','plataformas'));
ALTER TABLE "CoproductionAgreement" ADD COLUMN mode text NOT NULL DEFAULT 'OWN'
 CHECK (mode IN ('OWN','INHERIT') AND (product <> 'plataformas' OR mode = 'OWN'));
ALTER TABLE "CoproductionRevision" ADD COLUMN mode text NOT NULL DEFAULT 'OWN'
 CHECK (mode IN ('OWN','INHERIT') AND (product <> 'plataformas' OR mode = 'OWN'));
