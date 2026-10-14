import { PlatformOwnerMirror } from '../../platform-core/platform-owner-mirror';
import { Controller, Get, Query, Post, Body, GoneException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RevalidaDashboardService } from '../services/revalida-dashboard.service';
import { RevalidaSyncService } from '../services/revalida-sync.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Revalida Dashboard')
@Controller('dashboard/revalida')
export class RevalidaDashboardController {
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
  async syncExternalUser() { return new PlatformOwnerMirror(this.prisma).sync('REVALIDA'); }

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
