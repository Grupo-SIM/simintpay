// Frequências suportadas: apenas Semanal (WEEK), Mensal (MONTH) e Anual (YEAR).
export type FrequencyType =
  'WEEKLY' | 'SEMANAL' | 'MONTHLY' | 'MENSAL' | 'ANUAL';

/** Valores do filtro / API em inglês; linha da lista sempre normalizada para estes. */
export type SubscriptionFrequencyFilter = 'WEEKLY' | 'MONTHLY' | 'ANUAL';

export const SUBSCRIPTION_FREQUENCY_LABEL: Record<
  SubscriptionFrequencyFilter,
  string
> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  ANUAL: 'Anual',
};

/** DOM/BFF pode mandar `MENSAL`, `MONTHLY`, `WEEK`, etc. — alinha ao dropdown de filtro. */
export function normalizeSubscriptionFrequency(
  raw: string | undefined | null,
): SubscriptionFrequencyFilter {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'SEMANAL' || s === 'WEEKLY' || s === 'WEEK') return 'WEEKLY';
  if (s === 'ANUAL' || s === 'ANNUAL' || s === 'YEAR' || s === 'YEARLY')
    return 'ANUAL';
  return 'MONTHLY';
}

export type LinkAssinaturaStatus = 'Ativo' | 'Limite atingido' | 'Inativo';

export type LinkAssinaturaRow = {
  id: string;
  code: string;
  titulo: string;
  valor: number;
  ownerEmail: string;
  criadoPor: string;
  criadoPorEmail?: string | null;
  frequencyType: SubscriptionFrequencyFilter;
  isStandalone: boolean;
  platformFee: number;
  currentUses: number;
  maxUses: number | null;
  status: LinkAssinaturaStatus;
  isActive: boolean;
  checkoutLink: string;
  plataformas: string[];
};

export type LinkAssinaturaFilters = {
  code: string;
  frequencyType: 'all' | SubscriptionFrequencyFilter;
  platform: string;
};
