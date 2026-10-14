import { expect, mock, test } from 'bun:test';
import { Prisma } from '@prisma/client';
import { PlatformWebhookSettlement } from './platform-webhook-settlement';
import { BosqueWebhookService } from '../bosque/services/bosque-webhook.service';
import { BosqueWebhookController } from '../bosque/controllers/bosque-webhook.controller';
function fixture() {
  const platform = { id: 'p', tag: 'BOSQUE', acquirer: 'DOM' as const, ownerUserId: 'new-owner', isActive: true, owner: { isActive: true } };
  const payment = { id: 'tx', userId: 'original-owner', description: '[TENANT:BOSQUE]', amount: new Prisma.Decimal(10), netAmount: new Prisma.Decimal(9) };
  const prisma: any = { platform: { findUnique: async () => platform }, transaction: { findFirst: mock(async () => payment) } };
  const processor = { execute: mock(async () => {}) };
  return { platform, payment, prisma, processor, core: new PlatformWebhookSettlement(prisma, processor as any) };
}
test('Bosque legacy ingress and canonical settlement share normalized event, net and dedup key', async () => {
  const { prisma, processor, core, platform } = fixture();
  const alias = new BosqueWebhookController(new BosqueWebhookService(prisma, { get: () => processor } as any));
  const body = { event: 'payment', signature: 'legacy-signature', data: { id: 'remote', status: 'paid', amount: 99999 } };
  expect(await alias.domWebhook(body)).toBeUndefined();
  await core.apply(platform, body);
  expect(processor.execute.mock.calls[0][0]).toEqual(processor.execute.mock.calls[1][0]);
  expect(processor.execute.mock.calls[0][0]).toMatchObject({ transactionId: 'tx', payload: { data: { amountWithoutAllFee: 9, status: 'paid' } } });
});
test('conflicting marker cannot settle even if repository returns matching substring', async () => {
  const { core, platform, payment, processor } = fixture();
  payment.description = '[TENANT:BOSQUE] [TENANT:OTHER]';
  await expect(core.apply(platform, { data: { id: 'remote', status: 'paid' } })).rejects.toThrow('Pagamento fora da plataforma');
  expect(processor.execute).not.toHaveBeenCalled();
});
test('legacy missing-payment acknowledgment never delegates unscoped settlement', async () => {
  const { prisma, core, platform, processor } = fixture();
  prisma.transaction.findFirst.mockImplementation(async () => null);
  await core.apply(platform, { data: { id: 'remote', status: 'paid' } }, false);
  expect(processor.execute).not.toHaveBeenCalled();
});
