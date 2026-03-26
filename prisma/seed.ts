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

const MODULES = [
  { name: 'Revalida',  slug: 'revalida'  },
  { name: 'Renovada',  slug: 'renovada'  },
  { name: 'Bosque',    slug: 'bosque'    },
  { name: 'PagaTG',    slug: 'pagatg'    },
  { name: 'EbookSim',  slug: 'ebooksim'  },
  { name: 'Frendz',    slug: 'frendz'    },
];

async function seedModules() {
  for (const mod of MODULES) {
    await prisma.tenantModule.upsert({
      where: { slug: mod.slug },
      update: { name: mod.name },
      create: { name: mod.name, slug: mod.slug },
    });
    console.log(`  ✓ Módulo: ${mod.name} (${mod.slug})`);
  }
}

async function seedTestUser() {
  const email = 'teste@revalida.com.br';
  const password = 'Teste@123';
  const name = 'Usuário Teste';
  const balanceToCredit = 500; // R$ 500,00 disponível para solicitar saque

  // Garante que o módulo revalida existe
  const mod = await prisma.tenantModule.findUnique({ where: { slug: 'revalida' } });
  if (!mod) {
    console.log('  ⚠️  Módulo revalida não encontrado — rode seedModules primeiro');
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    // Atualiza saldo da wallet para garantir que tem fundos
    const wallet = await prisma.wallet.findUnique({ where: { userId: existing.id } });
    if (wallet) {
      await prisma.wallet.update({
        where: { userId: existing.id },
        data: { balance: balanceToCredit, lockedBalance: 0, version: { increment: 1 } },
      });
      console.log(`  ✓ Saldo do usuário teste atualizado para R$ ${balanceToCredit.toFixed(2)}`);
    }
    console.log(`  ✓ Usuário teste já existe: ${email} / ${password}`);
    return;
  }

  const hashed = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashed,
      role: 'USER',
      isActive: true,
      tenantModuleId: mod.id,
    },
  });

  await prisma.wallet.create({
    data: {
      userId: user.id,
      balance: balanceToCredit,
      lockedBalance: 0,
    },
  });

  await prisma.balanceLog.create({
    data: {
      userId: user.id,
      action: 'CREDIT_SEED',
      amount: balanceToCredit.toFixed(2),
      balanceBefore: '0.00',
      balanceAfter: balanceToCredit.toFixed(2),
      lockedBefore: '0.00',
      lockedAfter: '0.00',
      source: 'SEED',
      description: 'Saldo inicial para testes',
    },
  });

  console.log(`  ✓ Usuário teste criado: ${email} / ${password}`);
  console.log(`  ✓ Saldo inicial: R$ ${balanceToCredit.toFixed(2)} — módulo: ${mod.name}`);
}

async function seedBosqueUser() {
  const BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
  const BOSQUE_EMAIL = process.env.BOSQUE_EMAIL || 'contato@bosque.com.br';
  const BOSQUE_NAME = 'Bosque';

  const mod = await prisma.tenantModule.findUnique({ where: { slug: 'bosque' } });
  const hashed = await bcrypt.hash('password-migrated', 12);

  await prisma.user.upsert({
    where: { id: BOSQUE_ID },
    update: { email: BOSQUE_EMAIL, name: BOSQUE_NAME, domToken: null, ...(mod ? { tenantModuleId: mod.id } : {}) },
    create: {
      id: BOSQUE_ID,
      name: BOSQUE_NAME,
      email: BOSQUE_EMAIL,
      password: hashed,
      role: 'USER',
      domToken: null,
      ...(mod ? { tenantModuleId: mod.id } : {}),
    },
  });

  await prisma.wallet.upsert({
    where: { userId: BOSQUE_ID },
    update: {},
    create: { userId: BOSQUE_ID, balance: 0, lockedBalance: 0 },
  });

  console.log(`  ✓ Usuário Bosque: ${BOSQUE_EMAIL} (ID: ${BOSQUE_ID})`);
}

async function main() {
  // 1. Seed módulos
  console.log('\n📦 Módulos:');
  await seedModules();

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

  // 3. Seed usuário Bosque
  console.log('\n🌲 Usuário Bosque:');
  await seedBosqueUser();

  // 4. Seed usuário teste
  console.log('\n🧪 Usuário teste:');
  await seedTestUser();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
