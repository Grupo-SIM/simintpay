import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LeadStatus, WithdrawStatus, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { RolesGuard } from '../../infrastructure/security/guards/roles.guard';
import { Roles } from '../../infrastructure/security/decorators/roles.decorator';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { ListLeadsUseCase } from '../../application/use-cases/admin/list-leads.use-case';
import { ApproveLeadUseCase } from '../../application/use-cases/admin/approve-lead.use-case';
import { RejectLeadUseCase } from '../../application/use-cases/admin/reject-lead.use-case';
import { SyncDomTransactionsUseCase } from '../../application/use-cases/admin/sync-dom-transactions.use-case';
import { ListWithdrawalsAdminUseCase } from '../../application/use-cases/admin/list-withdrawals-admin.use-case';
import { ApproveWithdrawalUseCase } from '../../application/use-cases/admin/approve-withdrawal.use-case';
import { RejectWithdrawalUseCase } from '../../application/use-cases/admin/reject-withdrawal.use-case';
import { SyncDomWithdrawalsUseCase } from '../../application/use-cases/admin/sync-dom-withdrawals.use-case';
import { SyncFullRenovadaUseCase } from '../../application/use-cases/admin/sync-full-renovada.use-case';
import { SyncFullBosqueUseCase } from '../../application/use-cases/admin/sync-full-bosque.use-case';
import { MigrateRenovadaTxsToAdminUseCase } from '../../application/use-cases/admin/migrate-renovada-txs-to-admin.use-case';
import { ListDomTransactionsDirectUseCase } from '../../application/use-cases/admin/list-dom-transactions-direct.use-case';
import { ListMachineTransactionsUseCase } from '../../application/use-cases/admin/list-machine-transactions.use-case';
import { SyncDomTransactionsCron } from '../../infrastructure/cron/sync-dom-transactions.cron';
import { RejectLeadDto } from '../../application/dtos/admin/reject-lead.dto';
import { RejectWithdrawalDto } from '../../application/dtos/admin/reject-withdrawal.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';

@ApiTags('Admin')
@Controller('admin')
//@UseGuards(JwtAuthGuard, RolesGuard)
//@Roles('ADMIN')
export class AdminController {
  constructor(
    private readonly listLeads: ListLeadsUseCase,
    private readonly approveLead: ApproveLeadUseCase,
    private readonly rejectLead: RejectLeadUseCase,
    private readonly syncTransactions: SyncDomTransactionsUseCase,
    private readonly listWithdrawalsAdmin: ListWithdrawalsAdminUseCase,
    private readonly approveWithdrawal: ApproveWithdrawalUseCase,
    private readonly rejectWithdrawal: RejectWithdrawalUseCase,
    private readonly syncWithdrawalsUseCase: SyncDomWithdrawalsUseCase,
    private readonly syncFullRenovadaUseCase: SyncFullRenovadaUseCase,
    private readonly syncFullBosqueUseCase: SyncFullBosqueUseCase,
    private readonly migrateRenovadaTxsToAdmin: MigrateRenovadaTxsToAdminUseCase,
    private readonly listDomTransactionsDirect: ListDomTransactionsDirectUseCase,
    private readonly listMachineTransactions: ListMachineTransactionsUseCase,
    private readonly syncDomTransactionsCron: SyncDomTransactionsCron,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  // ──────────── LEADS ────────────

  @Get('leads')
  @ApiOperation({ summary: 'Listar solicitações de cadastro' })
  async leads(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: LeadStatus,
  ) {
    const result = await this.listLeads.execute({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
    });
    return {
      data: result.data,
      page: Number(page),
      pageSize: Number(pageSize),
      total: result.total,
    };
  }

  @Post('leads/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Aprovar solicitação e criar conta do usuário' })
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload | undefined,
  ) {
    const result = await this.approveLead.execute({
      leadId: id,
      adminUserId: user?.sub ?? '',
    });
    return { data: result };
  }

  @Post('leads/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar solicitação' })
  async reject(@Param('id') id: string, @Body() body: RejectLeadDto) {
    const lead = await this.rejectLead.execute({
      leadId: id,
      reason: body.reason,
    });
    return { data: lead };
  }

  @Post('sync-transactions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importar transações da conta Dom para o banco local' })
  async syncTransactionsRoute(@CurrentUser() user: JwtPayload | undefined) {
    const result = await this.syncTransactions.execute({ userId: user?.sub ?? '' });
    return { data: result };
  }

  @Post('sync-withdrawals')
  @HttpCode(200)
  @ApiOperation({ summary: 'Importar saques da conta Dom para o banco local' })
  async syncWithdrawalsRoute(@CurrentUser() user: JwtPayload | undefined) {
    const result = await this.syncWithdrawalsUseCase.execute({ userId: user?.sub ?? '' });
    return { data: result };
  }

  @Post('sync/cleanup-renovada')
  @HttpCode(200)
  @ApiOperation({ summary: 'Limpar transações incorretas da Renovada (vindas do master token) antes de re-sincronizar' })
  async cleanupRenovada() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    // Contar antes
    const countBefore = await this.prisma.transaction.count({ where: { userId: RENOVADA_ID } });

    // Limpar domToken do user (era master token, causava sync de TODAS plataformas)
    await this.prisma.user.update({
      where: { id: RENOVADA_ID },
      data: { domToken: null },
    }).catch(() => { /* user pode não existir ainda */ });

    // Deletar histórico de status dessas transações
    const renovadaTxIds = await this.prisma.transaction.findMany({
      where: { userId: RENOVADA_ID },
      select: { id: true },
    });

    if (renovadaTxIds.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: renovadaTxIds.map(t => t.id) } },
      });
    }

    // Deletar todas as transações da Renovada
    const deleted = await this.prisma.transaction.deleteMany({
      where: { userId: RENOVADA_ID },
    });

    // Zerar carteira
    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: 0, lockedBalance: 0, version: { increment: 1 } },
    }).catch(() => { /* wallet pode não existir */ });

    return {
      message: `Limpeza concluída. ${deleted.count} transações removidas. domToken zerado. Execute /admin/sync/full-renovada para re-sincronizar.`,
      deletedCount: deleted.count,
      countBefore,
    };
  }

  @Post('sync/full-renovada')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Renovada 12) - puxa do api-dom' })
  async syncFullRenovada() {
    return this.syncFullRenovadaUseCase.execute();
  }

  @Post('sync/full-bosque')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Bosque) - puxa da DOM Pagamentos' })
  async syncFullBosque() {
    return this.syncFullBosqueUseCase.execute();
  }

  @Post('sync/sync-wallet-renovada')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definir saldo base da carteira Renovada (execução única para inicializar o saldo correto)' })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo base a definir (ex: 3840.70)', example: 3840.70 })
  async syncWalletRenovada(@Query('balance') balanceParam?: string) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
      if (!wallet) {
        return { message: 'Wallet da Renovada não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message: 'Forneça o saldo base via query: ?balance=3840.70. Este endpoint define o saldo inicial; a partir daí o saldo é gerenciado incrementalmente.',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = Number(process.env.RENOVADA_LIQUIDEZ || 0.91);
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      await this.prisma.wallet.update({
        where: { userId: RENOVADA_ID },
        data: { balance: String(grossBalance), version: { increment: 1 } },
      });

      await this.prisma.balanceLog.create({
        data: {
          userId: RENOVADA_ID,
          action: 'WALLET_RECALCULATE',
          amount: grossBalance - oldBalance,
          balanceBefore: oldBalance,
          balanceAfter: grossBalance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: wallet.lockedBalance,
          description: `Saldo base definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto armazenado: R$ ${grossBalance.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, netBalance, grossBalance, fatorLiquidez, setManually: true },
        },
      });

      return {
        message: 'Saldo base definido com sucesso. A partir de agora o saldo é atualizado incrementalmente (novas transações e saques).',
        before: { balance: oldBalance },
        after: { grossBalance, netBalance },
      };
    } catch (error: any) {
      return { message: `Erro ao definir saldo: ${error.message}` };
    }
  }

  @Post('migrar-transacoes-para-admin')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Migra transações incorretamente atribuídas à Renovada para o Admin (executa uma vez)',
  })
  async migrarTransacoesParaAdmin() {
    const result = await this.migrateRenovadaTxsToAdmin.execute();
    return { data: result };
  }

  @Get('transacoes-dom')
  @ApiOperation({ summary: 'Lista transações diretamente da API DOM (conta master) sem passar pelo banco' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'begin_date', required: false, example: '2025-01-01', description: 'yyyy-mm-dd' })
  @ApiQuery({ name: 'end_date', required: false, example: '2025-12-31', description: 'yyyy-mm-dd' })
  @ApiQuery({ name: 'status', required: false, description: 'paid | pending | failed | refunded | expired' })
  @ApiQuery({ name: 'payment_method', required: false, description: 'pix | credit_card' })
  async transacoesDom(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('begin_date') begin_date?: string,
    @Query('end_date') end_date?: string,
    @Query('status') status?: string,
    @Query('payment_method') payment_method?: string,
  ) {
    const result = await this.listDomTransactionsDirect.execute({
      page: Number(page),
      limit: Number(limit),
      begin_date,
      end_date,
      status,
      payment_method,
    });
    return { data: result };
  }

  @Post('sync/test-cron')
  @HttpCode(200)
  @ApiOperation({ summary: 'Testar sincronização automática do cron (executa mesma lógica do cron)' })
  async testCronSync() {
    try {
      await this.syncDomTransactionsCron.handleSync();
      return { 
        success: true, 
        message: 'Sincronização do cron executada com sucesso' 
      };
    } catch (error) {
      return { 
        success: false, 
        message: 'Erro na sincronização', 
        error: error.message 
      };
    }
  }

  // ──────────── SAQUES ────────────

  @Get('saques')
  @ApiOperation({ summary: 'Listar todos os saques (admin)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: WithdrawStatus })
  @ApiQuery({ name: 'modulo', required: false, description: 'Slug do módulo (ex: revalida)' })
  async saques(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: WithdrawStatus,
    @Query('modulo') modulo?: string,
    @Query('userId') userId?: string,
  ) {
    return this.listWithdrawalsAdmin.execute({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      moduleSlug: modulo,
      userId,
    });
  }

  @Get('saques/user')
  @ApiOperation({ summary: 'Listar saques de um específico usuário (conforme API DOM)' })
  async saquesUser(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: WithdrawStatus,
    @Query('userId') userId?: string,
  ) {
    return this.listWithdrawalsAdmin.execute({
      page: Number(page),
      pageSize: Number(limit),
      status,
      userId,
    });
  }

  @Post('saques/:id/aprovar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Aprovar saque com upload de comprovante' })
  async aprovarSaque(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
    @Body('receiptImage') receiptImageUrl?: string,
  ) {
    let finalUrl = receiptImageUrl;

    if (file) {
      finalUrl = await this.storageService.uploadFile(file, 'comprovantes-saque');
    }

    return this.approveWithdrawal.execute(id, finalUrl);
  }

  @Post('saques/:id/rejeitar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rejeitar saque e desbloquear saldo' })
  async rejeitarSaque(
    @Param('id') id: string,
    @Body() body: RejectWithdrawalDto,
  ) {
    return this.rejectWithdrawal.execute(id, body.motivo);
  }

  // ──────────── RENOVADA: TRANSAÇÕES & RESUMO ────────────
  // Equivalente ao api-dom GET /payments/history

  @Get('renovada/transactions')
  @ApiOperation({ summary: 'Listar transações da Renovada (equivalente ao api-dom /payments/history)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'EXPIRED'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'description', required: false })
  async renovadaTransactions(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('description') description?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId: RENOVADA_ID,
      ...(status ? { status: status as TransactionStatus } : {}),
      ...(description && description !== 'ALL' ? { description: { contains: description, mode: 'insensitive' } } : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
              ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
            },
          }
        : {}),
    };

    const [transactions, totalCount] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    // Mapear para formato compatível com admin-renovada12
    const mapped = transactions.map((tx) => ({
      id: tx.id,
      userId: tx.userId,
      amount: Number(tx.amount),
      name: tx.customerName,
      email: tx.customerEmail,
      status: tx.status,
      description: tx.description,
      appliedGlobalFee: false,
      fee: Number(tx.totalFee),
      dom_fee: Number(tx.domFee),
      payment_method: tx.paymentMethod,
      amountWithoutAllFee: Number(tx.netAmount || tx.amount),
      walletId: '',
      createdAt: tx.createdAt.toISOString(),
      paymentId: tx.domPaymentId,
      updatedAt: tx.updatedAt.toISOString(),
    }));

    return {
      transactions: mapped,
      meta: {
        currentPage: pageNum,
        itemsPerPage: limitNum,
        totalItems: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
      },
    };
  }

  @Get('renovada/transactions/export')
  @ApiOperation({ summary: 'Exportar todas as transações da Renovada (sem paginação)' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'description', required: false })
  async renovadaTransactionsExport(
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('description') description?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const where: any = {
      userId: RENOVADA_ID,
      ...(status && status !== 'ALL' ? { status: status as TransactionStatus } : {}),
      ...(description && description !== 'ALL' ? { description: { contains: description, mode: 'insensitive' } } : {}),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
              ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
            },
          }
        : {}),
    };

    const transactions = await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((tx) => ({
      nome: tx.customerName || '',
      data: tx.createdAt.toISOString(),
      tipo: tx.description || '',
      email: tx.customerEmail || '',
      'número de telefone': tx.customerPhone || '',
      documento: tx.customerDocument || '',
      'tipo do documento': 'CPF',
      'método de pagamento': tx.paymentMethod,
      valor: Number(tx.netAmount || tx.amount),
      status: tx.status,
      createdAt: tx.createdAt.toISOString(),
      amountWithoutAllFee: Number(tx.netAmount || tx.amount),
    }));
  }

  // Equivalente ao api-dom GET /payments/summary
  @Get('renovada/summary')
  @ApiOperation({ summary: 'Resumo financeiro da Renovada (equivalente ao api-dom /payments/summary)' })
  async renovadaSummary() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const [wallet, pendingWithdraws] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } }),
      this.prisma.withdrawRequest.findMany({
        where: { userId: RENOVADA_ID, status: 'PENDING' },
      }),
    ]);

    const pendingAmount = pendingWithdraws.reduce(
      (sum, w) => sum + Number(w.amount),
      0,
    );

    const availableBalance = Number(wallet?.balance || 0);
    const lockedBalance = Number(wallet?.lockedBalance || 0);

    return {
      availableBalance,
      pendingWithdraws: pendingAmount,
      lockedBalance,
    };
  }

  // Equivalente ao api-dom GET /payments/dom/specific-machines-transactions
  @Get('renovada/machines')
  @ApiOperation({ summary: 'Transações de maquinetas da Renovada (alias para /admin/maquinetas)' })
  async renovadaMachines() {
    return this.listMachineTransactions.execute();
  }

  @Get('maquinetas')
  @ApiOperation({ summary: 'Transações de maquinetas centralizadas (usa token master)' })
  async getMaquinetas() {
    return this.listMachineTransactions.execute();
  }

  @Delete('renovada/transactions/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deletar uma transação da Renovada' })
  async deleteRenovadaTransaction(@Param('id') id: string) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId: RENOVADA_ID },
    });

    if (!tx) {
      return { success: false, message: 'Transação não encontrada' };
    }

    // Deletar histórico de status primeiro (FK)
    await this.prisma.transactionStatusHistory.deleteMany({
      where: { transactionId: id },
    });

    await this.prisma.transaction.delete({ where: { id } });

    return { success: true, message: 'Transação deletada com sucesso' };
  }
}
