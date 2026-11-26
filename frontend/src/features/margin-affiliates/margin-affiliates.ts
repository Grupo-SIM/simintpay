import { parseAffiliates } from '@/features/affiliates/affiliates';
import type { MarginAgreement } from './types';

const validBps = (value: unknown) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 10000;

/** Rejeita respostas incompletas: nunca vira um acordo vazio inventado. */
export function parseMarginAgreement(value: unknown): MarginAgreement {
  const base = parseAffiliates(value);
  const data = value as {
    coproducers?: unknown;
    inherited?: { coproducers?: unknown } | null;
  };
  const list = data.coproducers;
  if (
    !Array.isArray(list) ||
    list.some(
      (row) =>
        !row ||
        typeof row.email !== 'string' ||
        (row.name !== undefined && typeof row.name !== 'string') ||
        !validBps(row.percentageBps),
    )
  )
    throw new Error('O servidor retornou coprodutores SimIntPay inválidos.');
  const { linkBaseUrl: _link, inherited, ...rest } = base;
  void _link;
  let inheritedCoproducers: { name: string; percentageBps: number }[] = [];
  if (inherited) {
    const source = data.inherited?.coproducers ?? [];
    if (
      !Array.isArray(source) ||
      source.some(
        (row) => typeof row?.name !== 'string' || !validBps(row.percentageBps),
      )
    )
      throw new Error(
        'O servidor retornou coprodutores SimIntPay herdados inválidos.',
      );
    inheritedCoproducers = source.map(({ name, percentageBps }) => ({
      name,
      percentageBps,
    }));
  }
  return {
    ...rest,
    coproducers: list.map((row) => ({
      email: row.email,
      ...(row.name ? { name: row.name } : {}),
      percentageBps: row.percentageBps,
    })),
    ...(inherited
      ? { inherited: { ...inherited, coproducers: inheritedCoproducers } }
      : {}),
  };
}
