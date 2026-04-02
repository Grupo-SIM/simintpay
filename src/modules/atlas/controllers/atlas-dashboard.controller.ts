import { Controller, Get, Query, Post, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AtlasDashboardService } from '../services/atlas-dashboard.service';
import { AtlasSyncService } from '../services/atlas-sync.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Atlas Dashboard')
@Controller('dashboard/atlas')
export class AtlasDashboardController {
  private readonly logger = new Logger(AtlasDashboardController.name);

  constructor(
    private readonly dashboardService: AtlasDashboardService,
    private readonly syncService: AtlasSyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: '[ATLAS] Obter dados da dashboard' })
  async getStats(@Query('period') period?: string) {
    return this.dashboardService.getDashboardData(period);
  }

  @Get('sales')
  @ApiOperation({ summary: '[ATLAS] Listar vendas (paginado)' })
  async getSales(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getSales(Number(page ?? 1), Number(limit ?? 10));
  }

  @Get('withdrawals')
  @ApiOperation({ summary: '[ATLAS] Listar saques (paginado)' })
  async getWithdrawals(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.dashboardService.getWithdrawals(Number(page ?? 1), Number(limit ?? 10));
  }

  @Get('summary')
  @ApiOperation({ summary: '[ATLAS] Resumo financeiro' })
  async getSummary() {
    return this.dashboardService.getSummary();
  }

  @Post('setup')
  @ApiOperation({ summary: '[ATLAS] Criar usuário Atlas no banco (executar uma vez)' })
  async setup() {
    const email = 'atlas@jbmidia.com.br';

    let user = await this.prisma.user.findFirst({ where: { email } });

    if (!user) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('atlas@JB2024!', 10);
      user = await this.prisma.user.create({
        data: {
          name: 'Atlas Sistema',
          email,
          password: hash,
          role: 'USER',
        },
      });
      this.logger.log(`[ATLAS] Usuário criado: ${user.id}`);
    }

    let wallet = await this.prisma.wallet.findUnique({ where: { userId: user.id } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId: user.id } });
      this.logger.log(`[ATLAS] Wallet criada para ${user.id}`);
    }

    return {
      success: true,
      message: 'Usuário Atlas configurado com sucesso. Adicione o ATLAS_USER_ID ao .env',
      userId: user.id,
      email: user.email,
      hint: `Adicione ao .env: ATLAS_USER_ID=${user.id}`,
    };
  }

  @Post('sync-external-user')
  @ApiOperation({ summary: '[ATLAS] Registra/atualiza o usuário Atlas na listagem de plataformas do admin' })
  async syncExternalUser() {
    const userId = process.env.ATLAS_USER_ID;
    if (!userId) {
      return { success: false, error: 'ATLAS_USER_ID não configurado no .env' };
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

    const cpf = user.cpf ?? userId.replace(/-/g, '').slice(0, 11).padEnd(11, '0');

    const extUser = await this.prisma.externalPlatformUser.upsert({
      where: { cpf_platform: { cpf, platform: 'atlas' } },
      update: { name: user.name, userId: user.id, updatedAt: new Date() },
      create: { cpf, name: user.name, platform: 'atlas', userId: user.id },
    });

    await this.prisma.externalPlatformWallet.upsert({
      where: { externalUserId: extUser.id },
      update: { balance },
      create: { externalUserId: extUser.id, balance },
    });

    this.logger.log(`[ATLAS] ExternalPlatformUser sincronizado: ${extUser.id} balance=${balance}`);
    return {
      success: true,
      externalUserId: extUser.id,
      userId: user.id,
      name: user.name,
      platform: 'atlas',
      balance,
    };
  }

  @Post('sync-full')
  @ApiOperation({ summary: '[ATLAS] Sincronização manual completa (histórico)' })
  async syncFull() {
    return this.syncService.syncFull();
  }

  @Post('wallet-balance')
  @ApiOperation({ summary: '[ATLAS] Definir saldo da carteira manualmente' })
  async setBalance(@Body() data: { balance: number }) {
    return this.syncService.setWalletBalance(data.balance);
  }

  @Post('wallet-zerar')
  @ApiOperation({ summary: '[ATLAS] Zerar carteira (balance e lockedBalance)' })
  async zeroWallet() {
    const result = await this.syncService.zeroWallet();
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      message: result.alreadyZero === true
        ? 'Carteira Atlas já estava zerada.'
        : 'Carteira Atlas zerada.',
      userId: result.userId,
      balanceAntes: result.balanceBefore,
      lockedAntes: result.lockedBefore,
      alreadyZero: result.alreadyZero === true,
    };
  }
}
