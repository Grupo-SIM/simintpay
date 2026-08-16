import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SyncDomTransactionsUseCase } from '../src/application/use-cases/admin/sync-dom-transactions.use-case';

async function main(): Promise<void> {
  const userId = process.env.DOM_REPLICATION_USER_ID;
  if (!userId) throw new Error('DOM_REPLICATION_USER_ID é obrigatório');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  try {
    const result = await app.get(SyncDomTransactionsUseCase).execute({ userId });
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

void main();
