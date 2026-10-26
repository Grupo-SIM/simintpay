import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não está definida');

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // 2. Seed admin
  const email = process.env.SEED_ADMIN_EMAIL ?? 'adminljl@simpay.com.br';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'xGzHA44e6L8';
  const name = process.env.SEED_ADMIN_NAME ?? 'Admin';
  const domToken = process.env.SEED_ADMIN_DOM_TOKEN ?? null;

  console.log('\n👤 Admin:');
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { role: 'ADMIN', ...(domToken ? { domToken } : {}) },
    });
    console.log(`  ✓ Usuário ${email} promovido para ADMIN`);
    if (domToken) console.log('  ✓ domToken atualizado');
  } else {
    const hashed = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        role: 'ADMIN',
        isActive: true,
        ...(domToken ? { domToken } : {}),
      },
    });

    await prisma.wallet.create({ data: { userId: user.id } });

    console.log(`  ✓ Admin criado: ${email} / ${password}`);
    if (domToken) console.log('  ✓ domToken salvo no admin');
    console.log('  ⚠️  Troque a senha após o primeiro acesso!');
  }


}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
