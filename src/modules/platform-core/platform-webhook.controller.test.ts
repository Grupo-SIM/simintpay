import { describe, test, expect, mock } from 'bun:test';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { encryptPlatformSecret } from '../platform-integrations/platform-secrets';
import { PlatformWebhookController } from './platform-webhook.controller';

process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
function fixture() {
  const platform = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner', acquirer: 'DOM' };
  const transaction = { id: 'local', netAmount: new Prisma.Decimal(9), amount: new Prisma.Decimal(10) };
  const contexts = { resolve: mock(async () => platform) };
  const prisma = { platformIntegration: { findUnique: mock(async () => ({ encryptedValue: encryptPlatformSecret('secret') })) }, transaction: { findFirst: mock(async () => transaction) } };
  const processor = { execute: mock(async () => {}) };
  return { controller: new PlatformWebhookController(contexts as never, prisma as never, processor as never), prisma, processor, platform };
}
const body = { data: { paymentId: 'payment', status: 'paid' } };
const rawBody = Buffer.from(JSON.stringify(body));
const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');

describe('PlatformWebhookController', () => {
  test('requires signature and scopes payment before shared processing', async () => {
    const { controller, prisma, processor } = fixture();
    await controller.handle('SHOP', 'dom', signature, { rawBody }, body);
    expect(prisma.transaction.findFirst.mock.calls[0][0].where).toMatchObject({ acquirer: 'DOM', description: { contains: '[TENANT:SHOP]' } });
    expect(processor.execute.mock.calls[0][0].payload.data.amountWithoutAllFee).toBe(9);
  });
  test('Frendz validates configured payload token without permissive fallback', async () => {
    const { controller, platform, processor } = fixture();
    platform.acquirer = 'FRENDZ';
    await controller.handle('SHOP', 'frendz', '', {}, { token: 'secret', status: 'paid', transaction: { id: 'payment', amount: 1000 } });
    expect(processor.execute).toHaveBeenCalledTimes(1);
    await expect(controller.handle('SHOP', 'frendz', '', {}, { token: 'wrong', status: 'paid', transaction: { id: 'payment' } })).rejects.toMatchObject({ status: 401 });
  });
  test('rejects forged signature before lookup or persistence', async () => {
    const { controller, prisma, processor } = fixture();
    await expect(controller.handle('SHOP', 'dom', 'forged', { rawBody }, body)).rejects.toMatchObject({ status: 401 });
    expect(prisma.transaction.findFirst).not.toHaveBeenCalled();
    expect(processor.execute).not.toHaveBeenCalled();
  });
  test('rejects payment belonging to different platform', async () => {
    const { controller, prisma, processor } = fixture();
    prisma.transaction.findFirst.mockResolvedValue(null as never);
    await expect(controller.handle('SHOP', 'dom', signature, { rawBody }, body)).rejects.toMatchObject({ status: 401 });
    expect(processor.execute).not.toHaveBeenCalled();
  });
  test('does not select different acquirer or allow unconfigured secret', async () => {
    const { controller, prisma } = fixture();
    await expect(controller.handle('SHOP', 'frendz', signature, { rawBody }, body)).rejects.toMatchObject({ status: 422 });
    prisma.platformIntegration.findUnique.mockResolvedValue(null as never);
    await expect(controller.handle('SHOP', 'dom', signature, { rawBody }, body)).rejects.toMatchObject({ status: 401 });
  });
});
