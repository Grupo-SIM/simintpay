import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SyncDomTransactionsUseCase } from '../src/application/use-cases/admin/sync-dom-transactions.use-case';
import { USER_REPOSITORY } from '../src/core/repositories/user.repository.interface';
import { PrismaModule } from '../src/infrastructure/database/prisma/prisma.module';
import { PrismaUserRepository } from '../src/infrastructure/database/repositories/prisma-user.repository';
import { ApiDomModule } from '../src/infrastructure/http/api-dom.module';

@Module({
  imports: [PrismaModule, ApiDomModule],
  providers: [
    SyncDomTransactionsUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
class DomReplicationModule {}

async function main(): Promise<void> {
  const userId = process.env.DOM_REPLICATION_USER_ID;
  if (!userId) throw new Error('DOM_REPLICATION_USER_ID é obrigatório');
  const app = await NestFactory.createApplicationContext(DomReplicationModule, { logger: ['log', 'warn', 'error'] });
  try {
    const result = await app.get(SyncDomTransactionsUseCase).execute({
      userId,
      beginDate: process.env.DOM_REPLICATION_BEGIN_DATE,
      endDate: process.env.DOM_REPLICATION_END_DATE,
    });
    console.log(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

void main();
