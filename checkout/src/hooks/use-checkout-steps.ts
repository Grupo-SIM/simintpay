'use client';

import { useState } from 'react';
import { useIsDesktop } from '@/hooks/use-is-desktop';

/** Etapas do checkout: 0 = Pedido, 1 = Dados, 2 = Pagamento. */
export type CheckoutStep = 0 | 1 | 2;

/**
 * Navegação das etapas. No desktop não há etapas: tudo aparece numa tela só
 * (`step` fica em 2 e `showAll` é `true`).
 */
export function useCheckoutSteps() {
  const [mobileStep, setStep] = useState<CheckoutStep>(0);
  const desktop = useIsDesktop();
  const step: CheckoutStep = desktop ? 2 : mobileStep;
  return { step, setStep, desktop };
}
