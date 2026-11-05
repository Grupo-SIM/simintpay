/** Contratos de workspace sempre têm assinatura no adquirente; contratos de oferta agendados pela SimIntPay não. */
export function requireExternalSubscriptionId(contract: {
  id: string;
  externalSubscriptionId: string | null;
}): string {
  if (!contract.externalSubscriptionId) {
    throw new Error(
      `Contrato ${contract.id} não possui assinatura no adquirente`,
    );
  }
  return contract.externalSubscriptionId;
}
