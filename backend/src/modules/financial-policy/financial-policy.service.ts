import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, type PlatformFeeMode } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import {
  calculateFinancials,
  defaultOwner,
  emptyPolicy,
  laneKey,
  ownerResult,
  pricingLaneKey,
  resolvePolicy,
  validatePolicy,
  validateKey,
  type Channel,
  type Method,
  type Policy,
  type ResolvedPolicy,
} from './financial-policy';
import {
  readAdditiveFees,
  setAdditiveFees,
  validateAdditiveTotals,
  type AdditiveFeesView,
} from '../additive-fees/additive-fees.service';
import { listAcquirerFees } from './acquirer-fees';

type Client = Pick<
  Prisma.TransactionClient,
  'financialPolicyRevision' | 'platform'
>;
export async function loadFinancialPolicy(
  prisma: Client,
  tag: string,
  at?: Date,
): Promise<ResolvedPolicy> {
  const rows = await prisma.financialPolicyRevision.findMany({
    where: {
      tag: { in: ['GLOBAL', tag] },
      ...(at ? { createdAt: { lte: at } } : {}),
    },
    orderBy: { version: 'desc' },
    distinct: ['tag'],
  });
  const global = rows.find((row) => row.tag === 'GLOBAL'),
    own = tag === 'GLOBAL' ? undefined : rows.find((row) => row.tag === tag);
  const resolved =
    tag === 'GLOBAL'
      ? resolvePolicy(
          emptyPolicy(),
          (global?.document as Policy | undefined) ?? emptyPolicy(),
          `${global?.version ?? 0}:0`,
        )
      : resolvePolicy(
          (global?.document as Policy | undefined) ?? emptyPolicy(),
          (own?.document as Policy | undefined) ?? emptyPolicy(),
          `${global?.version ?? 0}:${own?.version ?? 0}`,
        );
  // Current quotes only pass contracted interest. Historical restores resolve their frozen documents directly.
  resolved.document.interestOnly = true;
  // Materialize current defaults so frozen snapshots preserve their exact owner rule.
  for (const key of Object.keys(resolved.document.lanes)) {
    resolved.document.owner[key] ??= {
      ...defaultOwner(),
      passInterestPpm: key.includes('/CREDIT_CARD/') ? 1_000_000 : 0,
    };
  }
  return resolved;
}

/** No internal acquirer fields leave this projection. */
export function projectPolicy(
  policy: ResolvedPolicy,
  admin: boolean,
  feeMode: PlatformFeeMode | null = null,
  disabledLanes: string[] | null = null,
  additiveFees: AdditiveFeesView | null = null,
) {
  const { version, sources } = policy;
  return {
    version,
    sources,
    feeMode,
    disabledLanes,
    ownerOverrides: policy.own.owner,
    globalOwner: policy.global.owner,
    owner: policy.document.owner,
    interestFree: !!policy.document.interestFree,
    interestFreeOverride: policy.own.interestFree ?? null,
    globalInterestFree: policy.global.interestFree ?? false,
    keys: Object.keys(policy.document.lanes),
    ...(admin
      ? {
          lanes: policy.document.lanes,
          laneOverrides: policy.own.lanes,
          globalLanes: policy.global.lanes,
          ...(additiveFees ? { additiveFees } : {}),
        }
      : {}),
  };
}

async function authorize(prisma: PrismaService, tag: string, user: JwtPayload) {
  if (!user?.sub || user.authMode === 'integration')
    throw new ForbiddenException('Exige sessão de usuário');
  const actor = await prisma.user.findUnique({
    where: { id: user.sub },
    select: { role: true, isActive: true, isPurged: true },
  });
  if (!actor?.isActive || actor.isPurged)
    throw new ForbiddenException('Conta inativa');
  const admin = actor.role === Role.ADMIN;
  if (tag === 'GLOBAL') {
    if (!admin) throw new ForbiddenException('Exige administrador');
  } else {
    const platform = await prisma.platform.findUnique({
      where: { tag },
      select: { ownerUserId: true },
    });
    if (!platform) throw new NotFoundException('Plataforma não cadastrada');
    if (!admin && platform.ownerUserId !== user.sub)
      throw new ForbiddenException('Plataforma pertence a outro usuário');
  }
  return admin;
}

/** GLOBAL has no platform row, so it carries no fee mode. */
async function platformFeeMode(
  prisma: Pick<Prisma.TransactionClient, 'platform'>,
  tag: string,
): Promise<PlatformFeeMode | null> {
  if (tag === 'GLOBAL') return null;
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { feeMode: true },
  });
  return platform?.feeMode ?? null;
}

/** Admin view of generic additive totals and revision; GLOBAL has none. */
async function adminAdditiveFees(
  prisma: Pick<Prisma.TransactionClient, 'platform' | 'platformAdditiveFees'>,
  tag: string,
  admin: boolean,
): Promise<AdditiveFeesView | null> {
  if (!admin || tag === 'GLOBAL') return null;
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { id: true },
  });
  return readAdditiveFees(prisma, platform?.id ?? '');
}

/** Lanes (`METHOD/installments`) the platform does not accept. GLOBAL has none. */
async function platformDisabledLanes(
  prisma: Pick<Prisma.TransactionClient, 'platform'>,
  tag: string,
): Promise<string[] | null> {
  if (tag === 'GLOBAL') return null;
  const platform = await prisma.platform.findUnique({
    where: { tag },
    select: { disabledPaymentLanes: true },
  });
  return platform?.disabledPaymentLanes ?? null;
}

export async function getFinancialPolicy(
  prisma: PrismaService,
  tag: string,
  user: JwtPayload,
) {
  const admin = await authorize(prisma, tag, user);
  return {
    data: projectPolicy(
      await loadFinancialPolicy(prisma, tag),
      admin,
      await platformFeeMode(prisma, tag),
      await platformDisabledLanes(prisma, tag),
      await adminAdditiveFees(prisma, tag, admin),
    ),
  };
}

export async function saveFinancialPolicy(
  prisma: PrismaService,
  tag: string,
  user: JwtPayload,
  body: unknown,
) {
  const admin = await authorize(prisma, tag, user);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException('Configuração inválida');
  const input = body as {
    version?: unknown;
    owner?: unknown;
    interestFree?: unknown;
    lanes?: unknown;
    feeMode?: unknown;
    disabledLanes?: unknown;
    additiveFees?: unknown;
  };
  if (
    Object.keys(body).some(
      (key) =>
        ![
          'version',
          'owner',
          'interestFree',
          'lanes',
          'feeMode',
          'disabledLanes',
          'additiveFees',
        ].includes(key),
    )
  )
    throw new BadRequestException('Campo não permitido');
  if (!admin && input.lanes !== undefined)
    throw new ForbiddenException(
      'Custos SimIntPay exclusivos do administrador',
    );
  if (input.feeMode !== undefined) {
    if (!admin)
      throw new ForbiddenException('Modo de taxas exclusivo do administrador');
    if (
      tag === 'GLOBAL' ||
      !['SIMINTPAY_ONLY', 'ADDITIVE_ONLY', 'BOTH'].includes(
        String(input.feeMode),
      )
    )
      throw new BadRequestException('Modo de taxas inválido');
  }
  if (input.additiveFees !== undefined) {
    if (!admin)
      throw new ForbiddenException(
        'Taxas aditivas exclusivas do administrador',
      );
    if (tag === 'GLOBAL')
      throw new BadRequestException('Taxas aditivas inválidas');
    input.additiveFees = validateAdditiveTotals(input.additiveFees);
  }
  if (input.disabledLanes !== undefined) {
    // Admins and the platform owner (checked by `authorize`) both choose which lanes the platform offers.
    if (
      tag === 'GLOBAL' ||
      !Array.isArray(input.disabledLanes) ||
      input.disabledLanes.length > 14 ||
      input.disabledLanes.some(
        (lane) =>
          typeof lane !== 'string' ||
          !/^(PIX|BOLETO|DEBIT_CARD|CREDIT_CARD)\/\d{1,2}$/.test(lane),
      )
    )
      throw new BadRequestException('Modalidades desabilitadas inválidas');
  }
  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await loadFinancialPolicy(tx, tag);
        if (input.version !== current.version)
          throw new ConflictException(
            'Configuração alterada. Recarregue antes de salvar.',
          );
        const previous = await tx.financialPolicyRevision.findFirst({
          where: { tag },
          orderBy: { version: 'desc' },
        });
        const document = structuredClone(
          (previous?.document as Policy | undefined) ?? emptyPolicy(),
        );
        if (input.owner !== undefined)
          document.owner = input.owner as Policy['owner'];
        if (input.interestFree === null) delete document.interestFree;
        else if (input.interestFree !== undefined)
          document.interestFree = input.interestFree as boolean;
        if (input.lanes !== undefined)
          document.lanes = input.lanes as Policy['lanes'];
        document.interestOnly = true;
        validatePolicy(document);
        if (input.feeMode !== undefined)
          await tx.platform.update({
            where: { tag },
            data: { feeMode: input.feeMode as PlatformFeeMode },
          });
        if (input.disabledLanes !== undefined)
          await tx.platform.update({
            where: { tag },
            data: {
              disabledPaymentLanes: [
                ...new Set(input.disabledLanes as string[]),
              ].sort(),
            },
          });
        if (input.additiveFees !== undefined) {
          const platform = await tx.platform.findUnique({
            where: { tag },
            select: { id: true },
          });
          if (!platform) throw new BadRequestException('Plataforma inválida');
          await setAdditiveFees(
            tx,
            platform.id,
            input.additiveFees as Parameters<typeof setAdditiveFees>[2],
          );
        }
        if (input.lanes !== undefined) {
          const codes = [
            ...new Set(
              Object.keys(document.lanes).map((key) => key.split('/')[0]),
            ),
          ];
          const registered = await tx.acquirerCatalogue.findMany({
            where: { code: { in: codes } },
            select: { code: true },
          });
          const known = new Set(registered.map((row) => row.code));
          if (codes.some((code) => !known.has(code)))
            throw new BadRequestException('Adquirente não cadastrada');
        }
        // Global inheritance remains explicit: omitted keys inherit, zero stays an override.
        await tx.financialPolicyRevision.create({
          data: {
            tag,
            version: (previous?.version ?? 0) + 1,
            actorId: user.sub,
            document: document as Prisma.InputJsonValue,
          },
        });
        return {
          data: projectPolicy(
            await loadFinancialPolicy(tx, tag),
            admin,
            await platformFeeMode(tx, tag),
            await platformDisabledLanes(tx, tag),
            await adminAdditiveFees(tx, tag, admin),
          ),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2034'].includes(error.code)
    )
      throw new ConflictException(
        'Configuração alterada. Recarregue antes de salvar.',
      );
    if (error instanceof Error && !(error instanceof ConflictException))
      throw new BadRequestException(error.message);
    throw error;
  }
}

export type SimulationInput = {
  version?: string;
  amountCents: number;
  acquirer: string;
  method: Method;
  channel: Channel;
  installments: number[];
  draft?: {
    owner?: Policy['owner'];
    interestFree?: boolean;
    lanes?: Policy['lanes'];
  };
};
export async function simulateFinancialPolicy(
  prisma: PrismaService,
  tag: string,
  user: JwtPayload,
  body: SimulationInput,
) {
  const admin = await authorize(prisma, tag, user);
  if (
    !body ||
    !Array.isArray(body.installments) ||
    body.installments.length === 0 ||
    body.installments.length > 12 ||
    new Set(body.installments).size !== body.installments.length
  )
    throw new BadRequestException('Informe parcelas solicitadas');
  let policy = await loadFinancialPolicy(prisma, tag);
  if (body.version !== undefined && body.version !== policy.version)
    throw new ConflictException(
      'Configuração alterada. Recarregue antes de simular.',
    );
  const draft = body.draft;
  if (draft) {
    if (
      Object.keys(draft).some(
        (key) => !['owner', 'interestFree', 'lanes'].includes(key),
      )
    )
      throw new BadRequestException('Rascunho inválido');
    if (!admin && draft.lanes !== undefined)
      throw new ForbiddenException(
        'Custos SimIntPay exclusivos do administrador',
      );
    policy = resolvePolicy(
      policy.global,
      { ...policy.own, ...draft },
      policy.version,
    );
  }
  try {
    policy.document.interestOnly = true;
    for (const key of Object.keys(policy.document.lanes)) {
      policy.document.owner[key] ??= {
        ...defaultOwner(),
        passInterestPpm: key.includes('/CREDIT_CARD/') ? 1_000_000 : 0,
      };
    }
    validatePolicy(policy.document);
    const feeRows = await Promise.all(
      body.installments.map(async (n) => ({
        n,
        fees:
          prisma.acquirerFeeSchedule && prisma.acquirerCatalogue
            ? await listAcquirerFees(prisma, body.method, body.channel, n)
            : [],
      })),
    );
    const data = body.installments.map((n) => {
      if (!Number.isInteger(n)) throw new Error('Parcela inválida');
      const routeKey = laneKey(body.acquirer, body.method, body.channel, n);
      validateKey(routeKey);
      // A row failure never suppresses other rows.
      try {
        const fees = feeRows.find((row) => row.n === n)?.fees ?? [];
        const scheduled =
          prisma.acquirerFeeSchedule && prisma.acquirerCatalogue
            ? {
                fees: fees.map(({ createdAt, ...fee }) => ({
                  ...fee,
                  createdAt: createdAt.toISOString(),
                })),
                routedAcquirer: body.acquirer,
              }
            : undefined;
        const key = scheduled
          ? (pricingLaneKey(
              policy,
              scheduled.fees,
              body.method,
              body.channel,
              n,
            ) ?? routeKey)
          : routeKey;
        const result = calculateFinancials(
          policy,
          key,
          body.amountCents,
          undefined,
          scheduled,
        );
        // Unknown processor costs are never presented as realized zero profit.
        const adminResult =
          'pricingAcquirer' in result && result.pricingAcquirer === null
            ? {
                ...result,
                acquirerCostCents: null,
                acquirerProcessingCents: null,
                acquirerInterestCents: null,
                simMarginCents: null,
              }
            : result;
        return {
          installments: n,
          result: admin ? adminResult : ownerResult(result),
        };
      } catch (error) {
        return {
          installments: n,
          error: error instanceof Error ? error.message : 'Falha ao calcular',
        };
      }
    });
    return { data, version: policy.version };
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Rascunho inválido',
    );
  }
}
