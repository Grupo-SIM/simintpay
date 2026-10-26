import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const STORAGE_DIR = path.join(process.cwd(), 'storage');
const STORAGE_FILE = path.join(STORAGE_DIR, 'platform-taxas-overrides.json');

async function main() {
  console.log('Migrating platform taxa overrides...');

  if (!fs.existsSync(STORAGE_FILE)) {
    console.log('No existing JSON overrides file found. Nothing to migrate.');
    return;
  }

  const raw = fs.readFileSync(STORAGE_FILE, 'utf8');
  let overrides: Record<string, Record<string, number>>;
  try {
    overrides = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON file:', err);
    return;
  }

  let migratedCount = 0;

  for (const [tag, keys] of Object.entries(overrides)) {
    for (const [key, value] of Object.entries(keys)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        console.warn(`Skipping invalid value for tag ${tag}, key ${key}: ${value}`);
        continue;
      }
      await prisma.platformTaxaOverride.upsert({
        where: {
          tag_key: {
            tag,
            key,
          },
        },
        update: {
          value,
        },
        create: {
          tag,
          key,
          value,
        },
      });
      migratedCount++;
    }
  }

  console.log(`Migration complete! Successfully migrated ${migratedCount} override entries to the database.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
