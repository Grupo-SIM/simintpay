import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { paymentTracking } from '../../modules/platform-core/payment-tracking';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { CreatePaymentLinkDto } from '../../application/dtos/payment-link/create-payment-link.dto';
import { UpdatePaymentLinkDto } from '../../application/dtos/payment-link/update-payment-link.dto';
import { ListPaymentLinksQueryDto } from '../../application/dtos/payment-link/list-payment-links.query.dto';
import { CreatePaymentLinkUseCase } from '../../application/use-cases/payment-link/create-payment-link.use-case';
import { ListPaymentLinksUseCase } from '../../application/use-cases/payment-link/list-payment-links.use-case';
import { GetPaymentLinkUseCase } from '../../application/use-cases/payment-link/get-payment-link.use-case';
import { UpdatePaymentLinkUseCase } from '../../application/use-cases/payment-link/update-payment-link.use-case';
import { DeletePaymentLinkUseCase } from '../../application/use-cases/payment-link/delete-payment-link.use-case';
import { GetPublicPaymentLinkUseCase } from '../../application/use-cases/payment-link/get-public-payment-link.use-case';
import {
  ChargePaymentLinkUseCase,
  ChargePaymentLinkInput,
} from '../../application/use-cases/payment-link/charge-payment-link.use-case';
import { ChargePixPaymentLinkUseCase } from '../../application/use-cases/payment-link/charge-pix-payment-link.use-case';
import { ChargePixPaymentLinkDto } from '../../application/dtos/payment-link/charge-pix-payment-link.dto';
import { ManagePaymentLinkFilesUseCase } from '../../application/use-cases/payment-link/manage-payment-link-files.use-case';
import { SavePaymentLinkOffersDto } from '../../application/dtos/payment-link/save-payment-link-offers.dto';
import {
  listLinkOffers,
  saveLinkOffers,
  toAdminOfferView,
} from '../../application/use-cases/payment-link/payment-link-offers.helper';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

/** Máximo de PDFs anexáveis a um link de pagamento (por envio). */
const MAX_PDF_FILES = 20;

/** Imagens de ofertas (order bump / upsell / downsell). */
const OFFER_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

@Controller('links-pagamento')
@ApiTags('Links de Pagamento')
export class PaymentLinkController {
  constructor(
    private readonly create: CreatePaymentLinkUseCase,
    private readonly list: ListPaymentLinksUseCase,
    private readonly getOne: GetPaymentLinkUseCase,
    private readonly update: UpdatePaymentLinkUseCase,
    private readonly del: DeletePaymentLinkUseCase,
    private readonly getPublic: GetPublicPaymentLinkUseCase,
    private readonly charge: ChargePaymentLinkUseCase,
    private readonly chargePix: ChargePixPaymentLinkUseCase,
    private readonly prisma: PrismaService,
    private readonly manageFiles: ManagePaymentLinkFilesUseCase,
    private readonly storage: StorageService,
  ) {}

  // ── Rotas públicas (sem autenticação) ──────────────────────────────────────

  @Get('public/:id')
  @ApiOperation({
    summary: 'Detalhes públicos de um link de pagamento (checkout)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getPublicRoute(
    @Param('id') id: string,
    @Query('orderBumps') orderBumps?: string,
  ) {
    const bumpIds = orderBumps
      ? orderBumps
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return this.getPublic.execute(id, bumpIds);
  }

  @Get('public/ofertas/:offerId/imagem')
  @ApiOperation({
    summary: 'Imagem de uma oferta (servida do storage privado)',
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async offerImageRoute(
    @Param('offerId') offerId: string,
    @Res() res: Response,
  ) {
    const offer = await this.prisma.paymentLinkOffer.findUnique({
      where: { id: offerId },
      select: { imageUrl: true },
    });
    if (!offer?.imageUrl) throw new NotFoundException('Imagem não encontrada');
    if (!this.storage.tryExtractObjectKeyFromStoredUrl(offer.imageUrl)) {
      res.redirect(offer.imageUrl);
      return;
    }
    try {
      const { buffer, contentType } =
        await this.storage.getReceiptBufferByStoredUrl(offer.imageUrl);
      if (!contentType.startsWith('image/')) throw new Error('NOT_IMAGE');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      throw new NotFoundException('Imagem não disponível');
    }
  }

  @Post('public/:id/charge')
  @ApiOperation({
    summary: 'Cobrar via link de pagamento (checkout público — cartão)',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 404 })
  async chargeRoute(
    @Param('id') id: string,
    @Body() body: Omit<ChargePaymentLinkInput, 'linkId'>,
    @Query() query: Record<string, string>,
  ) {
    return this.charge.execute({
      ...body,
      tracking: paymentTracking({ ...query, ...body.tracking }),
      linkId: id,
    });
  }

  @Post('public/:id/pix')
  @ApiOperation({
    summary:
      'Gerar cobrança PIX via link de pagamento (QR code + copia e cola)',
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        id: 'transaction-uuid',
        status: 'waiting',
        pixContent: '00020126360014br.gov.bcb.pix...',
        qrCode: 'data:image/png;base64,...',
        pixExpire: '2026-03-28 12:00',
        amount: 99.9,
      },
    },
  })
  @ApiResponse({
    status: 404,
    schema: {
      example: {
        statusCode: 404,
        message: 'Link de pagamento não encontrado ou inativo',
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: 'Este link não aceita pagamento via PIX',
      },
    },
  })
  async chargePixRoute(
    @Param('id') id: string,
    @Body() body: ChargePixPaymentLinkDto,
    @Query() query: Record<string, string>,
  ) {
    return this.chargePix.execute({
      ...body,
      tracking: paymentTracking({ ...query, ...body.tracking }),
      linkId: id,
    });
  }

  @Get('public/pix-status/:domPaymentId')
  @ApiOperation({
    summary: 'Status de pagamento PIX por DOM payment ID (checkout polling)',
  })
  @ApiResponse({ status: 200, schema: { example: { status: 'COMPLETED' } } })
  @ApiResponse({ status: 404 })
  async getPixStatusRoute(@Param('domPaymentId') domPaymentId: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { domPaymentId },
      select: { status: true },
    });
    if (tx) return { status: tx.status };
    // Offer checkouts hand the buyer the Transaction id (Charge.transactionId); resolve it too.
    const charge = await this.prisma.charge.findFirst({
      where: { transactionId: domPaymentId },
      select: { transaction: { select: { status: true } } },
    });
    if (!charge?.transaction)
      throw new NotFoundException('Transação não encontrada');
    return { status: charge.transaction.status };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar links de pagamento' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [{ id: 'uuid-link-1', title: 'Plano Mensal', amount: 9900 }],
        page: 1,
        pageSize: 10,
        total: 1,
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async listRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Query() query: ListPaymentLinksQueryDto,
  ): Promise<{ data: unknown; page: number; pageSize: number; total: number }> {
    return this.list.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      query,
    });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar link de pagamento' })
  @ApiBody({
    type: CreatePaymentLinkDto,
    examples: {
      default: {
        value: {
          titulo: 'Plano Mensal',
          descricao: 'Assinatura mensal',
          valor: 99.9,
          parcelasMax: 12,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: { example: { data: { id: 'uuid-link-1' } } },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: [
          'valor must be a number conforming to the specified constraints',
        ],
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async createRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: CreatePaymentLinkDto,
  ): Promise<{ data: unknown }> {
    return this.create.execute({ userId: user?.sub ?? '', dto });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buscar link de pagamento por id' })
  @ApiResponse({ status: 200 })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 404,
    schema: { example: { statusCode: 404, message: 'Link não encontrado' } },
  })
  async getRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    const result = await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    const files = await this.prisma.paymentLinkFile.findMany({
      where: { paymentLinkId: id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        fileUrl: true,
        fileSize: true,
        createdAt: true,
      },
    });
    const ofertas = (await listLinkOffers(this.prisma, id)).map(
      toAdminOfferView,
    );
    return { data: { ...(result.data as object), files, ofertas } };
  }

  @Get(':id/ofertas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar order bumps, upsell e downsell do link' })
  async listOffersRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    return {
      data: (await listLinkOffers(this.prisma, id)).map(toAdminOfferView),
    };
  }

  @Put(':id/ofertas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Salvar order bumps, upsell e downsell do link (ofertas omitidas são desativadas, nunca apagadas)',
  })
  @ApiBody({ type: SavePaymentLinkOffersDto })
  async saveOffersRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: SavePaymentLinkOffersDto,
  ): Promise<{ data: unknown }> {
    // Reaproveita a regra de acesso do detalhe (dono do link ou ADMIN).
    await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    const saved = await this.prisma.$transaction((p) =>
      saveLinkOffers(p, id, dto.ofertas),
    );
    return { data: saved.map(toAdminOfferView) };
  }

  @Post(':id/ofertas/:offerId/arquivos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload de PDFs entregues ao comprador desta oferta',
  })
  @UseInterceptors(
    FilesInterceptor('files', MAX_PDF_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else
          cb(
            new BadRequestException('Apenas arquivos PDF são permitidos'),
            false,
          );
      },
    }),
  )
  async uploadOfferFilesRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    const offer = await this.prisma.paymentLinkOffer.findFirst({
      where: { id: offerId, paymentLinkId: id, deletedAt: null },
      select: { id: true, _count: { select: { files: true } } },
    });
    if (!offer) throw new NotFoundException('Oferta não encontrada');
    if (!files || files.length === 0) return { files: [] };
    if (offer._count.files + files.length > MAX_PDF_FILES) {
      throw new BadRequestException(
        `Máximo de ${MAX_PDF_FILES} PDFs por oferta`,
      );
    }
    const created = [];
    for (const file of files) {
      const fileUrl = await this.storage.uploadFile(
        file,
        'payment-link-offer-files',
      );
      created.push(
        await this.prisma.paymentLinkOfferFile.create({
          data: {
            offerId,
            fileName: file.originalname,
            fileUrl,
            fileSize: file.size,
          },
          select: {
            id: true,
            fileName: true,
            fileUrl: true,
            fileSize: true,
            createdAt: true,
          },
        }),
      );
    }
    return { files: created };
  }

  @Delete(':id/ofertas/:offerId/arquivos/:fileId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover PDF de uma oferta' })
  async deleteOfferFileRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Param('offerId') offerId: string,
    @Param('fileId') fileId: string,
  ): Promise<{ deleted: true }> {
    await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    const file = await this.prisma.paymentLinkOfferFile.findFirst({
      where: { id: fileId, offerId, offer: { paymentLinkId: id } },
    });
    if (!file) throw new NotFoundException('Arquivo não encontrado');
    // Remoção pedida pelo dono no painel (mesmo comportamento dos PDFs do link).
    await this.storage.deleteFile(file.fileUrl);
    await this.prisma.paymentLinkOfferFile.delete({ where: { id: file.id } });
    return { deleted: true };
  }

  @Post(':id/ofertas/imagem')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload da imagem de uma oferta (retorna a URL pública)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (OFFER_IMAGE_MIMES.includes(file.mimetype)) cb(null, true);
        else
          cb(
            new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou GIF'),
            false,
          );
      },
    }),
  )
  async uploadOfferImageRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    await this.getOne.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    return { url: await this.storage.uploadFile(file, 'payment-link-offers') };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Atualizar link de pagamento' })
  @ApiBody({
    type: UpdatePaymentLinkDto,
    examples: {
      default: {
        value: {
          titulo: 'Plano Mensal (Atualizado)',
          valor: 109.9,
          parcelasMax: 10,
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: { example: { data: { id: 'uuid-link-1' } } },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: ['parcelasMax must not be greater than 12'],
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 404,
    schema: { example: { statusCode: 404, message: 'Link não encontrado' } },
  })
  async updateRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentLinkDto,
  ): Promise<{ data: unknown }> {
    return this.update.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
      dto,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover link de pagamento' })
  @ApiResponse({ status: 200, schema: { example: { deleted: true } } })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  @ApiResponse({
    status: 404,
    schema: { example: { statusCode: 404, message: 'Link não encontrado' } },
  })
  async deleteRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    await this.del.execute({
      userId: user?.sub ?? '',
      role: user?.role ?? 'USER',
      id,
    });
    return { deleted: true };
  }

  @Post(':id/files')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload de PDFs para um link de pagamento' })
  @UseInterceptors(
    FilesInterceptor('files', MAX_PDF_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(new Error('Apenas arquivos PDF são permitidos'), false);
        }
      },
    }),
  )
  async uploadFilesRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) {
      return { files: [] };
    }
    return this.manageFiles.uploadFiles({
      userId: user?.sub ?? '',
      linkId: id,
      files,
    });
  }

  @Delete(':id/files/:fileId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover PDF de um link de pagamento' })
  async deleteFileRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ): Promise<{ deleted: true }> {
    await this.manageFiles.deleteFile({
      userId: user?.sub ?? '',
      linkId: id,
      fileId,
    });
    return { deleted: true };
  }
}
