import { Prisma } from '@prisma/client';
import { AtlasConfig } from '../atlas/atlas.config';
import { RevalidaConfig } from '../revalida/revalida.config';
import {
  getPlatformTaxaEffective,
  domCashbackReais,
} from '../platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../platform-taxas/platform-taxas.keys';
export type PlatformDashboardRules = {
  tag: string;
  name: string;
  liquidity: () => number;
  salesNet: (net: number) => number;
};
export function platformDashboardRules(tag: string): PlatformDashboardRules {
  return {
    tag,
    name: tag === 'ATLAS' ? 'Atlas' : tag === 'REVALIDA' ? 'Revalida' : tag,
    liquidity: () =>
      tag === 'ATLAS'
        ? (AtlasConfig.saque.fatorLiquidez ?? 0.91)
        : tag === 'REVALIDA'
          ? (RevalidaConfig.saque.fatorLiquidez ?? 0.91)
          : 1,
    salesNet: (net) =>
      tag === 'REVALIDA'
        ? new Prisma.Decimal(net)
            .minus(
              getPlatformTaxaEffective(
                tag,
                'TAXA_FIXA_TRANSACAO',
                PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
              ),
            )
            .minus(domCashbackReais())
            .toDecimalPlaces(2)
            .toNumber()
        : net,
  };
}
