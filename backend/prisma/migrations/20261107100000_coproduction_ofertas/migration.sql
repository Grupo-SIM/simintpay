ALTER TABLE "CoproductionAgreement" DROP CONSTRAINT IF EXISTS "CoproductionAgreement_product_check";
ALTER TABLE "CoproductionAgreement" ADD CONSTRAINT "CoproductionAgreement_product_check"
 CHECK (product IN ('links-pagamento','links-assinatura','boletos','planos','planos-pix','plataformas','ofertas'));
