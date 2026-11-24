import {
  draftFromAgreement,
  serializeAffiliates,
} from '@/features/affiliates/affiliates';
import type {
  AffiliateDraft,
  AffiliateDraftRow,
} from '@/features/affiliates/types';
import {
  formatPercentage,
  percentageBps,
  serializeParticipants,
} from '@/features/coproduction/coproduction';
import type { CoproducerDraft } from '@/features/coproduction/types';
import type {
  Agreements,
  ParticipationsContext,
  ParticipationsDraft,
  PersonDraft,
  SavePlan,
  SettingsDraft,
  ShareDraft,
  ShareKey,
} from './types';

export const SHARE_KEYS: ShareKey[] = [
  'coProduct',
  'affProduct',
  'coMargin',
  'affMargin',
];

export const MARGIN_SHARES: ShareKey[] = ['affMargin', 'coMargin'];

export const emailKey = (email: string) => email.trim().toLowerCase();

const off = (): ShareDraft => ({ on: false, percentage: '' });
const bpsText = (bps: number | null | undefined): string =>
  bps == null ? '' : formatPercentage(bps);

export function newPerson(): PersonDraft {
  return {
    id: crypto.randomUUID(),
    email: '',
    coProduct: off(),
    affProduct: off(),
    affMargin: off(),
    coMargin: off(),
  };
}

/** Projeção por e-mail dos três acordos numa lista única de pessoas. */
export function buildDraft(
  agreements: Agreements,
  context: ParticipationsContext,
): ParticipationsDraft {
  const map = new Map<string, PersonDraft>();
  const person = (email: string, name?: string) => {
    const key = emailKey(email);
    let current = map.get(key);
    if (!current) {
      current = { ...newPerson(), id: key, email: key };
      map.set(key, current);
    }
    if (name && !current.name) current.name = name;
    return current;
  };
  for (const row of agreements.co.participants)
    person(row.email, row.name).coProduct = {
      on: true,
      percentage: bpsText(row.percentageBps),
    };
  for (const row of agreements.aff.affiliates) {
    const target = person(row.email, row.name);
    target.affProduct = { on: true, percentage: bpsText(row.percentageBps) };
    if (row.code) target.code = row.code;
  }
  for (const row of agreements.margin?.affiliates ?? [])
    person(row.email, row.name).affMargin = {
      on: true,
      percentage: bpsText(row.percentageBps),
    };
  for (const row of agreements.margin?.coproducers ?? [])
    person(row.email, row.name).coMargin = {
      on: true,
      percentage: bpsText(row.percentageBps),
    };
  const product = draftFromAgreement(agreements.aff, context.platform);
  const margin = agreements.margin
    ? draftFromAgreement(agreements.margin, context.platform)
    : undefined;
  const settings: SettingsDraft = {
    mode: context.allowInheritance ? (agreements.co.mode ?? 'OWN') : 'OWN',
    defaultPercentage: product.defaultPercentage,
    renewals: product.renewals,
    linkBaseUrl: product.linkBaseUrl,
    marginDefaultPercentage: margin?.defaultPercentage ?? '',
    marginRenewals: margin?.renewals ?? 'all',
  };
  return { people: [...map.values()], settings };
}

export const coproducerRows = (draft: ParticipationsDraft): CoproducerDraft[] =>
  draft.people
    .filter((person) => person.coProduct.on)
    .map((person) => ({
      id: person.id,
      email: person.email,
      name: person.name,
      percentage: person.coProduct.percentage,
    }));

export const marginCoproducerRows = (
  draft: ParticipationsDraft,
): CoproducerDraft[] =>
  draft.people
    .filter((person) => person.coMargin.on)
    .map((person) => ({
      id: person.id,
      email: person.email,
      name: person.name,
      percentage: person.coMargin.percentage,
    }));

const affiliateRows = (
  draft: ParticipationsDraft,
  key: 'affProduct' | 'affMargin',
  exclude?: Set<string>,
): AffiliateDraftRow[] =>
  draft.people
    .filter((person) => person[key].on && !exclude?.has(emailKey(person.email)))
    .map((person) => ({
      id: person.id,
      email: person.email,
      name: person.name,
      ...(key === 'affProduct' && person.code ? { code: person.code } : {}),
      percentage: person[key].percentage,
    }));

export const productAffiliateDraft = (
  draft: ParticipationsDraft,
): AffiliateDraft => ({
  rows: affiliateRows(draft, 'affProduct'),
  defaultPercentage: draft.settings.defaultPercentage,
  renewals: draft.settings.renewals,
  linkBaseUrl: draft.settings.linkBaseUrl,
});

/** `exclude`: e-mails que já são coprodutores da margem (coprodutor vence o afiliado). */
export const marginAffiliateDraft = (
  draft: ParticipationsDraft,
  exclude?: Set<string>,
): AffiliateDraft => ({
  rows: affiliateRows(draft, 'affMargin', exclude),
  defaultPercentage: draft.settings.marginDefaultPercentage,
  renewals: draft.settings.marginRenewals,
  linkBaseUrl: '',
});

export const inheritsCoproduction = (
  draft: ParticipationsDraft,
  context: ParticipationsContext,
) => context.allowInheritance && draft.settings.mode === 'INHERIT';

/** Divide o rascunho nos payloads de cada acordo (só os que o usuário pode editar). */
export function splitDraft(
  draft: ParticipationsDraft,
  context: ParticipationsContext,
): SavePlan {
  const inherits = inheritsCoproduction(draft, context);
  const plan: SavePlan = {
    co: {
      participants: inherits
        ? []
        : serializeParticipants(coproducerRows(draft)),
      mode:
        context.allowInheritance || context.platform
          ? draft.settings.mode
          : undefined,
    },
    aff: serializeAffiliates(productAffiliateDraft(draft), context.platform),
  };
  if (context.admin) {
    const margin = serializeAffiliates(marginAffiliateDraft(draft), false);
    plan.margin = {
      defaultPercentageBps: margin.defaultPercentageBps,
      commissionOnRenewals: margin.commissionOnRenewals,
      affiliates: margin.affiliates,
      coproducers: marginCoproducerRows(draft).map((row) => ({
        email: emailKey(row.email),
        percentageBps: percentageBps(row.percentage),
      })),
    };
  }
  return plan;
}

const byEmail = <T extends { email: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.email.localeCompare(b.email));

const canonicalPart = (part: unknown): string => {
  const value = part as Record<string, unknown>;
  return JSON.stringify({
    ...value,
    ...(Array.isArray(value.participants)
      ? { participants: byEmail(value.participants) }
      : {}),
    ...(Array.isArray(value.affiliates)
      ? { affiliates: byEmail(value.affiliates) }
      : {}),
    ...(Array.isArray(value.coproducers)
      ? { coproducers: byEmail(value.coproducers) }
      : {}),
  });
};

/** Acordos cujo payload difere do baseline: só eles são enviados. */
export function changedParts(
  next: SavePlan,
  base: SavePlan,
): ('co' | 'aff' | 'margin')[] {
  const parts: ('co' | 'aff' | 'margin')[] = [];
  if (canonicalPart(next.co) !== canonicalPart(base.co)) parts.push('co');
  if (canonicalPart(next.aff) !== canonicalPart(base.aff)) parts.push('aff');
  if (
    next.margin &&
    canonicalPart(next.margin) !== canonicalPart(base.margin ?? {})
  )
    parts.push('margin');
  return parts;
}

export function upsertPerson(
  draft: ParticipationsDraft,
  person: PersonDraft,
): ParticipationsDraft {
  const exists = draft.people.some((item) => item.id === person.id);
  return {
    ...draft,
    people: exists
      ? draft.people.map((item) => (item.id === person.id ? person : item))
      : [...draft.people, person],
  };
}

export function hasShare(person: PersonDraft, admin: boolean): boolean {
  return SHARE_KEYS.some(
    (key) => person[key].on && (admin || !MARGIN_SHARES.includes(key)),
  );
}

/** Pessoas com alguma participação visível ao usuário (não admin não vê só-margem). */
export const visiblePeople = (draft: ParticipationsDraft, admin: boolean) =>
  draft.people.filter((person) => hasShare(person, admin));

export function personChips(
  person: PersonDraft,
  defaults: { affiliate?: string; margin?: string },
  admin: boolean,
): string[] {
  const pct = (share: ShareDraft) => `${share.percentage}%`;
  const chips: string[] = [];
  if (person.coProduct.on)
    chips.push(`Coprodutor · Produto ${pct(person.coProduct)}`);
  if (person.affProduct.on)
    chips.push(
      person.affProduct.percentage
        ? `Afiliado · Produto ${pct(person.affProduct)}`
        : `Afiliado · Produto padrão${defaults.affiliate ? ` ${defaults.affiliate}%` : ''}`,
    );
  if (admin && person.coMargin.on)
    chips.push(`Coprodutor · Margem ${pct(person.coMargin)}`);
  if (admin && person.affMargin.on)
    chips.push(
      person.affMargin.percentage
        ? `Afiliado · Margem ${pct(person.affMargin)}`
        : `Afiliado · Margem padrão${defaults.margin ? ` ${defaults.margin}%` : ''}`,
    );
  return chips;
}
