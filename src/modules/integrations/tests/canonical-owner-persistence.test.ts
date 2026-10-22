import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { ProvisionDeliveryOwnerService } from '../provision-delivery-owner.service';
import { PlatformRegistrationsController } from '../platform-registrations.controller';
import { PlatformContextService } from '../../platform-core/platform-context.service';
import { encryptPlatformSecret } from '../../platform-integrations/platform-secrets';
// Explicit opt-in and loopback guard: this suite never uses the project's DATABASE_URL.
const local = process.env.CANONICAL_LOCAL_DATABASE_URL;
const enabled = !!local && new URL(local).hostname === '127.0.0.1';
const suite = enabled ? describe : describe.skip;
suite('canonical owner persistence (isolated local PostgreSQL)', () => {
 const suffix = Date.now().toString(36);
 const companyId = `company-${suffix}`;
 const email = `owner-${suffix}@local.test`;
 let baselineUsers = 0;
 let baselineWallets = 0;
 let baselinePlatforms = 0;
 let db: PrismaService;
 let owners: ProvisionDeliveryOwnerService;
 let controller: PlatformRegistrationsController;
 beforeAll(async () => {
  process.env.DATABASE_URL = local!;
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.SIM_DELIVERY_PROVISIONING_TOKEN = 'local-provision-token';
  process.env.JWT_SECRET = 'local-test-secret';
  db = new PrismaService();
  owners = new ProvisionDeliveryOwnerService(db, { sendPasswordReset: async () => {} } as never, new JwtService());
  controller = new PlatformRegistrationsController(db, owners);
  baselineUsers = await db.user.count(); baselineWallets = await db.wallet.count(); baselinePlatforms = await db.platform.count();
  await db.paymentIntegrationProfile.upsert({ where: { code: 'DELIVERY' }, create: { code: 'DELIVERY', isActive: false, encryptedCredential: encryptPlatformSecret('same-dom-account') }, update: { isActive: false } });
 });
 afterAll(async () => { await db.$disconnect(); });
 test('reservation creates no account; missing profile rolls whole owner transaction back', async () => {
  const result = await controller.reserve(companyId, { slug: `test-shop-${suffix}`, legalName: 'Shop' }, 'local-provision-token');
  expect(result.status).toBe('PENDING_OWNER');
  expect(await db.user.count()).toBe(baselineUsers);
  await expect(controller.owner(companyId, { slug: `test-shop-${suffix}`, legalName: 'Shop', email, password: 'secret123' }, 'local-provision-token')).rejects.toMatchObject({ status: 422 });
  expect(await db.user.count()).toBe(baselineUsers);
  expect(await db.wallet.count()).toBe(baselineWallets);
  expect(await db.platform.count()).toBe(baselinePlatforms);
 });
 test('completion, replay and recovery preserve identity, password, wallet and scoped access', async () => {
  await db.paymentIntegrationProfile.update({ where: { code: 'DELIVERY' }, data: { isActive: true } });
  const body = { slug: `test-shop-${suffix}`, legalName: 'Shop', email, password: 'secret123' };
  const first = await controller.owner(companyId, body, 'local-provision-token') as any;
  const user = await db.user.findUniqueOrThrow({ where: { email: body.email } });
  await db.wallet.update({ where: { userId: user.id }, data: { balance: 123.45 } });
  const second = await controller.owner(companyId, { ...body, password: 'different123' }, 'local-provision-token') as any;
  expect(second.credentials).toEqual(first.credentials);
  expect(second.merchant).toEqual(first.merchant);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
  expect(Number((await db.wallet.findUniqueOrThrow({ where: { userId: user.id } })).balance)).toBe(123.45);
  const recovered = await controller.reserve(companyId, { slug: `renamed-shop-${suffix}`, legalName: 'Shop' }, 'local-provision-token') as any;
  expect(recovered.credentials).toEqual(first.credentials);
  expect(recovered.platform.tag).toBe(first.platform.tag);
  const renamedReplay = await controller.owner(companyId, { ...body, slug: `renamed-shop-${suffix}` }, 'local-provision-token') as any;
  expect(renamedReplay.credentials).toEqual(first.credentials);
  const context = new PlatformContextService(db);
  expect((await context.authorize(first.platform.tag, 'payments:read', undefined, first.credentials.accessToken, companyId)).delivery?.merchantId).toBe(first.merchant.id);
  await expect(context.authorize(first.platform.tag, 'payments:read', undefined, first.credentials.accessToken, 'another-company')).rejects.toMatchObject({ status: 401 });
  expect(await db.integrationMerchant.count({ where: { externalMerchantId: companyId } })).toBe(1);
 });
 test('historical compatibility proves financial owner and unique platform marker without rewriting transactions', async () => {
  const registration = await db.deliveryPlatformRegistration.findUniqueOrThrow({ where: { externalMerchantId: companyId } });
  const platform = await db.platform.findUniqueOrThrow({ where: { id: registration.platformId! } });
  const owner = await db.user.findUniqueOrThrow({ where: { email } });
  const foreign = await db.user.create({ data: { email: `foreign-${suffix}@local.test`, name: 'Foreign', password: 'hash', isActive: true } });
  const good = await db.transaction.create({ data: { userId: owner.id, amount: 10, netAmount: 10, description: `[TENANT:${platform.tag}]`, status: 'PENDING', externalPaymentId: `good-${suffix}` } });
  const other = await db.transaction.create({ data: { userId: foreign.id, amount: 10, netAmount: 10, description: `[TENANT:${platform.tag}]`, status: 'PENDING', externalPaymentId: `foreign-${suffix}` } });
  const mixed = await db.transaction.create({ data: { userId: owner.id, amount: 10, netAmount: 10, description: `[TENANT:${platform.tag}][TENANT:OTHER]`, status: 'PENDING', externalPaymentId: `mixed-${suffix}` } });
  const result = await controller.compatibility(companyId, { references: [good.externalPaymentId!, other.externalPaymentId!, mixed.externalPaymentId!] }, 'local-provision-token');
  expect(result).toEqual({ compatible: false, conflicts: [other.externalPaymentId!, mixed.externalPaymentId!] });
  expect((await db.transaction.findUniqueOrThrow({ where: { id: other.id } })).userId).toBe(foreign.id);
  expect(Number((await db.wallet.findUniqueOrThrow({ where: { userId: owner.id } })).balance)).toBe(123.45);
 });

});
