/** Operator command; dry-run by default. Never prints credential material. */
import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { ensureDeliveryProfile } from '../src/modules/integrations/delivery-integration-profile';
async function main() {
const apply = process.argv.includes('--apply');
const prisma = new PrismaService();
try {
  const saved = await prisma.paymentIntegrationProfile.findUnique({ where: { code: 'DELIVERY' } });
  if (!apply) console.log(JSON.stringify({ code: 'DELIVERY', configured: !!saved, active: saved?.isActive ?? false, action: 'dry-run' }));
  else {
    await ensureDeliveryProfile(prisma);
    console.log(JSON.stringify({ code: 'DELIVERY', action: 'configured' }));
  }
} finally { await prisma.$disconnect(); }

}
void main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  console.error('Profile configuration failed', {
    code,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    centralDomConfigured: Boolean(process.env.DOM_TOKEN?.trim() || process.env.API_DOM_MASTER_KEY?.trim()),
    encryptionKeyValid: /^[a-f0-9]{64}$/i.test(process.env.PLATFORM_CONFIG_ENCRYPTION_KEY ?? ''),
  });
  process.exitCode = 1;
});
