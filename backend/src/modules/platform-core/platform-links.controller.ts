import {
  loadChargePolicy,
  quoteFinancialCharge,
} from '../financial-policy/financial-charge';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Query,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  SetMetadata,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash } from 'node:crypto';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import { CreatePaymentLinkUseCase } from '../../application/use-cases/payment-link/create-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../../application/use-cases/payment-link/update-payment-link.use-case';
import { ManagePaymentLinkFilesUseCase } from '../../application/use-cases/payment-link/manage-payment-link-files.use-case';
type Request = { platformContext: PlatformContext };
@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class PlatformLinksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModuleRef,
  ) {}
  private async owned(c: PlatformContext, id: string) {
    const link = await this.prisma.paymentLink.findFirst({
      where: { id, userId: c.ownerUserId, plataformas: { has: c.tag } },
    });
    if (!link)
      throw new NotFoundException('Link não encontrado nesta plataforma');
    return link;
  }
  private response(data: { id: string }) {
    const base = process.env.SIMPAY_CHECKOUT_URL;
    if (!base)
      throw new BadRequestException('SIMPAY_CHECKOUT_URL não configurada');
    const checkout = new URL(base);
    checkout.searchParams.set('simLinkCode', data.id);
    return { data, checkoutUrl: checkout.href };
  }
  private validate(body: {
    valor?: number;
    webhookUrl?: string;
    redirectUrl?: string;
  }) {
    if (
      body.valor !== undefined &&
      (!Number.isFinite(body.valor) || body.valor < 14.99)
    )
      throw new BadRequestException('Valor mínimo R$ 14,99');
    for (const raw of [body.webhookUrl, body.redirectUrl])
      if (raw) {
        let url: URL;
        try {
          url = new URL(raw);
        } catch {
          throw new BadRequestException('URL inválida');
        }
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new BadRequestException(
            'URL HTTPS sem credenciais obrigatória',
          );
      }
  }
  @Post('links')
  @SetMetadata('platform-operation', 'links:write')
  async create(
    @Req() req: Request,
    @Body() body: CreatePaymentLinkDto,
    @Headers('idempotency-key') key: string,
  ) {
    const c = req.platformContext;
    this.validate(body);
    if (body.plataformas !== undefined)
      throw new BadRequestException('Plataforma definida pela credencial');
    if (!key || key.length > 128)
      throw new BadRequestException('idempotency-key obrigatório');
    if (!process.env.SIMPAY_CHECKOUT_URL)
      throw new BadRequestException('Checkout não configurado');
    const id = createHash('sha256')
      .update(`platform-link:${c.id}:${key}`)
      .digest('hex');
    const existing = await this.prisma.paymentLink.findUnique({
      where: { id },
    });
    if (existing) return this.response(await this.owned(c, id));
    try {
      const result = await this.modules
        .get(CreatePaymentLinkUseCase, { strict: false })
        .execute({
          userId: c.ownerUserId,
          id,
          dto: { ...body, isStandalone: false, plataformas: [c.tag] },
        });
      return this.response(result.data);
    } catch (error) {
      const concurrent = await this.prisma.paymentLink.findUnique({
        where: { id },
      });
      if (concurrent) return this.response(await this.owned(c, id));
      throw error;
    }
  }
  @Get('links/:id')
  @SetMetadata('platform-operation', 'links:read')
  async get(@Req() req: Request, @Param('id') id: string) {
    return this.response(await this.owned(req.platformContext, id));
  }
  @Patch('links/:id')
  @SetMetadata('platform-operation', 'links:write')
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdatePaymentLinkDto,
  ) {
    this.validate(body);
    if (body.plataformas !== undefined)
      throw new BadRequestException('Plataforma definida pela credencial');
    const c = req.platformContext;
    await this.owned(c, id);
    await this.modules
      .get(UpdatePaymentLinkUseCase, { strict: false })
      .execute({
        id,
        userId: c.ownerUserId,
        dto: { ...body, isStandalone: false, plataformas: [c.tag] },
      });
    return this.response(await this.owned(c, id));
  }
  @Post('links/:id/files')
  @SetMetadata('platform-operation', 'links:write')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async files(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const c = req.platformContext;
    await this.owned(c, id);
    if (!files?.length) throw new BadRequestException('Envie PDFs');
    const results: unknown[] = [];
    for (const file of files) {
      if (
        file.mimetype !== 'application/pdf' ||
        file.buffer.subarray(0, 5).toString() !== '%PDF-'
      )
        throw new BadRequestException('Apenas PDFs');
      const hash = createHash('sha256').update(file.buffer).digest('hex');
      const name = `${hash}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      // Advisory lock serializes retries across API instances, including storage upload.
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id + ':' + hash}))`;
          const existing = await tx.paymentLinkFile.findFirst({
            where: { paymentLinkId: id, fileName: name },
          });
          if (existing) {
            results.push(existing);
            return;
          }
          const result = await this.modules
            .get(ManagePaymentLinkFilesUseCase, { strict: false })
            .uploadFiles({
              userId: c.ownerUserId,
              linkId: id,
              files: [{ ...file, originalname: name }],
            });
          results.push(...result.files);
        },
        { timeout: 60_000 },
      );
    }
    return { files: results };
  }
  @Get('pricing/simulation')
  @SetMetadata('platform-operation', 'reports:read')
  async simulation(@Req() req: Request, @Query('amountCents') raw: string) {
    const cents = Number(raw);
    if (!Number.isSafeInteger(cents) || cents < 1499)
      throw new BadRequestException('x-amount-cents inválido');
    const context = await loadChargePolicy(
      this.prisma,
      req.platformContext.tag,
    );
    const quotes = Array.from({ length: 12 }, (_, i) =>
      quoteFinancialCharge(context, cents / 100, 'CREDIT_CARD', i + 1),
    );
    return {
      unit: 'cents',
      data: quotes.map((quote, i) =>
        quote
          ? quote.financialSnapshot
          : { installments: i + 1, error: 'Contrato ainda não ativado' },
      ),
    };
  }
}
