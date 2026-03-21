import type { ModuleConfig } from './module-config.interface';
import { RevalidaConfig }  from './revalida/revalida.config';
import { RenovadaConfig }  from './renovada/renovada.config';
import { BosqueConfig }    from './bosque/bosque.config';
import { PagaTGConfig }    from './pagatg/pagatg.config';
import { EbookSimConfig }  from './ebooksim/ebooksim.config';
import { FrendzConfig }    from './frendz/frendz.config';

/** Registro de todos os módulos indexados pelo slug */
const REGISTRY: Record<string, ModuleConfig> = {
  revalida:  RevalidaConfig,
  renovada:  RenovadaConfig,
  bosque:    BosqueConfig,
  pagatg:    PagaTGConfig,
  ebooksim:  EbookSimConfig,
  frendz:    FrendzConfig,
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

export { REGISTRY as MODULE_REGISTRY };
export type { ModuleConfig };
