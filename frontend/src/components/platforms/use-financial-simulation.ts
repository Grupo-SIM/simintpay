'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useClienteApi } from '@/app/(dashboard)/cliente/_shared';
import type {
  AdditiveTotals,
  FeeMode,
  FinancialConfiguration,
  Lane,
  OwnerRule,
  RowState,
  SimulationRow,
} from './financial-types';

export function useFinancialSimulation({
  tag,
  configuration,
  keys,
  amountCents,
  owner,
  lanes,
  interestFree,
  feeMode,
  additiveTotals,
  valid,
  admin,
}: {
  tag: string;
  configuration: FinancialConfiguration;
  keys: string[];
  amountCents: number;
  owner: Record<string, OwnerRule>;
  lanes: Record<string, Lane>;
  interestFree: boolean;
  /** Drafted fee mode; it changes which SimIntPay fee is charged. */
  feeMode?: FeeMode | null;
  /** Additive values; part of the cache signature so stale rows are never reused. */
  additiveTotals?: AdditiveTotals;
  valid: boolean;
  admin: boolean;
}) {
  const api = useClienteApi();
  const cache = useRef(new Map<string, SimulationRow>());
  const inflight = useRef(new Map<string, Promise<SimulationRow>>());
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [retry, setRetry] = useState(0);
  const signatures = keys.map((key) =>
    JSON.stringify([
      tag,
      configuration.version,
      key,
      amountCents,
      owner[key],
      admin ? lanes[key] : undefined,
      interestFree,
      feeMode,
      additiveTotals,
    ]),
  );
  const identity = JSON.stringify(signatures);
  const latest = useRef(identity);
  useLayoutEffect(() => {
    latest.current = identity;
  }, [identity]);
  useEffect(() => {
    if (!valid) return;
    let disposed = false;
    const missing = keys.filter(
      (_, i) =>
        !cache.current.has(signatures[i]) &&
        !inflight.current.has(signatures[i]),
    );
    setRows((previous) =>
      Object.fromEntries(
        keys.map((key, i) => [
          key,
          {
            ...(cache.current.get(signatures[i]) ?? previous[key]),
            installments: Number(key.split('/')[3]),
            pending: !cache.current.has(signatures[i]),
          },
        ]),
      ),
    );
    // One request per acquirer/method/channel: the endpoint prices a single route.
    const groups = new Map<string, string[]>();
    missing.forEach((key) => {
      const route = key.split('/').slice(0, 3).join('/');
      groups.set(route, [...(groups.get(route) ?? []), key]);
    });
    groups.forEach((groupKeys, route) => {
      const [acquirer, method, channel] = route.split('/');
      const response = api.post<{ data: SimulationRow[] }>(
        `/platforms/${encodeURIComponent(tag)}/financial-policy/simulation`,
        {
          version: configuration.version,
          amountCents,
          acquirer,
          method,
          channel,
          installments: groupKeys.map((key) => Number(key.split('/')[3])),
          draft: admin
            ? { lanes, ...(feeMode ? { feeMode } : {}) }
            : { owner, interestFree },
        },
      );
      groupKeys.forEach((key) => {
        const signature = signatures[keys.indexOf(key)],
          n = Number(key.split('/')[3]);
        const promise = response
          .then(
            (body) =>
              body.data.find((row) => row.installments === n) ?? {
                installments: n,
                error: 'Resposta incompleta',
              },
          )
          .catch((error: Error) => ({ installments: n, error: error.message }));
        inflight.current.set(signature, promise);
        void promise.then((row) => {
          cache.current.set(signature, row);
          if (cache.current.size > 512)
            cache.current.delete(cache.current.keys().next().value!);
          inflight.current.delete(signature);
        });
      });
    });
    // Subscribe separately so an unchanged row keeps its request when another draft changes.
    keys.forEach((key, i) => {
      const promise = inflight.current.get(signatures[i]);
      if (!promise) return;
      void promise.then((row) => {
        if (!disposed && latest.current === identity)
          setRows((previous) => ({
            ...previous,
            [key]: { ...row, pending: false },
          }));
      });
    });
    return () => {
      disposed = true;
    };
    // Identity includes every financial dependency; stable rows do not issue requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, valid, retry]);
  return {
    rows,
    retryRow: (key: string) => {
      cache.current.delete(signatures[keys.indexOf(key)]);
      setRetry((value) => value + 1);
    },
  };
}
