import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import {
  CanActivate,
  ExecutionContext,
  NotFoundException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { USER_REPOSITORY } from '../../core/repositories/user.repository.interface';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import {
  compatLinkControllers,
  legacyLinkControllers,
  legacyLinksCompatEnabled,
  paymentLinkToCreateOffer,
  paymentLinkToUpdateOffer,
  subscriptionLinkToCreateOffer,
} from './legacy-links.compat';
import {
  PaymentLinksCompatController,
  SubscriptionLinksCompatController,
} from './legacy-links.compat.controller';
import { LegacyLinksCompatService } from './legacy-links.compat.service';
import { OfferService } from './offer.service';

// Module imports pull the whole app graph; the first one is slow on a cold cache.
setDefaultTimeout(180_000);

const row = (over: Record<string, unknown> = {}): any => ({
  id: 'o-1',
  ownerUserId: 'u1',
  createdByUserId: 'u1',
  platformTag: null,
  code: 'ABCDE12345',
  kind: 'PAYMENT_LINK',
  name: 'Curso',
  description: null,
  amountCents: 9990,
  currency: 'BRL',
  isActive: true,
  acceptedMethods: ['CREDIT_CARD', 'DEBIT_CARD', 'PIX'],
  maxInstallments: 1,
  expiresAt: null,
  maxUses: null,
  usedCount: 0,
  renewalMode: 'NONE',
  intervalType: null,
  intervalCount: null,
  repetitions: null,
  fulfillment: null,
  createdAt: new Date('2026-01-02T03:04:05Z'),
  ...over,
});

describe('OFFER_LEGACY_LINKS_COMPAT flag', () => {
  test('is off unless exactly "1"', () => {
    expect(legacyLinksCompatEnabled({})).toBe(false);
    expect(legacyLinksCompatEnabled({ OFFER_LEGACY_LINKS_COMPAT: '0' })).toBe(
      false,
    );
    expect(legacyLinksCompatEnabled({ OFFER_LEGACY_LINKS_COMPAT: '1' })).toBe(
      true,
    );
  });

  test('exactly one of the two controller sets is active', () => {
    for (const on of [false, true]) {
      const env = { OFFER_LEGACY_LINKS_COMPAT: on ? '1' : undefined };
      const legacy = legacyLinkControllers(['legacy'], env);
      const compat = compatLinkControllers(['compat'], env);
      expect(legacy.length + compat.length).toBe(1);
      expect(legacy.length === 1).toBe(!on);
    }
  });
});

describe('modules mount exactly one controller per legacy path', () => {
  const pathsOf = (mod: unknown) =>
    (Reflect.getMetadata('controllers', mod as object) as object[]).map(
      (c) => Reflect.getMetadata('path', c) as string,
    );

  async function mounted(flag: '0' | '1') {
    // Module decorators read the env at import time: import fresh copies per setting.
    const before = process.env.OFFER_LEGACY_LINKS_COMPAT;
    process.env.OFFER_LEGACY_LINKS_COMPAT = flag;
    try {
      const q = `?flag=${flag}-${Math.random()}`;
      const pay = await import(`../../presentation/payment-link.module.ts${q}`);
      const sub = await import(
        `../../presentation/subscription-link.module.ts${q}`
      );
      const offer = await import(`./offer.module.ts${q}`);
      return [
        ...pathsOf(pay.PaymentLinkModule),
        ...pathsOf(sub.SubscriptionLinkModule),
        ...pathsOf(offer.OfferModule),
      ];
    } finally {
      if (before === undefined) delete process.env.OFFER_LEGACY_LINKS_COMPAT;
      else process.env.OFFER_LEGACY_LINKS_COMPAT = before;
    }
  }

  test('flag off: legacy controllers only', async () => {
    const paths = await mounted('0');
    expect(paths.filter((p) => p === 'links-pagamento')).toHaveLength(1);
    expect(paths.filter((p) => p === 'links-assinatura')).toHaveLength(1);
    expect(paths).toContain('subscription-links');
  });

  test('flag on: compat controllers only (still one per path)', async () => {
    const paths = await mounted('1');
    expect(paths.filter((p) => p === 'links-pagamento')).toHaveLength(1);
    expect(paths.filter((p) => p === 'links-assinatura')).toHaveLength(1);
    expect(paths).toContain('subscription-links');
  });

  test('the controller behind each path changes with the flag', async () => {
    const owners = async (flag: '0' | '1') => {
      const before = process.env.OFFER_LEGACY_LINKS_COMPAT;
      process.env.OFFER_LEGACY_LINKS_COMPAT = flag;
      try {
        const q = `?who=${flag}-${Math.random()}`;
        const pay = await import(
          `../../presentation/payment-link.module.ts${q}`
        );
        const offer = await import(`./offer.module.ts${q}`);
        return {
          legacy: (
            Reflect.getMetadata('controllers', pay.PaymentLinkModule) as {
              name: string;
            }[]
          ).map((c) => c.name),
          offer: (
            Reflect.getMetadata('controllers', offer.OfferModule) as {
              name: string;
            }[]
          ).map((c) => c.name),
        };
      } finally {
        if (before === undefined) delete process.env.OFFER_LEGACY_LINKS_COMPAT;
        else process.env.OFFER_LEGACY_LINKS_COMPAT = before;
      }
    };
    const off = await owners('0');
    expect(off.legacy).toEqual(['PaymentLinkController']);
    expect(off.offer).not.toContain('PaymentLinksCompatController');
    const on = await owners('1');
    expect(on.legacy).toEqual([]);
    expect(on.offer).toContain('PaymentLinksCompatController');
    expect(on.offer).toContain('SubscriptionLinksCompatController');
  });
});

describe('request translation', () => {
  test('payment link create: booleans become methods, card off forces 1x', () => {
    const dto = paymentLinkToCreateOffer({
      titulo: 'T',
      valor: 99.9,
      parcelasMax: 6,
      aceitaCartao: false,
      aceitaDebito: false,
      redirectUrl: 'https://x.com/ok',
      emailBody: ' hi ',
      dataExpiracao: '2030-01-01T00:00:00.000Z',
      plataformas: ['AREAFLIX'],
      webhookUrl: 'https://hook.example.com',
    } as any);
    expect(dto).toMatchObject({
      kind: 'PAYMENT_LINK',
      name: 'T',
      amountCents: 9990,
      acceptedMethods: ['PIX'],
      maxInstallments: 1,
      renewalMode: 'NONE',
      platformTag: 'AREAFLIX',
      fulfillment: { redirectUrl: 'https://x.com/ok', emailBody: 'hi' },
    });
    expect(JSON.stringify(dto)).not.toContain('hook.example.com');
  });

  test('two different platforms are refused like the native rule', () => {
    expect(() =>
      paymentLinkToCreateOffer({
        titulo: 'T',
        valor: 20,
        plataformas: ['A', 'B'],
      } as any),
    ).toThrow('única plataforma');
  });

  test('subscription create: frequency, methods and renewal mode', () => {
    const monthly = subscriptionLinkToCreateOffer({
      nome: 'S',
      valor: 30,
      frequencia: 'MENSAL',
      plataformas: ['AREAFLIX'],
      platformTag: 'AREAFLIX',
    } as any);
    expect(monthly).toMatchObject({
      kind: 'SUBSCRIPTION_LINK',
      renewalMode: 'AUTO_CHARGE',
      intervalType: 'MONTH',
      intervalCount: 1,
      acceptedMethods: ['CREDIT_CARD', 'PIX'],
      platformTag: 'AREAFLIX',
    });
    const weekly = subscriptionLinkToCreateOffer({
      nome: 'S',
      valor: 30,
      frequencia: 'SEMANAL',
      paymentMethods: 'PIX',
    } as any);
    expect(weekly).toMatchObject({
      renewalMode: 'MANUAL_PAY',
      intervalType: 'WEEK',
      acceptedMethods: ['PIX'],
    });
  });

  test('payment link update merges delivery and keeps files', () => {
    const existing = row({
      fulfillment: {
        files: [{ fileName: 'a.pdf', fileUrl: 'https://s.example.com/a.pdf' }],
        emailBody: 'old',
        redirectUrl: 'https://x.com/old',
      },
      maxInstallments: 3,
    });
    const dto = paymentLinkToUpdateOffer(
      { emailBody: 'new', aceitaCartao: false } as any,
      existing,
    );
    expect(dto.acceptedMethods).toEqual(['DEBIT_CARD', 'PIX']);
    expect(dto.maxInstallments).toBe(1);
    expect(dto.fulfillment).toMatchObject({
      emailBody: 'new',
      redirectUrl: 'https://x.com/old',
      files: [{ fileName: 'a.pdf' }],
    });
  });
});

describe('HTTP adapters (fake OfferService)', () => {
  let app: INestApplication;
  let base: string;
  const calls: { fn: string; args: unknown[] }[] = [];
  const store: any[] = [];

  const offers = {
    create: async (actor: any, dto: any, options?: any) => {
      calls.push({ fn: 'create', args: [actor, dto, options] });
      const created = row({
        id: `o-${store.length + 1}`,
        ownerUserId: actor.id,
        name: dto.name,
        amountCents: dto.amountCents,
        acceptedMethods: dto.acceptedMethods,
        renewalMode: dto.renewalMode ?? 'NONE',
        intervalType: dto.intervalType ?? null,
        intervalCount: dto.intervalCount ?? null,
        maxInstallments: dto.maxInstallments ?? 1,
      });
      store.push(created);
      return created;
    },
    get: async (actor: any, id: string) => {
      const found = store.find(
        (o) =>
          o.id === id && (actor.role === 'ADMIN' || o.ownerUserId === actor.id),
      );
      if (!found) throw new NotFoundException('Oferta não encontrada');
      return found;
    },
    update: async (actor: any, id: string, dto: any) => {
      calls.push({ fn: 'update', args: [actor, id, dto] });
      const found = await offers.get(actor, id);
      return Object.assign(found, {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      });
    },
    deactivate: async (actor: any, id: string) => {
      calls.push({ fn: 'deactivate', args: [actor, id] });
      const found = await offers.get(actor, id);
      found.isActive = false;
      return found;
    },
    list: async (actor: any, query: any) =>
      store.filter(
        (o) =>
          (actor.role === 'ADMIN' || o.ownerUserId === actor.id) &&
          o.renewalMode === query.renewalMode,
      ),
    getPublicByCode: async () => ({}),
  };

  class FakeGuard implements CanActivate {
    canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const who = req.headers['x-test-user'];
      if (!who) return false;
      req.user = {
        sub: String(who),
        role: req.headers['x-test-role'] ?? 'USER',
      };
      return true;
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        PaymentLinksCompatController,
        SubscriptionLinksCompatController,
      ],
      providers: [
        LegacyLinksCompatService,
        { provide: OfferService, useValue: offers },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: async () => [],
              findUnique: async () => ({ email: 'dono@test.dev' }),
            },
            $queryRaw: async () => [],
          },
        },
        {
          provide: USER_REPOSITORY,
          useValue: { findByEmail: async () => null },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  // The unit preload replaces global fetch, so talk to the local server over node:http.
  const call = (path: string, init: RequestInit = {}, user = 'u1') =>
    new Promise<{ status: number; json: () => Promise<unknown> }>(
      (resolve, reject) => {
        const url = new URL(`${base}${path}`);
        const req = httpRequest(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: init.method ?? 'GET',
            headers: {
              'content-type': 'application/json',
              ...(user ? { 'x-test-user': user } : {}),
              ...(init.headers as object),
            },
          },
          (res) => {
            let text = '';
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                json: async () => JSON.parse(text),
              }),
            );
          },
        );
        req.on('error', reject);
        if (init.body) req.write(init.body);
        req.end();
      },
    );

  test('requires authentication', async () => {
    expect((await call('/links-pagamento', {}, '')).status).toBe(403);
  });

  test('payment link CRUD returns the legacy shapes', async () => {
    const created = await call('/links-pagamento', {
      method: 'POST',
      body: JSON.stringify({ titulo: 'Curso', valor: 99.9, parcelasMax: 1 }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(Object.keys(body.data).sort()).toEqual(
      [
        'ativo',
        'codigo',
        'criadoEm',
        'dataExpiracao',
        'descricao',
        'id',
        'isStandalone',
        'parcelasMax',
        'titulo',
        'valor',
      ].sort(),
    );
    expect(body.data.valor).toBe(99.9);

    const got = (await (
      await call(`/links-pagamento/${body.data.id}`)
    ).json()) as any;
    expect(got.data.aceitaDebito).toBe(true);
    expect(got.data.webhookUrl).toBeNull();
    expect(got.data.files).toEqual([]);

    const updated = (await (
      await call(`/links-pagamento/${body.data.id}`, {
        method: 'PUT',
        body: JSON.stringify({ titulo: 'Novo' }),
      })
    ).json()) as any;
    expect(updated.data.titulo).toBe('Novo');

    const list = (await (await call('/links-pagamento')).json()) as any;
    expect(list).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(list.data[0].plataformas).toEqual([]);

    const del = await call(`/links-pagamento/${body.data.id}`, {
      method: 'DELETE',
    });
    expect(await del.json()).toEqual({ deleted: true });
  });

  test('the coproduction sent at creation is forwarded, not dropped', async () => {
    const agreement = {
      basis: 'NET',
      version: 0,
      participants: [{ email: 'co@test.dev', percentageBps: 1000 }],
    };
    calls.length = 0;
    const stored = store.length;
    const pay = await call('/links-pagamento', {
      method: 'POST',
      body: JSON.stringify({
        titulo: 'Co',
        valor: 50,
        coproduction: agreement,
      }),
    });
    expect(pay.status).toBe(201);
    const sub = await call('/links-assinatura', {
      method: 'POST',
      body: JSON.stringify({
        nome: 'CoS',
        valor: 50,
        frequencia: 'MENSAL',
        coproduction: agreement,
      }),
    });
    expect(sub.status).toBe(201);
    const creates = calls.filter((c) => c.fn === 'create');
    expect(creates).toHaveLength(2);
    for (const c of creates)
      expect(c.args[2]).toEqual({ coproduction: agreement });
    store.splice(stored);
  });

  test('legacy DTO validation still applies (unknown and invalid fields)', async () => {
    const res = await call('/links-pagamento', {
      method: 'POST',
      body: JSON.stringify({ titulo: 'x', valor: 'abc' }),
    });
    expect(res.status).toBe(400);
    const extra = await call('/links-assinatura', {
      method: 'POST',
      body: JSON.stringify({ nome: 'x', valor: 20, frequencia: 'DIARIA' }),
    });
    expect(extra.status).toBe(400);
  });

  test("another seller's link is a legacy 404 and wrong type is a 404", async () => {
    const created = (await (
      await call('/links-pagamento', {
        method: 'POST',
        body: JSON.stringify({ titulo: 'Meu', valor: 50 }),
      })
    ).json()) as any;
    const other = await call(`/links-pagamento/${created.data.id}`, {}, 'u2');
    expect(other.status).toBe(404);
    expect(((await other.json()) as any).message).toBe('Link não encontrado');
    const wrongType = await call(`/links-assinatura/${created.data.id}`);
    expect(wrongType.status).toBe(404);
    const admin = await call(
      `/links-pagamento/${created.data.id}`,
      {
        headers: { 'x-test-role': 'ADMIN' },
      },
      'u9',
    );
    expect(admin.status).toBe(200);
  });

  test('subscription link CRUD returns the legacy shapes', async () => {
    const created = await call('/links-assinatura', {
      method: 'POST',
      body: JSON.stringify({
        nome: 'Plano',
        valor: 29.9,
        frequencia: 'ANUAL',
        platformTag: 'AREAFLIX',
        plataformas: ['AREAFLIX'],
        webhookUrl: 'https://areaflix.example.com/webhooks-simpay',
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(body.data).toMatchObject({
      nome: 'Plano',
      valor: 29.9,
      frequencia: 'ANUAL',
      isStandalone: true,
      platformFee: 0,
      ativo: true,
    });
    const got = (await (
      await call(`/links-assinatura/${body.data.id}`)
    ).json()) as any;
    expect(got.data).toMatchObject({
      frequencia: 'ANUAL',
      frequencyType: 'ANUAL',
      paymentMethods: 'BOTH',
      ownerEmail: 'dono@test.dev',
      webhookUrl: null,
      communityId: null,
    });
    const list = (await (await call('/links-assinatura')).json()) as any;
    expect(list.total).toBe(1);
    expect(list.data[0]).toMatchObject({ usos: 0, maxUsos: null });
    const del = await call(`/links-assinatura/${body.data.id}`, {
      method: 'DELETE',
    });
    expect(await del.json()).toEqual({ deleted: true });
  });
});
