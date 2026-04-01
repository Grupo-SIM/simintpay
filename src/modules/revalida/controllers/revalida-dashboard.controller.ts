import { Controller, Get, Query, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RevalidaDashboardService } from '../services/revalida-dashboard.service';
import { RevalidaSyncService } from '../services/revalida-sync.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Revalida Dashboard')
@Controller('dashboard/revalida')
export class RevalidaDashboardController {
  private readonly logger = new Logger(RevalidaDashboardController.name);

  constructor(
    private readonly dashboardService: RevalidaDashboardService,
    private readonly syncService: RevalidaSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: '[REVALIDA] Obter dados da dashboard' })
  async getStats(@Query('period') period?: string) {
    return this.dashboardService.getDashboardData(period);
  }

  @Get('sales')
  @ApiOperation({ summary: '[REVALIDA] Listar vendas (paginado)' })
  async getSales(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getSales(Number(page ?? 1), Number(limit ?? 10));
  }

  @Get('withdrawals')
  @ApiOperation({ summary: '[REVALIDA] Listar saques (paginado)' })
  async getWithdrawals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getWithdrawals(Number(page ?? 1), Number(limit ?? 10));
  }

  @Get('summary')
  @ApiOperation({ summary: '[REVALIDA] Resumo financeiro' })
  async getSummary() {
    return this.dashboardService.getSummary();
  }

  @Post('setup')
  @ApiOperation({ summary: '[REVALIDA] Criar usuário revalida no banco (executar uma vez)' })
  async setup() {
    const email = 'revalida@jbmidia.com.br';

    let user = await this.prisma.user.findFirst({ where: { email } });

    if (!user) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('revalida@JB2024!', 10);
      user = await this.prisma.user.create({
        data: {
          name: 'Revalida Sistema',
          email,
          password: hash,
          role: 'USER',
        },
      });
      this.logger.log(`[REVALIDA] Usuário criado: ${user.id}`);
    }

    let wallet = await this.prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId: user.id } });
      this.logger.log(`[REVALIDA] Wallet criada para ${user.id}`);
    }

    return {
      success: true,
      message: 'Usuário Revalida configurado com sucesso. Adicione o REVALIDA_USER_ID ao .env',
      userId: user.id,
      email: user.email,
      hint: `Adicione ao .env: REVALIDA_USER_ID=${user.id}`,
    };
  }

  @Post('sync-external-user')
  @ApiOperation({ summary: '[REVALIDA] Registra/atualiza o usuário Revalida na listagem de plataformas do admin' })
  async syncExternalUser() {
    const userId = process.env.REVALIDA_USER_ID;
    if (!userId) {
      return { success: false, error: 'REVALIDA_USER_ID não configurado no .env' };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, cpf: true },
    });
    if (!user) {
      return { success: false, error: `Usuário com id ${userId} não encontrado` };
    }

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const balance = Number(wallet?.balance ?? 0);

    // CPF placeholder para plataformas sem CPF — usa o userId truncado
    const cpf = user.cpf ?? userId.replace(/-/g, '').slice(0, 11).padEnd(11, '0');

    const extUser = await this.prisma.externalPlatformUser.upsert({
      where: { cpf_platform: { cpf, platform: 'revalida' } },
      update: {
        name: user.name,
        userId: user.id,
        updatedAt: new Date(),
      },
      create: {
        cpf,
        name: user.name,
        platform: 'revalida',
        userId: user.id,
      },
    });

    await this.prisma.externalPlatformWallet.upsert({
      where: { externalUserId: extUser.id },
      update: { balance },
      create: { externalUserId: extUser.id, balance },
    });

    this.logger.log(`[REVALIDA] ExternalPlatformUser sincronizado: ${extUser.id} balance=${balance}`);
    return {
      success: true,
      externalUserId: extUser.id,
      userId: user.id,
      name: user.name,
      platform: 'revalida',
      balance,
    };
  }

  @Post('sync-full')
  @ApiOperation({ summary: '[REVALIDA] Sincronização manual completa (histórico)' })
  async syncFull() {
    return this.syncService.syncFull();
  }

  @Post('wallet-balance')
  @ApiOperation({ summary: '[REVALIDA] Definir saldo da carteira manualmente' })
  async setBalance(@Body() data: { balance: number }) {
    return this.syncService.setWalletBalance(data.balance);
  }
}
