-- Payment lanes (METHOD/installments) a delivery platform does not accept.
ALTER TABLE "Platform" ADD COLUMN "deliveryDisabledLanes" TEXT[] DEFAULT ARRAY[]::TEXT[];
