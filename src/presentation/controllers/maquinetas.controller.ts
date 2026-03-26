import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TransactionStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

/** Extrai o serial do terminal a partir da descrição da transação */
function extractTerminal(description: string | null | undefined): string {
  if (!description) return '-';
  const m = description.match(/Terminal:\s*([A-Z0-9]+)/i);
  return m ? m[1] : '-';
}

@ApiTags('Maquinetas')
@Controller('maquinetas')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MaquinetasController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar transações de maquinetas do usuário autenticado' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'status', required: false, enum: ['COMPLETED', 'PENDING', 'FAILED'] })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  async getMaquinetas(
    @CurrentUser() user: JwtPayload | undefined,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const userId = user?.sub ?? '';
    const pageNum = Number(page);
    const limitNum = Math.min(Number(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      userId,
      description: { contains: 'Terminal:', mode: 'insensitive' },
      ...(status && status !== 'ALL'
        ? { status: status as TransactionStatus }
        : {}),
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
      const statusDetails = tx.status === 'COMPLETED' ? 'Aprovado'
        : tx.status === 'PENDING' ? 'Pendente'
        : tx.status === 'FAILED' ? 'Falhou'
        : tx.status === 'REFUNDED' ? 'Estornado'
        : tx.status;
      return {
        // Camel case fields
        id: tx.domPaymentId || tx.id,
        domPaymentId: tx.domPaymentId,
        domTransactionId: tx.domTransactionId || null,
        terminal: extractTerminal(tx.description),
        amount: amt,
        liquidAmount: amt,
        netAmount: netAmt,
        netbalancemachine: netAmt,
        status: tx.status.toLowerCase(),
        statusDetails,
        paymentMethod: tx.paymentMethod.toLowerCase(),
        installments: tx.installments,
        cardBrand: tx.cardBrand,
        cardBin: tx.cardBin,
        cardCodeAuth: (tx as any).cardCodeAuth ?? null,
        customerName: tx.customerName,
        customerDocument: tx.customerDocument,
        customerEmail: tx.customerEmail,
        customerPhone: tx.customerPhone,
        customerBirthdate: null,
        pixQrCode: tx.pixQrCode ?? null,
        pixContent: tx.pixContent ?? null,
        pixExpire: tx.pixExpire ?? null,
        boletoUrl: null,
        boletoDigitableLine: null,
        productFirst: null,
        postbackUrl: null,
        createdAt: tx.createdAt.toISOString(),
        updatedAt: tx.updatedAt.toISOString(),

        // Snake case para compatibilidade com admin-renovada12 (mesmo formato do api-dom)
        type_operation: 'fisical',
        created_at: tx.createdAt.toISOString(),
        updated_at: tx.updatedAt.toISOString(),
        cod_external: tx.domTransactionId || null,
        liquid_amount: amt,
        profit_minus_tax: netAmt,
        status_details: statusDetails,
        payment_method: tx.paymentMethod.toLowerCase(),
        card_brand: tx.cardBrand,
        card_bin: tx.cardBin,
        card_code_auth: (tx as any).cardCodeAuth ?? null,
        boleto_url: null,
        boleto_digitable_line: null,
        pix_qrcode: tx.pixQrCode ?? null,
        pix_content: tx.pixContent ?? null,
        pix_expire: tx.pixExpire ?? null,
        customer_name: tx.customerName,
        customer_document: tx.customerDocument,
        customer_birthdate: null,
        customer_email: tx.customerEmail,
        customer_phone: tx.customerPhone,
        product_first: null,
        description: tx.customerName ?? 'Cliente POS',
      };
    });

    return {
      transactions: mapped,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    };
  }
}
