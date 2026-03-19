import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './infrastructure/database/prisma/prisma.module';
import { AuthModule } from './presentation/auth.module';
import { WebhookModule } from './presentation/webhook.module';
import { RabbitMqModule } from './infrastructure/queue/rabbitmq.module';
import { TransactionsModule } from './presentation/transactions.module';
import { PaymentLinkModule } from './presentation/payment-link.module';
import { PlanModule } from './presentation/plan.module';
import { SubscriptionModule } from './presentation/subscription.module';
import { ReportModule } from './presentation/report.module';
import { SettingsModule } from './presentation/settings.module';
import { WithdrawModule } from './presentation/withdraw.module';
import { LeadModule } from './presentation/lead.module';
import { AdminModule } from './presentation/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60000, // 1 minute
          limit: 60, // 60 requests per minute (authenticated)
        },
      ],
    }),
    PrismaModule,
    RabbitMqModule,
    AuthModule,
    WebhookModule,
    TransactionsModule,
    PaymentLinkModule,
    PlanModule,
    SubscriptionModule,
    ReportModule,
    SettingsModule,
    WithdrawModule,
    LeadModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
