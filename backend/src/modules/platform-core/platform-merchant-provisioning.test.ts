import { expect, mock, test } from 'bun:test';
import { PlatformMerchantProvisioning } from './platform-merchant-provisioning';

function fixture(existing = false, conflict = false) {
  const prisma = {
    user: {
      findUnique: mock(async ({ where }: any) =>
        where.id
          ? { id: 'user', isActive: true }
          : { id: conflict ? 'other' : 'user', isActive: true },
      ),
      update: mock(async ({ data }: any) => data),
    },
    integrationMerchant: {
      findUnique: mock(async ({ where }: any) =>
        where.integrationKey_externalMerchantId && existing
          ? { id: 'merchant', userId: 'user' }
          : null,
      ),
      create: mock(async ({ data }: any) => data),
      update: mock(async ({ data }: any) => data),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, service: new PlatformMerchantProvisioning(prisma as never) };
}

test('links existing CPF account using cpf rather than cnpj', async () => {
  const { prisma, service } = fixture();
  const merchant = await service.provision('sim-delivery_shop', 'company', {
    cnpj: '529.982.247-25',
    legalName: 'Shop',
  });
  expect(prisma.user.findUnique).toHaveBeenCalledWith({
    where: { cpf: '52998224725' },
  });
  expect(merchant).toMatchObject({ cnpj: '52998224725', userId: 'user' });
});

test('updates merchant owner document according to person type', async () => {
  for (const [cnpj, expected] of [
    ['52998224725', { cpf: '52998224725', cnpj: null, isCompany: false }],
    ['10802530000107', { cpf: null, cnpj: '10802530000107', isCompany: true }],
  ] as const) {
    const { prisma, service } = fixture(true);
    await service.provision('sim-delivery_shop', 'company', {
      cnpj,
      legalName: 'Shop',
    });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject(expected);
  }
});

test('rejects conflicting CPF and invalid documents before updates', async () => {
  const { prisma, service } = fixture(true, true);
  await expect(
    service.provision('sim-delivery_shop', 'company', {
      cnpj: '52998224725',
      legalName: 'Shop',
    }),
  ).rejects.toMatchObject({ status: 409 });
  for (const cnpj of ['123', '52998224724', '10802530000108', '11111111111']) {
    await expect(
      service.provision('sim-delivery_shop', 'company', {
        cnpj,
        legalName: 'Shop',
      }),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(prisma.user.update).not.toHaveBeenCalled();
});

function accountFixture(users: any[] = []) {
  const prisma: any = {
    user: {
      findUnique: mock(
        async ({ where }: any) =>
          users.find((u) =>
            Object.entries(where).every(([k, v]) => u[k] === v),
          ) ?? null,
      ),
      create: mock(async ({ data }: any) => {
        const row = { id: 'new', role: 'USER', ...data };
        users.push(row);
        return row;
      }),
      update: mock(async ({ where, data }: any) =>
        Object.assign(
          users.find((u) => u.id === where.id),
          data,
        ),
      ),
    },
    wallet: { upsert: mock(async () => ({})) },
    integrationMerchant: {
      findUnique: mock(async () => null),
      create: mock(async ({ data }: any) => data),
    },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { prisma, users, service: new PlatformMerchantProvisioning(prisma) };
}
const body = { cnpj: '52998224725', legalName: 'Maria' };

test('creates the account with an unusable random password and a wallet when only an e-mail is given', async () => {
  const { prisma, service } = accountFixture();
  const merchant = await service.provision('k', 'ext', {
    ...body,
    email: ' Maria@X.com ',
  });
  const data = prisma.user.create.mock.calls[0][0].data;
  expect(data).toMatchObject({
    email: 'maria@x.com',
    cpf: '52998224725',
    isCompany: false,
    wallet: { create: {} },
  });
  expect(data.password).toMatch(/^\$2[aby]\$/);
  expect(merchant).toMatchObject({ userId: 'new', accountCreated: true });
  expect(JSON.stringify(merchant)).not.toContain(data.password);
});

test('without e-mail the account must already exist (unchanged contract)', async () => {
  const { prisma, service } = accountFixture();
  await expect(service.provision('k', 'ext', body)).rejects.toMatchObject({
    status: 400,
  });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

test('never takes over an existing e-mail unless it has no document and the caller opted in', async () => {
  const taken = {
    id: 'u1',
    email: 'maria@x.com',
    isActive: true,
    role: 'USER',
    cpf: null,
    cnpj: null,
  };
  const a = accountFixture([{ ...taken }]);
  await expect(
    service(a).provision('k', 'ext', { ...body, email: 'maria@x.com' }),
  ).rejects.toMatchObject({ status: 409 });
  const b = accountFixture([{ ...taken, cpf: '11144477735' }]);
  await expect(
    service(b).provision('k', 'ext', {
      ...body,
      email: 'maria@x.com',
      adoptByEmail: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const c = accountFixture([{ ...taken, role: 'ADMIN' }]);
  await expect(
    service(c).provision('k', 'ext', {
      ...body,
      email: 'maria@x.com',
      adoptByEmail: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const d = accountFixture([{ ...taken }]);
  expect(
    await d.service.provision('k', 'ext', {
      ...body,
      email: 'maria@x.com',
      adoptByEmail: true,
    }),
  ).toMatchObject({ userId: 'u1', accountCreated: false });
  expect(d.users[0]).toMatchObject({ cpf: '52998224725', cnpj: null });
  expect(d.prisma.user.create).not.toHaveBeenCalled();
});

test('a document that already belongs to an account links it and ignores the e-mail', async () => {
  const { prisma, service } = accountFixture([
    { id: 'u9', email: 'other@x.com', isActive: true, cpf: '52998224725' },
  ]);
  expect(
    await service.provision('k', 'ext', { ...body, email: 'new@x.com' }),
  ).toMatchObject({ userId: 'u9', accountCreated: false });
  expect(prisma.user.create).not.toHaveBeenCalled();
});

test('a concurrent unique violation becomes a retryable 409', async () => {
  const { prisma, service } = accountFixture();
  const { Prisma } = await import('@prisma/client');
  prisma.user.create = async () => {
    throw new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
  };
  await expect(
    service.provision('k', 'ext', { ...body, email: 'a@b.co' }),
  ).rejects.toMatchObject({ status: 409 });
});
function service(f: { service: PlatformMerchantProvisioning }) {
  return f.service;
}
