export const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessState = {
  isActive: boolean;
  expiresAt: Date;
  frozenDays: number;
  totalDaysCredited: number;
};

/** Dias restantes arredondados para cima (0 quando já venceu). */
export function remainingDaysOf(expiresAt: Date, now: Date): number {
  return Math.ceil(Math.max(expiresAt.getTime() - now.getTime(), 0) / DAY_MS);
}

/** Ativo de verdade: marcado ativo e ainda dentro do prazo. */
export function isEffectivelyActive(
  access: Pick<AccessState, 'isActive' | 'expiresAt'>,
  now: Date,
): boolean {
  return access.isActive && access.expiresAt.getTime() > now.getTime();
}

/**
 * Crédito de uma cobrança paga, empilhado sobre o tempo restante (igual ao plano PIX legado):
 * parte do vencimento atual se ainda no futuro, senão de agora. Um acesso suspenso soma os
 * dias congelados antes de empilhar e volta a ficar ativo.
 */
export function creditDays(
  current: AccessState | null,
  days: number,
  now: Date,
): AccessState {
  if (!current) {
    return {
      isActive: true,
      expiresAt: new Date(now.getTime() + days * DAY_MS),
      frozenDays: 0,
      totalDaysCredited: days,
    };
  }
  const suspended = !current.isActive && current.frozenDays > 0;
  const base = suspended
    ? new Date(now.getTime() + current.frozenDays * DAY_MS)
    : current.expiresAt.getTime() > now.getTime()
      ? current.expiresAt
      : now;
  return {
    isActive: true,
    expiresAt: new Date(base.getTime() + days * DAY_MS),
    frozenDays: 0,
    totalDaysCredited: current.totalDaysCredited + days,
  };
}

/** Suspende guardando os dias restantes; o vencimento passa a "agora". */
export function suspendAccess(current: AccessState, now: Date): AccessState {
  return {
    ...current,
    isActive: false,
    expiresAt: now,
    frozenDays: remainingDaysOf(current.expiresAt, now),
  };
}

/** Reativa devolvendo os dias congelados (ou `days`, se informado e positivo). Null se não houver dias. */
export function resumeAccess(
  current: AccessState,
  now: Date,
  days?: number,
): AccessState | null {
  const restore = days && days > 0 ? days : current.frozenDays;
  if (restore <= 0) return null;
  return {
    ...current,
    isActive: true,
    expiresAt: new Date(now.getTime() + restore * DAY_MS),
    frozenDays: 0,
  };
}
