import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { MaquinetasModule } from './presentation/maquinetas.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { RenovadaModule } from './modules/renovada/renovada.module';
import { RevalidaModule } from './modules/revalida/revalida.module';
import { BosqueModule } from './modules/bosque/bosque.module';
import { PagatgModule } from './modules/pagatg/pagatg.module';
import { MasterModule } from './modules/master/master.module';
import { AtlasModule } from './modules/atlas/atlas.module';
import { PixPlanModule } from './presentation/pix-plan.module';
import { SubscriptionLinkModule } from './presentation/subscription-link.module';
import { CheckoutModule } from './presentation/checkout.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
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
    PixPlanModule,
    SubscriptionLinkModule,
    CheckoutModule,
    SubscriptionModule,
    ReportModule,
    SettingsModule,
    WithdrawModule,
    LeadModule,
    AdminModule,
    MaquinetasModule,
    StorageModule,
    RenovadaModule,
    RevalidaModule,
    BosqueModule,
    PagatgModule,
    MasterModule,
    AtlasModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
