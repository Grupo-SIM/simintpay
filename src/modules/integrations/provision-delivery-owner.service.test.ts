import { afterEach, describe, expect, mock, test } from 'bun:test';
import { compare } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ProvisionDeliveryOwnerService } from './provision-delivery-owner.service';
import { buildResetTokenSecret } from '../../application/use-cases/auth/forgot-password.use-case';

const secret = process.env.JWT_SECRET;
afterEach(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });
function fixture(existing: any = null) {
  const prisma = {
    platformIntegration: { findMany: mock(async () => [{ url: 'sim-delivery_shop', platform: { id: 'platform' } }]) },
    integrationMerchant: {
      findUnique: mock(async () => existing),
      create: mock(async ({ data }: any) => ({ id: 'merchant', ...data })),
      update: mock(async ({ data }: any) => ({ id: 'merchant', ...data })),
    },
    user: {
      findUnique: mock(async () => null as any),
      create: mock(async ({ data }: any) => ({ id: 'user', ...data })),
      update: mock(async ({ data }: any) => ({ ...existing?.user, ...data })),
    },
    wallet: { upsert: mock(async () => ({})) },
    $transaction: async (callback: any) => callback(prisma),
  };
  const email = { sendPasswordReset: mock(async (_input: any) => {}) };
  const service = new ProvisionDeliveryOwnerService(prisma as never, email as never, new JwtService());
  return { prisma, email, service };
}
const input = { email: ' OWNER@Example.com ', legalName: ' Shop ', password: 'secret123' };
const existing = { id: 'merchant', userId: 'user', user: { id: 'user', name: 'Shop', email: 'owner@example.com', password: 'unchanged', isActive: true, isPurged: false } };
const provision = (service: ProvisionDeliveryOwnerService, data = input) => service.execute('sim-delivery_shop', 'company', data);

describe('Sim Delivery first owner provisioning', () => {
  test('creates active user, zero wallet and association without CNPJ; hashes supplied password', async () => {
    const { prisma, email, service } = fixture();
    expect(await provision(service)).toEqual({ id: 'merchant' });
    const user = prisma.user.create.mock.calls[0][0].data;
    expect(user).toMatchObject({ email: 'owner@example.com', name: 'Shop', isActive: true, isCompany: false, wallet: { create: {} } });
    expect(user.cnpj).toBeUndefined();
    expect(await compare(input.password, user.password)).toBe(true);
    expect(prisma.integrationMerchant.create.mock.calls[0][0].data).toEqual({ integrationKey: 'sim-delivery_shop', externalMerchantId: 'company', userId: 'user', legalName: 'Shop', cnpj: null });
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });
  test('optional password sends valid SimIntPay reset link without exposing credentials', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { prisma, email, service } = fixture();
    await service.execute('sim-delivery_shop', 'company', { email: input.email, legalName: input.legalName });
    const token = new URL(email.sendPasswordReset.mock.calls[0][0].resetUrl).searchParams.get('token')!;
    const payload = await new JwtService().verifyAsync(token, { secret: buildResetTokenSecret(prisma.user.create.mock.calls[0][0].data.password) });
    expect(payload).toMatchObject({ sub: 'user', type: 'pwreset' });
  });
  test('retry preserves credentials, wallet balance and merchant identity', async () => {
    const { prisma, service } = fixture(existing);
    expect(await provision(service)).toEqual({ id: 'merchant' });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: 'Shop' });
    expect(prisma.wallet.upsert.mock.calls[0][0]).toEqual({ where: { userId: 'user' }, create: { userId: 'user' }, update: {} });
    expect(prisma.integrationMerchant.create).not.toHaveBeenCalled();
  });
  test('syncs normalized CNPJ to user and association', async () => {
    const { prisma, service } = fixture(existing);
    await service.execute('sim-delivery_shop', 'company', { ...input, cnpj: '10.802.530/0001-07' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ cnpj: '10802530000107', isCompany: true });
    expect(prisma.integrationMerchant.update.mock.calls[0][0].data.cnpj).toBe('10802530000107');
  });
  test('rejects unrelated existing email', async () => {
    const { prisma, service } = fixture(); prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(provision(service)).rejects.toMatchObject({ status: 409 });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  test('rejects different owner, inactive account and conflicting CNPJ', async () => {
    for (const user of [{ ...existing.user, email: 'other@example.com' }, { ...existing.user, isActive: false }, { ...existing.user, isPurged: true }]) {
      const { prisma, service } = fixture({ ...existing, user });
      await expect(provision(service)).rejects.toMatchObject({ status: 409 });
      expect(prisma.user.update).not.toHaveBeenCalled();
    }
    const { prisma, service } = fixture(existing); prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(service.execute('sim-delivery_shop', 'company', { ...input, cnpj: '10802530000107' })).rejects.toMatchObject({ status: 409 });
  });
  test('rejects invalid document, namespace and missing platform binding before writes', async () => {
    const { prisma, service } = fixture();
    await expect(service.execute('sim-delivery_shop', 'company', { ...input, cnpj: '123' })).rejects.toMatchObject({ status: 400 });
    await expect(service.execute('other', 'company', input)).rejects.toMatchObject({ status: 400 });
    prisma.platformIntegration.findMany.mockResolvedValue([]);
    await expect(provision(service)).rejects.toMatchObject({ status: 422 });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
  test('propagates email failure; retry reuses committed user', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { prisma, email, service } = fixture();
    email.sendPasswordReset.mockRejectedValueOnce(new Error('SMTP unavailable'));
    const data = { email: input.email, legalName: input.legalName };
    await expect(service.execute('sim-delivery_shop', 'company', data)).rejects.toThrow('SMTP unavailable');
    prisma.integrationMerchant.findUnique.mockResolvedValue(existing);
    await service.execute('sim-delivery_shop', 'company', data);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(2);
  });
});

test('creates and updates CPF owners as individuals and rejects another account document', async () => {
  for (const saved of [null, existing]) {
    const { prisma, service } = fixture(saved);
    await service.execute('sim-delivery_shop', 'company', { ...input, cnpj: '529.982.247-25' });
    const calls = saved ? prisma.user.update.mock.calls : prisma.user.create.mock.calls;
    expect(calls[0][0].data).toMatchObject({ cpf: '52998224725', cnpj: null, isCompany: false });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { cpf: '52998224725' } });
  }
  const { prisma, service } = fixture(existing);
  prisma.user.findUnique.mockResolvedValue({ id: 'another-user' });
  await expect(service.execute('sim-delivery_shop', 'company', { ...input, cnpj: '52998224725' })).rejects.toMatchObject({ status: 409 });
  expect(prisma.user.update).not.toHaveBeenCalled();
});
