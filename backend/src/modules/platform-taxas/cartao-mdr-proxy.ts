import type { ModuleConfig } from '../module-config.interface';
import { syncedAcquirerRate } from './platform-taxas.store';

/** MDR cartão 1..12 lido da tabela sincronizada da adquirente. */
export function cartaoMdrProxy(): ModuleConfig['mdr']['cartao'] {
  return new Proxy({} as ModuleConfig['mdr']['cartao'], {
    get(_t, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined;
      const n = Number(prop);
      if (!Number.isInteger(n) || n < 1 || n > 12) return undefined;
      return syncedAcquirerRate('CREDIT_CARD', 'ONLINE', n);
    },
    ownKeys() {
      return Array.from({ length: 12 }, (_, i) => String(i + 1));
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && /^([1-9]|1[0-2])$/.test(prop)) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}
