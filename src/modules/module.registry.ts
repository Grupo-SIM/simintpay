import type { ModuleConfig } from './module-config.interface';
import { Acquirer, toAcquirer } from '../core/services/acquirer.enum';
import { RevalidaConfig }    from './revalida/revalida.config';
import { RenovadaConfig }    from './renovada/renovada.config';
import { BosqueConfig }      from './bosque/bosque.config';
import { PagaTGConfig }      from './pagatg/pagatg.config';
import { EbookSimConfig }    from './ebooksim/ebooksim.config';
import { FrendzConfig }      from './frendz/frendz.config';
import { AtlasConfig }       from './atlas/atlas.config';
import { ComunidadeConfig }  from './comunidade/comunidade.config';
import { ControleMotoristaConfig } from './controle-motorista/controle-motorista.config';
import { ReturnBetConfig } from './return-bet/return-bet.config';

/** Registro de todos os módulos indexados pelo slug */
const REGISTRY: Record<string, ModuleConfig> = {
  revalida:              RevalidaConfig,
  renovada:              RenovadaConfig,
  bosque:                BosqueConfig,
  pagatg:                PagaTGConfig,
  ebooksim:              EbookSimConfig,
  ebook:                 EbookSimConfig,
  frendz:                FrendzConfig,
  atlas:                 AtlasConfig,
  comunidade:            ComunidadeConfig,
  'controle-motorista':  ControleMotoristaConfig,
  controle_motorista:    ControleMotoristaConfig,
  'return-bet':          ReturnBetConfig,
};

/**
 * Retorna a configuração do módulo pelo slug.
 * Retorna null se o módulo não existir ou não estiver registrado.
 */
export function getModuleConfig(slug: string | null | undefined): ModuleConfig | null {
  if (!slug) return null;
  return REGISTRY[slug.toLowerCase()] ?? null;
}

/**
 * Retorna o DOM token do módulo a partir da env var {SLUG}_DOM_TOKEN.
 */
export function getModuleDomToken(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const key = `${slug.toUpperCase()}_DOM_TOKEN`;
  const token = process.env[key];
  return token && token.length > 0 ? token : null;
}

/**
 * Resolve qual ADQUIRENTE uma loja/tenant usa.
 *
 * Fonte: env var `{SLUG}_ACQUIRER` (ex.: `RENOVADA_ACQUIRER=FRENDZ`). Ausente
 * ou inválida → DOM (default), preservando o comportamento atual de toda loja
 * que ainda não foi migrada. É aqui que se "liga" a Frendz, loja a loja.
 *
 * Mantido como função de env (espelhando getModuleDomToken) para a v1; quando
 * houver UI no painel, esta função passa a ler também de uma coluna no banco.
 */
export function getModuleAcquirer(slug: string | null | undefined): Acquirer {
  if (!slug) return toAcquirer(null);
  return toAcquirer(process.env[`${slug.toUpperCase()}_ACQUIRER`]);
}

export { REGISTRY as MODULE_REGISTRY };
export type { ModuleConfig };
