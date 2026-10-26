import type { ModuleConfig } from '../module-config.interface';
import { getPlatformTaxaEffective } from './platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS, type PlataformaTaxaKey } from './platform-taxas.keys';

function ccKey(n: number): PlataformaTaxaKey {
  return `MDR_CC_${n}X` as PlataformaTaxaKey;
}

/** MDR cartão 1..12 com leitura dinâmica (.env + overrides). */
export function cartaoMdrProxy(canonicalTag: string): ModuleConfig['mdr']['cartao'] {
  return new Proxy({} as ModuleConfig['mdr']['cartao'], {
    get(_t, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined;
      const n = Number(prop);
      if (!Number.isInteger(n) || n < 1 || n > 12) return undefined;
      const key = ccKey(n);
      return getPlatformTaxaEffective(canonicalTag, key, PLATFORM_TAXA_DEFAULTS[key]);
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
