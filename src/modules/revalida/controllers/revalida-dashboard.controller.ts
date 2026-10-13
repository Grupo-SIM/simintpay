import { Controller, Get, Query, Post, Body, Logger, GoneException } from '@nestjs/common';
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
    throw new GoneException('Cadastre a plataforma e atribua um dono existente pelo admin.');
  }

  @Post('sync-external-user')
  @ApiOperation({ summary: '[REVALIDA] Registra/atualiza o usuário Revalida na listagem de plataformas do admin' })
  async syncExternalUser() {
    const platform = await this.prisma.platform.findFirst({
      where: { tag: { equals: 'revalida', mode: 'insensitive' }, isActive: true, owner: { isActive: true, isPurged: false } },
    });
    if (!platform) return { success: false, error: 'Plataforma não cadastrada com dono no admin' };
    const userId = platform.ownerUserId;

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

  @Post('wallet-zerar')
  @ApiOperation({
    summary: '[REVALIDA] Zerar carteira (balance e lockedBalance)',
    description:
      'Usa REVALIDA_USER_ID do .env. Zera saldo disponível e bloqueado, registra BalanceLog e atualiza ExternalPlatformWallet.',
  })
  async zeroWallet() {
    const result = await this.syncService.zeroWallet();
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      message:
        result.alreadyZero === true
          ? 'Carteira Revalida já estava zerada (ExternalPlatformWallet alinhada).'
          : 'Carteira Revalida zerada.',
      userId: result.userId,
      balanceAntes: result.balanceBefore,
      lockedAntes: result.lockedBefore,
      alreadyZero: result.alreadyZero === true,
    };
  }
}
