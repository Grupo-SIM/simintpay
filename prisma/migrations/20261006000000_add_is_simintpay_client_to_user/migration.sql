SET lock_timeout = '60s';

-- Contas marcadas pelo admin como "cliente Simintpay" (plataformas/comunidades que
-- já aparecem na aba Clientes Simintpay) deixam de aparecer na lista de Usuários ativos.
ALTER TABLE "User"
ADD COLUMN "isSimintpayClient" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "User_isSimintpayClient_idx" ON "User"("isSimintpayClient");
