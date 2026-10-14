import { PlatformOwnerMirror } from '../../platform-core/platform-owner-mirror';
import { Controller, Get, Query, Post, Body, GoneException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AtlasDashboardService } from '../services/atlas-dashboard.service';
import { AtlasSyncService } from '../services/atlas-sync.service';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@ApiTags('Atlas Dashboard')
@Controller('dashboard/atlas')
export class AtlasDashboardController {
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
    throw new GoneException('Cadastre a plataforma e atribua um dono existente pelo admin.');
  }

  @Post('sync-external-user')
  @ApiOperation({ summary: '[ATLAS] Registra/atualiza o usuário Atlas na listagem de plataformas do admin' })
  async syncExternalUser() { return new PlatformOwnerMirror(this.prisma).sync('ATLAS'); }

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
