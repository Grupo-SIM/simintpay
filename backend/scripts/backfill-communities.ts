import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL não está definida');

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function getDaysForFrequency(frequencyType: string) {
  switch (frequencyType) {
    case 'TRIMESTRAL': return 90;
    case 'SEMESTRAL': return 180;
    case 'ANUAL': return 365;
    default: return 30;
  }
}

async function main() {
  const links = await prisma.subscriptionLink.findMany({
    include: {
      subscriptions: {
        where: { status: { in: ['active', 'trial', 'pending'] } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  let communitiesCreated = 0;
  let bindingsCreated = 0;
  let accessesCreated = 0;

  for (const link of links) {
    const communityName = (link.description || link.name).trim();
    const slug = slugify(communityName || link.name || 'comunidade');
    if (!slug) continue;

    const community = await prisma.community.upsert({
      where: { slug },
      update: { name: communityName || link.name },
      create: {
        slug,
        name: communityName || link.name,
        source: 'AUTOMATIC',
      },
    });

    if (community.createdAt.getTime() === community.updatedAt.getTime()) {
      communitiesCreated++;
    }

    const binding = await prisma.communityLinkBinding.findFirst({
      where: { subscriptionLinkId: link.id },
    });
    if (!binding) {
      await prisma.communityLinkBinding.create({
        data: {
          communityId: community.id,
          bindingType: 'SUBSCRIPTION_LINK',
          subscriptionLinkId: link.id,
          isManual: false,
        },
      });
      bindingsCreated++;
    }

    if (link.subscriptions.length === 0) continue;

    const firstOrder = link.subscriptions[0];
    const days = getDaysForFrequency(link.frequencyType);
    const now = new Date();

    const currentAccess = await prisma.communityAccess.findUnique({
      where: {
        communityId_userId: {
          communityId: community.id,
          userId: link.userId,
        },
      },
    });

    if (!currentAccess) {
      const startedAt = firstOrder.createdAt;
      const totalDaysCredited = Math.max(days, days * link.subscriptions.length);
      const expiresAt = new Date(startedAt.getTime() + totalDaysCredited * 24 * 60 * 60 * 1000);
      await prisma.communityAccess.create({
        data: {
          communityId: community.id,
          userId: link.userId,
          status: expiresAt > now ? 'ATIVA' : 'PLANO_ENCERRADO',
          isActive: expiresAt > now,
          startedAt,
          expiresAt,
          totalDaysCredited,
        },
      });
      accessesCreated++;
    }
  }

  console.log('Backfill concluído');
  console.log({ communitiesCreated, bindingsCreated, accessesCreated, totalLinks: links.length });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
