import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformsService } from './platforms.service';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { initializePlatformTaxasCache } from '../../modules/platform-taxas/platform-taxas.store';
import {
  decryptPlatformSecret,
  hashPlatformToken,
} from '../../modules/platform-integrations/platform-secrets';
import { DEFAULT_INBOUND_OPERATIONS } from '../../modules/platform-integrations/platform-integration-keys';

const encryptionKey = process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
afterEach(() => {
  if (encryptionKey === undefined)
    delete process.env.PLATFORM_CONFIG_ENCRYPTION_KEY;
  else process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = encryptionKey;
});
beforeEach(async () => {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  await initializePlatformTaxasCache({
    platformTaxaOverride: { findMany: async () => [] },
  } as never);
});

const user = { sub: 'owner', email: 'owner@example.com', role: 'USER' };

test('integration diagnostics report default scopes and preserve explicit restrictions', async () => {
  const platform = {
    id: 'platform',
    tag: 'SHOP',
    ownerUserId: 'owner',
    isActive: true,
    owner: { isActive: true, isPurged: false },
  };
  const prisma = {
    user: {
      findUnique: async () => ({
        role: 'ADMIN',
        isActive: true,
        isPurged: false,
      }),
    },
    platform: {
      findMany: async () => [
        { ...platform, integrations: [] },
        {
          ...platform,
          id: 'restricted',
          integrations: [{ key: 'INBOUND_OPERATIONS', url: 'payments:read' }],
        },
      ],
    },
  };
  const result = await new PlatformsService(
    prisma as never,
  ).integrationDiagnostics(user);
  expect(result.data[0].operations).toEqual([...DEFAULT_INBOUND_OPERATIONS]);
  expect(result.data[1].operations).toEqual(['payments:read']);
});

function service(
  platform = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner' },
) {
  const update = mock(async () => platform);
  const prisma = {
    financialPolicyRevision: { findMany: async () => [] },
    platform: { findUnique: mock(async () => platform), update },
    user: {
      findFirst: mock(async () => null),
      findUnique: mock(async () => ({
        id: 'owner',
        role: 'USER',
        isActive: true,
        isPurged: false,
      })),
    },
  };
  return {
    service: new PlatformsService(prisma as unknown as PrismaService),
    update,
  };
}

describe('Platform ownership', () => {
  test('admin must explicitly select a customer owner when creating a platform', async () => {
    const create = mock(async () => ({}));
    const prisma = {
      user: {
        findUnique: async () => ({
          role: 'ADMIN',
          isActive: true,
          isPurged: false,
        }),
      },
      platform: { create },
    };
    const service = new PlatformsService(prisma as never);
    await expect(
      service.create(
        { ...user, sub: 'admin' },
        { tag: 'ATLAS', name: 'Atlas' },
      ),
    ).rejects.toThrow('Informe a conta cliente');
    expect(create).not.toHaveBeenCalled();
  });
  test('admin can assign Grupo SIM ownership but cannot create or transfer to an admin', async () => {
    const rows: any[] = [];
    const platform = {
      id: 'atlas',
      tag: 'ATLAS',
      ownerUserId: 'grupo-sim',
      isActive: true,
    };
    const create = mock(async ({ data }: any) => {
      rows.push({ ...platform, ...data });
      return rows.at(-1);
    });
    const update = mock(async () => platform);
    const findFirst = mock(async ({ where }: any) =>
      where.id === 'grupo-sim' && where.role?.not === 'ADMIN'
        ? { id: 'grupo-sim' }
        : null,
    );
    const prisma = {
      user: {
        findUnique: async () => ({
          role: 'ADMIN',
          isActive: true,
          isPurged: false,
        }),
        findFirst,
      },
      platform: {
        create,
        update,
        findUnique: async () => platform,
        findMany: async () => rows,
      },
    };
    const service = new PlatformsService(prisma as never);
    const actor = { ...user, sub: 'admin' };
    await service.create(actor, {
      tag: 'ATLAS',
      name: 'Atlas',
      ownerUserId: 'grupo-sim',
    });
    await service.create(actor, {
      tag: 'AREAFLIX',
      name: 'Áreaflix',
      ownerUserId: 'grupo-sim',
    });
    expect(rows.map((row) => row.ownerUserId)).toEqual([
      'grupo-sim',
      'grupo-sim',
    ]);
    await expect(
      service.create(actor, {
        tag: 'SHOP',
        name: 'Shop',
        ownerUserId: 'admin',
      }),
    ).rejects.toThrow('conta cliente ativa');
    await expect(
      service.update('ATLAS', actor, { ownerUserId: 'admin' }),
    ).rejects.toThrow('conta cliente ativa');
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(
      findFirst.mock.calls.every(([arg]) => arg.where.role.not === 'ADMIN'),
    ).toBe(true);
  });
  test('owner cannot transfer platform', async () => {
    const fixture = service();
    await expect(
      fixture.service.update('SHOP', user, { ownerUserId: 'other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('different owner cannot edit platform', async () => {
    const fixture = service({
      id: 'platform',
      tag: 'SHOP',
      ownerUserId: 'other',
    });
    await expect(
      fixture.service.update('SHOP', user, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('owner cannot create platform assigned to another user', async () => {
    const fixture = service();
    await expect(
      fixture.service.create(user, {
        tag: 'SHOP',
        name: 'Shop',
        ownerUserId: 'other',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// No database or legacy module repository: products are Platform records only.
describe('Platform product ownership', () => {
  test('one owner creates multiple products without creating a module or replacing membership', async () => {
    const rows: any[] = [];
    const create = mock(async ({ data }: any) => {
      const row = {
        ...data,
        id: data.tag,
        isActive: true,
        acquirer: 'DOM',
        customerInterestRates: {},
      };
      rows.push(row);
      return row;
    });
    const prisma = {
      user: {
        findUnique: async () => ({
          role: 'USER',
          isActive: true,
          isPurged: false,
        }),
        findFirst: async () => ({ id: 'owner' }),
      },
      platform: { create, findMany: async () => rows },
    };
    const service = new PlatformsService(prisma as never);
    const actor = { sub: 'owner', role: 'USER' } as never;
    await service.create(actor, { tag: 'PRODUCT-A', name: 'A' });
    await service.create(actor, { tag: 'PRODUCT-B', name: 'B' });
    expect(rows.map((row) => row.ownerUserId)).toEqual(['owner', 'owner']);
    expect(rows.map((row) => row.tag)).toEqual(['PRODUCT-A', 'PRODUCT-B']);
    expect(rows.every((row) => row.absorbCustomerInterest === true)).toBe(true);
    expect(
      create.mock.calls.every(([arg]) => !('platformId' in arg.data)),
    ).toBe(true);
    const credentials = create.mock.calls.map(
      ([arg]) => arg.data.integrations.create,
    );
    const tokens = credentials.map((rows) =>
      decryptPlatformSecret(rows[0].encryptedValue),
    );
    expect(tokens[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens[0]).not.toBe(tokens[1]);
    credentials.forEach((rows, index) => {
      expect(rows[0].tokenHash).toBe(hashPlatformToken(tokens[index]));
      expect(rows[1]).toEqual({
        key: 'INBOUND_OPERATIONS',
        url: DEFAULT_INBOUND_OPERATIONS.join(','),
      });
      const secret = decryptPlatformSecret(rows[2].encryptedValue);
      expect(secret).toMatch(/^[a-f0-9]{64}$/);
      expect(secret).not.toBe(tokens[index]);
    });
  });
});

describe('Platform draft simulation', () => {
  test('simulates owner draft without persisting and rejects foreign owner', async () => {
    const fixture = service();
    const result = await fixture.service.simulateDraft('SHOP', user as never, {
      amount: 200,
      rates: { '2': 0.05 },
    });
    expect(result.data).toHaveLength(12);
    expect(result.data[1].interestAmount).toBe(10);
    expect(fixture.update).not.toHaveBeenCalled();
    await expect(
      service({
        id: 'p',
        tag: 'SHOP',
        ownerUserId: 'other',
      }).service.simulateDraft('SHOP', user as never, { amount: 200 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  test('rejects malformed draft rates and invalid amounts', async () => {
    await expect(
      service().service.simulateDraft('SHOP', user as never, {
        amount: 200,
        rates: { '13': 0.05 },
      }),
    ).rejects.toThrow();
    await expect(
      service().service.simulateDraft('SHOP', user as never, { amount: -1 }),
    ).rejects.toThrow();
  });
});

describe('Platform rate atomic update', () => {
  test('persists interest and absorption together, rejects invalid absorption before writing', async () => {
    let data: unknown;
    const platform = {
      id: 'p',
      tag: 'SHOP',
      ownerUserId: 'owner',
      customerInterestRates: {},
    };
    const update = mock(async (args: any) => {
      data = args.data;
      return { ...platform, ...args.data };
    });
    const prisma = {
      financialPolicyRevision: { findMany: async () => [] },
      user: {
        findUnique: async () => ({
          isActive: true,
          isPurged: false,
          role: 'USER',
        }),
      },
      platform: {
        findUnique: async () => platform,
        update,
        findMany: async () => [],
      },
      platformTaxaOverride: { findMany: async () => [] },
    };
    const service = new PlatformsService(prisma as never);
    await service.patchCustomerInterestRates('SHOP', user as never, {
      rates: { '2': 0.025 },
      absorbCustomerInterest: true,
    });
    expect(data).toEqual({
      customerInterestRates: { '2': 0.025 },
      absorbCustomerInterest: true,
    });
    await expect(
      service.patchCustomerInterestRates('SHOP', user as never, {
        absorbCustomerInterest: 'yes' as never,
      }),
    ).rejects.toThrow();
    expect(update).toHaveBeenCalledTimes(1);
    await service.patchCustomerInterestRates('SHOP', user as never, {
      absorbCustomerInterest: false,
    });
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe('owned catalogue scope', () => {
  test.each(['USER', 'ADMIN'])(
    'filters session-owned platforms for %s',
    async (role) => {
      const findMany = mock(async (args: any) => {
        void args;
        return [];
      });
      const prisma = {
        user: {
          findUnique: async () => ({ role, isActive: true, isPurged: false }),
        },
        platform: { findMany },
        $queryRaw: async () => [],
      };
      await new PlatformsService(prisma as never).list(user as never, true);
      expect(findMany.mock.calls[0][0].where).toEqual({ ownerUserId: 'owner' });
    },
  );
  test('shared platforms expose only read-only catalogue metadata', async () => {
    const platform = {
      id: 'shared',
      tag: 'SHARED',
      name: 'Shared',
      isActive: true,
      ownerUserId: 'other',
      acquirer: 'SECRET',
      customerInterestRates: { '1': 0.5 },
      absorbCustomerInterest: false,
    };
    let query = 0;
    const findMany = mock(async (args: any) => {
      void args;
      return [platform];
    });
    const prisma = {
      user: {
        findUnique: async () => ({
          role: 'USER',
          isActive: true,
          isPurged: false,
        }),
      },
      platform: { findMany },
      $queryRaw: async () =>
        ++query === 1
          ? [{ productId: 'shared' }]
          : [
              {
                productId: 'shared',
                participants: [{ userId: 'owner', percentageBps: 2500 }],
              },
            ],
    };
    const result = await new PlatformsService(prisma as never).list(
      user as never,
      true,
    );
    expect(findMany.mock.calls[0][0].where).toEqual({
      OR: [{ ownerUserId: 'owner' }, { id: { in: ['shared'] } }],
    });
    expect(result.data).toEqual([
      {
        id: 'shared',
        tag: 'SHARED',
        name: 'Shared',
        isActive: true,
        coproducao: {
          role: 'COPRODUCER',
          readOnly: true,
          participantsCount: 1,
          myPercentageBps: 2500,
        },
      },
    ]);
  });
  test('catalogue requires a user session', async () => {
    await expect(
      service().service.acquirers({
        ...user,
        authMode: 'integration',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Platform deletion', () => {
  function fixture(
    role = 'USER',
    ownerUserId = 'owner',
    platformExists = true,
  ) {
    const platform = { id: 'community', tag: 'COMUNIDADE', ownerUserId };
    const remove = mock(async () => platform);
    const findUnique = mock(async (args: unknown) => {
      void args;
      return platformExists ? platform : null;
    });
    const prisma = {
      user: {
        findUnique: async () => ({ role, isActive: true, isPurged: false }),
      },
      platform: { findUnique, delete: remove, findMany: mock(async () => []) },
    };
    return {
      service: new PlatformsService(prisma as never),
      remove,
      findUnique,
      prisma,
    };
  }

  test('owner deletes canonical tag and refreshes registry', async () => {
    const f = fixture();
    expect((await f.service.remove('comunidade', user)).data.tag).toBe(
      'COMUNIDADE',
    );
    expect(f.findUnique).toHaveBeenCalledWith({ where: { tag: 'COMUNIDADE' } });
    expect(f.remove.mock.calls[0]).toBeDefined();
    expect(f.prisma.platform.findMany).toHaveBeenCalledTimes(1);
  });

  test('admin can delete another owner platform', async () => {
    const f = fixture('ADMIN', 'other');
    await f.service.remove('COMUNIDADE', user);
    expect(f.remove).toHaveBeenCalledTimes(1);
  });

  test('foreign owners and integration sessions cannot delete', async () => {
    const f = fixture('USER', 'other');
    await expect(f.service.remove('COMUNIDADE', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      f.service.remove('COMUNIDADE', { ...user, authMode: 'integration' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.remove).not.toHaveBeenCalled();
  });

  test('missing platform returns 404 without deleting', async () => {
    const f = fixture('USER', 'owner', false);
    await expect(f.service.remove('COMUNIDADE', user)).rejects.toThrow(
      'Plataforma não cadastrada',
    );
    expect(f.remove).not.toHaveBeenCalled();
  });

  test('protected history returns conflict without refreshing registry', async () => {
    const { Prisma } = await import('@prisma/client');
    const f = fixture();
    f.remove.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Foreign key', {
        code: 'P2003',
        clientVersion: '7',
      });
    });
    await expect(f.service.remove('COMUNIDADE', user)).rejects.toThrow(
      'histórico vinculado',
    );
    expect(f.prisma.platform.findMany).not.toHaveBeenCalled();
  });
});
