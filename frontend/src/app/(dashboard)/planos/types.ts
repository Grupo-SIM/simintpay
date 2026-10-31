import type { DateRange } from '../relatorio/types';

export type PlanStatus = 'Ativo' | 'Inativo';

export type PlanRow = {
  id: string;
  name: string;
  isActive: boolean;
  plataforma: string | null;
  plataformas: string[];
  paymentLink: string;
  interval: string;
  paymentMethod: string;
  status: PlanStatus;
  activeSubs: number;
  inactiveSubs: number;
  createdAt: string;
  /** ISO da API para filtro por período */
  createdAtIso: string | null;
  cpfDono: string | null;
  donoNome: string | null;
  donoEmail: string | null;
};

export type PlanFiltersState = {
  dateRange: DateRange;
  planName: string;
  status: string;
  platform: string;
};
