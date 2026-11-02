'use client';

import { useState } from 'react';
import { useIsDesktop } from '@/hooks/use-is-desktop';

/**
 * Navegação das etapas (0 = Pedido, 1 = Dados, 2 = Pagamento; 3 quando o
 * pagamento se divide em "forma" + "detalhe"). No desktop não há etapas:
 * tudo aparece numa tela só e `step` fica sempre em `last`.
 */
export function useCheckoutSteps(last = 2) {
  const [mobileStep, setStep] = useState(0);
  const desktop = useIsDesktop();
  const step = desktop ? last : Math.min(mobileStep, last);
  return { step, setStep, desktop, last };
}

export type CheckoutStepsController = ReturnType<typeof useCheckoutSteps>;
