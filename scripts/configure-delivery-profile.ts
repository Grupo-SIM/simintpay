/** Operator command; dry-run by default. Never prints credential material. */
import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { encryptPlatformSecret } from '../src/modules/platform-integrations/platform-secrets';
async function main() {
const apply = process.argv.includes('--apply');
const prisma = new PrismaService();
try {
  const saved = await prisma.paymentIntegrationProfile.findUnique({ where: { code: 'DELIVERY' } });
  if (!apply) console.log(JSON.stringify({ code: 'DELIVERY', configured: !!saved, active: saved?.isActive ?? false, action: 'dry-run' }));
  else {
    const token = process.env.DELIVERY_DOM_TOKEN?.trim();
    if (!token) throw new Error('DELIVERY_DOM_TOKEN obrigatório; usar a mesma conta DOM do Delivery atual');
    await prisma.paymentIntegrationProfile.upsert({ where: { code: 'DELIVERY' }, create: { code: 'DELIVERY', encryptedCredential: encryptPlatformSecret(token), acquirer: 'DOM' }, update: { encryptedCredential: encryptPlatformSecret(token) } });
    console.log(JSON.stringify({ code: 'DELIVERY', action: 'configured' }));
  }
} finally { await prisma.$disconnect(); }

}
void main().catch(() => { console.error("Profile configuration failed; check local configuration without logging credentials"); process.exitCode = 1; });
