/** Read-only audit. IDs and conflict codes only, no secrets or financial writes. */
import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
async function main() {
 const db = new PrismaService();
 try {
  const profile = await db.paymentIntegrationProfile.findUnique({ where: { code: 'DELIVERY' }, select: { id: true, isActive: true, acquirer: true } });
  const merchants = await db.integrationMerchant.findMany({ where: { OR: [{ integrationKey: { startsWith: 'sim-delivery_' } }, { integrationKey: { startsWith: 'platform:' } }] }, select: { id: true, externalMerchantId: true, integrationKey: true, userId: true, user: { select: { isActive: true, isPurged: true } } } });
  const bindings = await db.platformIntegration.findMany({ where: { key: 'LEGACY_MERCHANT_KEYS' }, select: { platformId: true, url: true } });
  const reservations = await db.deliveryPlatformRegistration.findMany({ select: { id: true, externalMerchantId: true, platformId: true } });
  const report = [];
  for (const merchant of merchants) {
   const conflicts: string[] = [];
   const registration = await db.deliveryPlatformRegistration.findUnique({ where: { externalMerchantId: merchant.externalMerchantId } });
   const credential = await db.platformApiCredential.findUnique({ where: { externalCompanyId: merchant.externalMerchantId }, select: { platformId: true, merchantId: true, isActive: true } });
   if (!merchant.integrationKey.startsWith('sim-delivery_') && !registration && !credential) continue;
   if (!profile?.isActive || profile.acquirer !== 'DOM') conflicts.push('PROFILE_NOT_CONFIGURED');
   if (!merchant.user.isActive || merchant.user.isPurged) conflicts.push('INACTIVE_ACCOUNT');
   const platformIds = merchant.integrationKey.startsWith('platform:') ? [merchant.integrationKey.slice(9)] : bindings.filter(b => b.url?.split(',').map(v => v.trim()).includes(merchant.integrationKey)).map(b => b.platformId);
   if (platformIds.length > 1) conflicts.push('AMBIGUOUS_PLATFORM');
   if (credential && (credential.merchantId !== merchant.id || !credential.isActive)) conflicts.push('CREDENTIAL_CONFLICT');
   if (platformIds.length === 1 && credential && credential.platformId !== platformIds[0]) conflicts.push('PLATFORM_CONFLICT');
   report.push({ companyId: merchant.externalMerchantId, merchantId: merchant.id, registrationId: registration?.id ?? null, platformIds, credentialConfigured: !!credential, conflicts });
  }
  console.log(JSON.stringify({ dryRun: true, profile, reservations: reservations.map(row => ({ registrationId: row.id, companyId: row.externalMerchantId, platformId: row.platformId, status: row.platformId ? 'READY' : 'PENDING_OWNER' })), merchants: report }, null, 2));
 } finally { await db.$disconnect(); }
}
void main().catch(() => { console.error('Audit failed; no data changed'); process.exitCode = 1; });
