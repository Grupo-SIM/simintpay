import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
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
import { SyncMaquinetasUseCase } from '../../application/use-cases/admin/sync-maquinetas.use-case';
import { SyncDomTransactionsCron } from '../../infrastructure/cron/sync-dom-transactions.cron';
import { RejectLeadDto } from '../../application/dtos/admin/reject-lead.dto';
import { RejectWithdrawalDto } from '../../application/dtos/admin/reject-withdrawal.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { RevalidaSyncService } from '../../modules/revalida/services/revalida-sync.service';
import { HASH_SERVICE, type IHashService } from '../../core/services/hash.interface';
import { PAYMENT_GATEWAY, type IPaymentGateway } from '../../core/services/payment-gateway.interface';
import { WALLET_REPOSITORY, type IWalletRepository } from '../../core/repositories/wallet.repository.interface';

/** Extrai o serial do terminal a partir da descrição da transação */
function extractTerminal(description: string | null | undefined): string {
  if (!description) return '-';
  const m = description.match(/Terminal:\s*([A-Z0-9]+)/i);
  return m ? m[1] : '-';
}

const PLAN_PLATFORM_CPF_REGEX = /\[CPF:([^\]|]*)\|([^\]]+)\]/;

function extractOwnerDocDigitsFromPlanDescription(description: string | null | undefined): string | null {
  const m = (description ?? '').match(PLAN_PLATFORM_CPF_REGEX);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, '');
  if (digits.length < 11) return null;
  return digits;
}

/** userIds dos planos técnicos + contas Simpay (CPF) para listar todas as transações da plataforma */
/** Extrai todos os CPFs/CNPJs (11-14 dígitos) presentes em uma string */
function extractAllDocDigitsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = (text).match(/\d{11,14}/g) ?? [];
  return [...new Set(matches.filter(d => d.length >= 11 && d.length <= 14))];
}

async function expandPlatformTransactionUserIds(
  prisma: PrismaService,
  plans: { userId: string; description: string | null }[],
): Promise<string[]> {
  const ids = new Set(plans.map((p) => p.userId));
  if (plans.length === 0) return [];

  // Coleta todos os dígitos de documento presentes nas descrições dos planos
  // (tanto no formato [CPF:xxx|TAG] quanto em texto livre)
  const digitsToResolve = new Set<string>();

  for (const p of plans) {
    // Tenta o formato padrão primeiro
    const tagged = extractOwnerDocDigitsFromPlanDescription(p.description);
    if (tagged) {
      digitsToResolve.add(tagged);
      continue;
    }
    // Fallback: qualquer sequência de 11-14 dígitos na descrição
    for (const d of extractAllDocDigitsFromText(p.description)) {
      digitsToResolve.add(d);
    }
  }

  if (digitsToResolve.size === 0) return [...ids];

  const orClause = [...digitsToResolve].flatMap((d) => {
    const row: { cpf: string }[] = [{ cpf: d }];
    if (d.length === 11) {
      row.push({ cpf: d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') });
    } else if (d.length === 14) {
      row.push({ cpf: d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') });
    }
    return row;
  });

  const merchants = await prisma.user.findMany({
    where: { OR: orClause },
    select: { id: true },
  });
  for (const m of merchants) ids.add(m.id);
  return [...ids];
}

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
    private readonly syncMaquinetasUseCase: SyncMaquinetasUseCase,
    private readonly syncDomTransactionsCron: SyncDomTransactionsCron,
    private readonly revalidaSyncService: RevalidaSyncService,
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    @Inject(HASH_SERVICE) private readonly hashService: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: IPaymentGateway,
    @Inject(WALLET_REPOSITORY) private readonly walletRepository: IWalletRepository,
  ) { }

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

  // ──────────── CRIAR CONTA ────────────

  @Post('criar-conta')
  @HttpCode(201)
  @ApiOperation({ summary: 'Criar conta diretamente (admin master) — vincula ao módulo renovada e filtra transações pelo CPF' })
  async criarConta(
    @Body() body: { email: string; password: string; cpf: string },
  ) {
    const { email, password, cpf } = body;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Já existe um usuário com este e-mail');
    }

    const cpfClean = cpf.replace(/\D/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingCpf = await (this.prisma.user as any).findFirst({ where: { cpf: cpfClean } });
    if (existingCpf) {
      throw new ConflictException('Já existe um usuário com este CPF');
    }

    const hashed = await this.hashService.hash(password);

    // Tentar registrar na DOM (falha silenciosa)
    let domUserId: string | null = null;
    let domToken: string | null = null;
    try {
      const name = email.split('@')[0];
      const domReg = await this.paymentGateway.register({ name, email, password });
      const domTok = await this.paymentGateway.generateToken(email, password);
      domUserId = domReg.domUserId ?? null;
      domToken = domTok.domToken ?? null;
    } catch (err: any) {
      // Segue sem conta DOM
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (this.prisma.user as any).create({
      data: {
        name: email.split('@')[0],
        email,
        password: hashed,
        cpf: cpfClean,
        domUserId: domUserId ?? undefined,
        domToken: domToken ?? undefined,
      },
    });

    await this.walletRepository.createForUser(user.id);

    return {
      data: {
        userId: user.id,
        email: user.email,
        cpf: cpfClean,
        modulo: null,
      },
      message: 'Conta do cliente criada com sucesso (Conta Avulsa)',
    };
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

  @Post('sync/full-revalida')
  @ApiOperation({ summary: 'Sincronização completa de histórico (Revalida) - puxa da DOM Pagamentos' })
  async syncFullRevalida() {
    return this.revalidaSyncService.syncFull();
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

  @Post('sync/sync-wallet-bosque')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definir saldo base da carteira Bosque (execução única para inicializar o saldo correto)' })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo líquido (netBalance) a exibir (ex: 554.08). Será convertido para bruto internamente.', example: 554.08 })
  async syncWalletBosque(@Query('balance') balanceParam?: string) {
    const BOSQUE_ID = process.env.BOSQUE_ID || 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

    try {
      const wallet = await this.prisma.wallet.findUnique({ where: { userId: BOSQUE_ID } });
      if (!wallet) {
        return { message: 'Wallet do Bosque não encontrada no simpay' };
      }

      const oldBalance = Number(wallet.balance);

      if (!balanceParam) {
        return {
          message: 'Forneça o saldo líquido via query: ?balance=554.08. Será convertido para bruto (netBalance / fatorLiquidez).',
          currentBalance: oldBalance,
        };
      }

      // O valor informado é o netBalance desejado (saldo líquido exibido).
      // wallet.balance armazena o valor bruto: netBalance / fatorLiquidez.
      const fatorLiquidez = Number(process.env.BOSQUE_LIQUIDEZ || 0.91);
      const netBalance = Number(balanceParam);
      const grossBalance = netBalance / fatorLiquidez;

      await this.prisma.wallet.update({
        where: { userId: BOSQUE_ID },
        data: { balance: String(grossBalance), version: { increment: 1 } },
      });

      await this.prisma.balanceLog.create({
        data: {
          userId: BOSQUE_ID,
          action: 'WALLET_RECALCULATE',
          amount: grossBalance - oldBalance,
          balanceBefore: oldBalance,
          balanceAfter: grossBalance,
          lockedBefore: wallet.lockedBalance,
          lockedAfter: wallet.lockedBalance,
          description: `Saldo base Bosque definido manualmente. netBalance: R$ ${netBalance.toFixed(2)}, bruto armazenado: R$ ${grossBalance.toFixed(2)}`,
          source: 'ADMIN_SYNC',
          metadata: { oldBalance, netBalance, grossBalance, fatorLiquidez, setManually: true },
        },
      });

      return {
        message: 'Saldo base do Bosque definido com sucesso. A partir de agora o saldo é atualizado incrementalmente.',
        before: { balance: oldBalance },
        after: { grossBalance, netBalance },
      };
    } catch (error: any) {
      return { message: `Erro ao definir saldo: ${error.message}` };
    }
  }

  @Post('sync/sync-wallet-revalida')
  @HttpCode(200)
  @ApiOperation({ summary: 'Definir saldo base da carteira Revalida (execução única)' })
  @ApiQuery({ name: 'balance', required: true, description: 'Saldo líquido (ex: 1200.50)', example: 1200.50 })
  async syncWalletRevalida(@Query('balance') balanceParam?: string) {
    if (!balanceParam) return { message: 'Informe o saldo via query ?balance=...' };
    return this.revalidaSyncService.setWalletBalance(Number(balanceParam));
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
  @ApiQuery({ name: 'search', required: false, description: 'Buscar por id, nome ou email do usuário' })
  async saques(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: WithdrawStatus,
    @Query('modulo') modulo?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
  ) {
    return this.listWithdrawalsAdmin.execute({
      page: Number(page),
      pageSize: Number(pageSize),
      status,
      moduleSlug: modulo,
      userId,
      search,
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

  // ──────────── MAQUINETAS ────────────

  @Post('sync/maquinetas')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sincronizar transações históricas de maquinetas direto da DOM Pagamentos' })
  async syncMaquinetas() {
    return this.syncMaquinetasUseCase.execute();
  }

  @Post('sync/recalcular-balance-maquinetas')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recalcular balance da Renovada do zero baseado nas transações de maquineta (amount - domFee)',
    description:
      'Soma amount - domFee de todas as transações COMPLETED de maquineta, desconta saques aprovados/completos e define o wallet.balance correto.',
  })
  async recalcularBalanceMaquinetas() {
    const RENOVADA_ID = 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const wallet = await this.prisma.wallet.findUnique({ where: { userId: RENOVADA_ID } });
    if (!wallet) {
      return { message: 'Wallet da Renovada não encontrada' };
    }

    // wallet.balance = netBalance: soma de netAmount de todas as transações COMPLETED
    const aggTxs = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.COMPLETED },
      _sum: { netAmount: true },
      _count: true,
    });

    const totalNet = Number(aggTxs._sum.netAmount ?? 0);

    // Desconta saques aprovados/concluídos
    const saques = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { grossAmount: true },
    });
    const totalSaques = Number(saques._sum.grossAmount ?? 0);

    const newBalance = Math.max(0, totalNet - totalSaques);
    const oldBalance = Number(wallet.balance);

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: newBalance, version: { increment: 1 } },
    });

    await this.prisma.balanceLog.create({
      data: {
        userId: RENOVADA_ID,
        action: 'WALLET_RECALCULATE',
        amount: newBalance - oldBalance,
        balanceBefore: oldBalance,
        balanceAfter: newBalance,
        lockedBefore: wallet.lockedBalance,
        lockedAfter: wallet.lockedBalance,
        source: 'ADMIN_RECALC',
        description: `Recálculo: netTotal=${totalNet.toFixed(2)}, saques=${totalSaques.toFixed(2)}`,
      },
    });

    return {
      message: 'Balance recalculado com sucesso',
      details: {
        totalTransacoes: aggTxs._count,
        totalNet: totalNet.toFixed(2),
        totalSaques: totalSaques.toFixed(2),
        balanceAntes: oldBalance.toFixed(2),
        balanceNovo: newBalance.toFixed(2),
      },
    };
  }

  @Get('renovada/machines')
  @ApiOperation({ summary: 'Transações de maquinetas da Renovada (lê do banco local)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async renovadaMachines(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.getMaquinetasFromDb(page, limit, startDate, endDate);
  }

  @Get('maquinetas')
  @ApiOperation({ summary: 'Transações de maquinetas centralizadas (lê do banco local)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getMaquinetas(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.getMaquinetasFromDb(page, limit, startDate, endDate);
  }

  private async getMaquinetasFromDb(
    page: string,
    limit: string,
    startDate?: string,
    endDate?: string,
  ) {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';
    const pageNum = Number(page);
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 100));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId: RENOVADA_ID,
      OR: [
        { description: { contains: 'Terminal:', mode: 'insensitive' } },
        { description: { contains: 'Maquineta', mode: 'insensitive' } },
      ],
      ...(startDate || endDate
        ? {
          createdAt: {
            ...(startDate ? { gte: dayjs(startDate).startOf('day').toDate() } : {}),
            ...(endDate ? { lte: dayjs(endDate).endOf('day').toDate() } : {}),
          },
        }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const mapped = transactions.map((tx) => {
      const netAmt = Number(tx.netAmount);
      const amt = Number(tx.amount);
      const sLabel = tx.status === 'COMPLETED' ? 'Aprovado'
        : tx.status === 'PENDING' ? 'Pendente'
          : tx.status === 'FAILED' ? 'Falhou'
            : tx.status === 'REFUNDED' ? 'Estornado'
              : tx.status;

      return {
        // Camel case
        id: tx.domPaymentId || tx.id,
        domPaymentId: tx.domPaymentId,
        domTransactionId: tx.domTransactionId || null,
        terminal: extractTerminal(tx.description),
        amount: amt,
        liquidAmount: amt,
        netAmount: netAmt,
        netbalancemachine: netAmt,
        status: tx.status.toLowerCase(),
        statusDetails: sLabel,
        paymentMethod: tx.paymentMethod.toLowerCase(),
        installments: tx.installments,
        cardBrand: tx.cardBrand,
        cardBin: tx.cardBin,
        customerName: tx.customerName,
        customerDocument: tx.customerDocument,
        customerEmail: tx.customerEmail,
        customerPhone: tx.customerPhone,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),

        // Legacy snake_case
        type_operation: 'fisical',
        created_at: tx.createdAt.toISOString(),
        updated_at: tx.updatedAt.toISOString(),
        cod_external: tx.domTransactionId || null,
        liquid_amount: amt,
        profit_minus_tax: netAmt,
        status_details: sLabel,
        payment_method: tx.paymentMethod.toLowerCase(),
        card_brand: tx.cardBrand,
        card_bin: tx.cardBin,
        customer_name: tx.customerName,
        customer_document: tx.customerDocument,
        customer_email: tx.customerEmail,
        customer_phone: tx.customerPhone,
        description: tx.description,
      };
    });

    return {
      transactions: mapped,
      meta: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    };
  }

  @Delete('renovada/transactions/cleanup-plan-txs')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deletar transações PIX_PLAN_CODE incorretamente atribuídas à Renovada' })
  async cleanupRenovadaPlanTxs() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const txs = await this.prisma.transaction.findMany({
      where: {
        userId: RENOVADA_ID,
        description: { startsWith: 'PIX_PLAN_CODE:', mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (txs.length === 0) {
      return { success: true, deletedCount: 0, message: 'Nenhuma transação PIX_PLAN_CODE encontrada' };
    }

    const ids = txs.map(t => t.id);

    await this.prisma.transactionStatusHistory.deleteMany({
      where: { transactionId: { in: ids } },
    });

    const deleted = await this.prisma.transaction.deleteMany({
      where: { id: { in: ids } },
    });

    return {
      success: true,
      deletedCount: deleted.count,
      message: `${deleted.count} transações PIX_PLAN_CODE removidas da Renovada`,
    };
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

  // ──────────── RENOVADA: LIMPAR TRANSAÇÕES + RECALCULAR SALDO ────────────

  @Post('renovada/recalcular')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove transações sem dízimo/primícia/oferta do pool Renovada e recalcula o saldo' })
  async renovadaRecalcular() {
    const RENOVADA_ID = process.env.RENOVADA_ID || 'ba2b57d6-e3bf-4395-af31-58454f27207a';

    const keywordOr = [
      { description: { contains: 'dizimo', mode: 'insensitive' as const } },
      { description: { contains: 'dízimo', mode: 'insensitive' as const } },
      { description: { contains: 'primicia', mode: 'insensitive' as const } },
      { description: { contains: 'primícia', mode: 'insensitive' as const } },
      { description: { contains: 'oferta', mode: 'insensitive' as const } },
    ];

    const whereToDelete = { userId: RENOVADA_ID, NOT: { OR: keywordOr } };

    // 1. Antes de deletar as transações, deletar o histórico de status para evitar violação de FK
    const txsToDelete = await this.prisma.transaction.findMany({
      where: whereToDelete,
      select: { id: true },
    });

    if (txsToDelete.length > 0) {
      await this.prisma.transactionStatusHistory.deleteMany({
        where: { transactionId: { in: txsToDelete.map(t => t.id) } },
      });
    }

    // Agora deletar as transações
    const deleted = await this.prisma.transaction.deleteMany({
      where: whereToDelete,
    });

    // 2. Recalcular saldo com as transações COMPLETED restantes
    // IMPORTANTE: wallet.balance armazena o valor BRUTO (amount).
    const completedTxs = await this.prisma.transaction.aggregate({
      where: { userId: RENOVADA_ID, status: TransactionStatus.COMPLETED, OR: keywordOr },
      _sum: { amount: true },
    });

    const completedWithdraws = await this.prisma.withdrawRequest.aggregate({
      where: {
        userId: RENOVADA_ID,
        status: { in: [WithdrawStatus.COMPLETED, WithdrawStatus.APPROVED] },
      },
      _sum: { amount: true },
    });

    const totalReceived = Number(completedTxs._sum.amount || 0);
    const totalWithdrawn = Number(completedWithdraws._sum.amount || 0);
    const calculatedBalance = Math.max(0, totalReceived - totalWithdrawn);
    const netEquivalent = calculatedBalance * 0.91; // Só informativo

    await this.prisma.wallet.update({
      where: { userId: RENOVADA_ID },
      data: { balance: calculatedBalance },
    });

    return {
      message: 'Transações limpas e saldo recalculado (usando valores brutos)',
      transacoesRemovidas: deleted.count,
      grossBalanceRecalculado: calculatedBalance,
      netEquivalent,
      totalRecebidoBruto: totalReceived,
      totalSacado: totalWithdrawn,
    };
  }

  // ──────────── PLATAFORMAS ────────────

  @Get('plataformas')
  @ApiOperation({ summary: 'Listar plataformas detectadas (via tag [CPF:xxx|TAG] nos planos)' })
  async listPlataformas() {
    const plans = await this.prisma.pixCreditPlan.findMany({
      select: { description: true, userId: true, createdAt: true },
    });

    const map = new Map<
      string,
      {
        tag: string;
        cpf: string;
        planRows: { userId: string; description: string | null }[];
        plansCount: number;
        firstSeen: Date;
      }
    >();

    // Plataformas conhecidas para detecção por texto livre (fallback sem formato padrão)
    const KNOWN_TAGS = ['PAGATG', 'RENOVADA', 'REVALIDA', 'BOSQUE', 'FRENDZ', 'EBOOKSIM'];

    for (const p of plans) {
      const desc = p.description ?? '';
      const row = { userId: p.userId, description: p.description };

      // Tenta formato padrão [CPF:xxx|TAG]
      const m = desc.match(PLAN_PLATFORM_CPF_REGEX);
      if (m) {
        const [, cpf, tag] = m;
        const key = tag.toUpperCase();
        const existing = map.get(key);
        if (existing) {
          existing.planRows.push(row);
          existing.plansCount++;
          if (p.createdAt < existing.firstSeen) existing.firstSeen = p.createdAt;
        } else {
          map.set(key, { tag: key, cpf, planRows: [row], plansCount: 1, firstSeen: p.createdAt });
        }
        continue;
      }

      // Fallback: detecta tag conhecida em texto livre e CPF como sequência de dígitos
      const upperDesc = desc.toUpperCase();
      const matchedTag = KNOWN_TAGS.find(t => upperDesc.includes(t));
      if (!matchedTag) continue;
      const cpfDigits = (desc.match(/\d{11,14}/g) ?? []).find(d => d.length >= 11) ?? '';
      if (!cpfDigits) continue;

      const existing = map.get(matchedTag);
      if (existing) {
        existing.planRows.push(row);
        existing.plansCount++;
        if (p.createdAt < existing.firstSeen) existing.firstSeen = p.createdAt;
      } else {
        map.set(matchedTag, { tag: matchedTag, cpf: cpfDigits, planRows: [row], plansCount: 1, firstSeen: p.createdAt });
      }
    }

    const result = [];
    for (const v of map.values()) {
      const expandedUserIds = await expandPlatformTransactionUserIds(this.prisma, v.planRows);
      const txCounts =
        expandedUserIds.length > 0
          ? await this.prisma.transaction.groupBy({
            by: ['userId'],
            where: { userId: { in: expandedUserIds } },
            _count: true,
          })
          : [];
      const txMap = new Map(txCounts.map((t) => [t.userId, t._count]));
      const totalTx = expandedUserIds.reduce((sum, uid) => sum + (txMap.get(uid) ?? 0), 0);
      result.push({
        tag: v.tag,
        cpf: v.cpf,
        plansCount: v.plansCount,
        transactionsCount: totalTx,
        firstSeen: v.firstSeen,
      });
    }

    return { data: result };
  }

  @Get('plataformas/:tag/transacoes')
  @ApiOperation({ summary: 'Listar transações de uma plataforma (por tag)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'status', required: false })
  async listPlataformaTransacoes(
    @Param('tag') tag: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('status') status?: string,
  ) {
    const upperTag = tag.toUpperCase();
    // Busca planos com a tag no formato padrão [CPF:xxx|TAG] OU como texto livre
    const plans = await this.prisma.pixCreditPlan.findMany({
      where: {
        OR: [
          { description: { contains: `|${upperTag}]`, mode: 'insensitive' } },
          { description: { contains: upperTag, mode: 'insensitive' } },
        ],
      },
      select: { userId: true, description: true },
    });

    const userIds = await expandPlatformTransactionUserIds(this.prisma, plans);
    if (userIds.length === 0) return { data: [], page: 1, pageSize: 20, total: 0 };

    const pageNum = Math.max(1, Number(page));
    const size = Math.min(Math.max(1, Number(pageSize)), 100);

    const where: any = { userId: { in: userIds } };
    if (status) {
      const statusUpper = status.toUpperCase();
      const statusMap: Record<string, string> = {
        PENDENTE: 'PENDING', COMPLETADA: 'COMPLETED', FALHADA: 'FAILED',
        REEMBOLSADA: 'REFUNDED', EXPIRADA: 'EXPIRED', RASCUNHO: 'DRAFT',
      };
      where.status = statusMap[statusUpper] ?? statusUpper;
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
        include: { pixPlanOrder: { select: { pixCreditPlanId: true, customerDocument: true } } },
      }),
    ]);

    const data = items.map(t => ({
      id: t.id,
      valor: Number(t.amount),
      valorLiquido: t.netAmount ? Number(t.netAmount) : null,
      status: t.status,
      metodoPagamento: t.paymentMethod,
      descricao: (t.description ?? '').replace(/\s*\[CPF:[^\]]*\|[^\]]+\]/g, ''),
      cliente: {
        nome: t.customerName ?? null,
        email: t.customerEmail ?? null,
        documento: t.customerDocument ?? null,
      },
      taxas: {
        total: Number(t.totalFee),
        dom: Number(t.domFee),
        plataforma: Number(t.platformFee),
      },
      criadoEm: t.createdAt,
      atualizadoEm: t.updatedAt,
    }));

    return { data, page: pageNum, pageSize: size, total };
  }

  @Delete('usuarios/:email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Deletar um usuário pelo e-mail (Master Admin only)' })
  async deleteUserByEmail(@Param('email') email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        wallet: true,
        transactions: { select: { id: true } },
      },
    });

    if (!user) {
      return { success: false, message: 'Usuário não encontrado' };
    }

    // Identificar IDs de transações para limpar histórico
    const txIds = user.transactions.map(t => t.id);

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Histórico de Status de Transações
        if (txIds.length > 0) {
          await tx.transactionStatusHistory.deleteMany({
            where: { transactionId: { in: txIds } },
          });
        }

        // 2. Logs de Saldo
        await tx.balanceLog.deleteMany({ where: { userId: user.id } });

        // 3. Transações
        await tx.transaction.deleteMany({ where: { userId: user.id } });

        // 4. Saques
        await tx.withdrawRequest.deleteMany({ where: { userId: user.id } });

        // 5. Links de Pagamento
        await tx.paymentLink.deleteMany({ where: { userId: user.id } });

        // 6. Sessões
        await tx.session.deleteMany({ where: { userId: user.id } });

        // 7. Wallet
        if (user.wallet) {
          await tx.wallet.delete({ where: { userId: user.id } });
        }

        // 8. O Usuário
        await tx.user.delete({ where: { id: user.id } });
      });

      return { success: true, message: `Usuário ${email} e todos os seus dados foram excluídos com sucesso.` };
    } catch (error: any) {
      return { success: false, message: `Erro ao excluir usuário: ${error.message}` };
    }
  }
}
