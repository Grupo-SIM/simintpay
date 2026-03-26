import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WithdrawStatus, Prisma } from '@prisma/client';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';

@Injectable()
export class SyncDomWithdrawalsUseCase {
  private readonly logger = new Logger(SyncDomWithdrawalsUseCase.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly prisma: PrismaService,
  ) {}

  private mapStatus(domStatus: string): WithdrawStatus {
    const s = domStatus.toLowerCase();
    
    // Status de sucesso/pago na DOM
    if (
      s.includes('approve') ||
      s.includes('paid') ||
      s === 'ok' ||
      s === 'completed' ||
      s === 'success' ||
      s === 'pago'
    ) {
      return WithdrawStatus.APPROVED;
    }

    // Status de erro/rejeição na DOM
    if (
      s.includes('reject') || 
      s.includes('cancel') || 
      s === 'error' || 
      s === 'failed' || 
      s === 'rejeitado' ||
      s === 'cancelado'
    ) {
      return WithdrawStatus.REJECTED;
    }

    // Pendente por padrão
    return WithdrawStatus.PENDING;
  }

  async execute(input: { userId: string }): Promise<{ created: number; updated: number; total: number }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    // 1. Prioridade: Token individual do usuário
    let domToken = (user as any).domToken;
    let source = 'Individual';

    // 2. Fallback: Token do Módulo (Revalida, Renovada, etc)
    if (!domToken && (user as any).tenantModuleId) {
      const module = await this.prisma.tenantModule.findUnique({
        where: { id: (user as any).tenantModuleId },
      });
      if (module) {
        const envKey = `${module.slug.toUpperCase()}_DOM_TOKEN`;
        domToken = process.env[envKey];
        source = `Módulo (${module.slug})`;
      }
    }

    // 3. Fallback Master (Para o admin principal)
    if (!domToken) {
       domToken = process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY;
       source = 'Master/BFF';
    }

    if (!domToken) {
      throw new BadRequestException(
        'Nenhum Token (Individual, Módulo ou Master) encontrado para sincronização.',
      );
    }

    this.logger.log(`Usando Token ${source} para sincronizar usuários do Breno...`);

    let page = 1;
    const limit = 50;
    let created = 0;
    let updated = 0;
    let total = 0;

    while (true) {
      this.logger.log(`Buscando página ${page} de saques da DOM...`);
      const result = await this.gateway.listDomWithdraws(domToken, { page, limit });
      const { withdraws } = result;

      if (!withdraws || withdraws.length === 0) break;

      total += withdraws.length;

      for (const dw of withdraws) {
        try {
          const status = this.mapStatus(dw.status);
          const amount = new Prisma.Decimal(dw.value);
          
          const existing = await this.prisma.withdrawRequest.findUnique({
            where: { domWithdrawId: dw.id_transfer },
          });

          if (existing) {
            // Só atualiza se o status local for PENDING
            if (existing.status === WithdrawStatus.PENDING && existing.status !== status) {
              await this.prisma.withdrawRequest.update({
                where: { id: existing.id },
                data: { 
                  status: status,
                  updatedAt: new Date() 
                },
              });
              updated++;
            }
          } else {
            // Cria localmente se não existir
            await this.prisma.withdrawRequest.create({
              data: {
                userId: input.userId,
                domWithdrawId: dw.id_transfer,
                amount: amount,
                grossAmount: amount, // Na listagem da DOM vem o valor bruto/total
                fee: new Prisma.Decimal(0),
                pixKey: dw.pix_key || 'N/A',
                status,
                createdAt: dw.create_date ? new Date(dw.create_date) : new Date(),
              },
            });
            created++;
          }
        } catch (err: any) {
          this.logger.warn(`Erro ao sincronizar saque ${dw.id_transfer}: ${err.message}`);
        }
      }

      if (withdraws.length < limit) break;
      page++;
      
      // Segurança para evitar loop infinito em caso de erro na paginação da API
      if (page > 100) break;
    }

    this.logger.log(
      `Sincronização de saques concluída: ${created} criados, ${updated} atualizados, ${total} total`,
    );

    return { created, updated, total };
  }
}
