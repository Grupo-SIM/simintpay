import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import {
  MAX_FULFILLMENT_FILE_BYTES,
  MAX_FULFILLMENT_FILES,
  MAX_FULFILLMENT_IMAGE_BYTES,
} from './offer-fulfillment';
import { OFFER_IMAGE_MIMES, OfferAssetsService } from './offer-assets.service';
import type { OfferActor } from './offer.service';

const actorOf = (user: JwtPayload | undefined): OfferActor => ({
  id: user?.sub ?? '',
  role: user?.role ?? 'USER',
});

/** Arquivos de entrega e imagem das ofertas (upload/remoção pelo titular; imagem pública no checkout). */
@Controller('ofertas')
@ApiTags('Ofertas')
export class OfferAssetsController {
  constructor(private readonly assets: OfferAssetsService) {}

  @Get('public/:code/imagem')
  @ApiOperation({ summary: 'Imagem da oferta (servida do storage privado)' })
  async publicImage(@Param('code') code: string, @Res() res: Response) {
    const image = await this.assets.publicImage(code);
    if (image.kind === 'redirect') return res.redirect(image.url);
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(image.buffer);
  }

  @Get(':id/arquivos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar arquivos de entrega da oferta' })
  list(@CurrentUser() user: JwtPayload | undefined, @Param('id') id: string) {
    return this.assets.listFiles(actorOf(user), id);
  }

  @Post(':id/arquivos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar PDFs entregues ao comprador da oferta' })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FULFILLMENT_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FULFILLMENT_FILE_BYTES },
      fileFilter: (_req, file, cb) =>
        file.mimetype === 'application/pdf'
          ? cb(null, true)
          : cb(
              new BadRequestException('Apenas arquivos PDF são permitidos'),
              false,
            ),
    }),
  )
  upload(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.assets.uploadFiles(actorOf(user), id, files);
  }

  @Delete(':id/arquivos/:fileId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover arquivo de entrega da oferta' })
  remove(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.deleteFile(actorOf(user), id, fileId);
  }

  @Post(':id/imagem')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar a imagem da oferta (bump/upsell/downsell)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FULFILLMENT_IMAGE_BYTES },
      fileFilter: (_req, file, cb) =>
        OFFER_IMAGE_MIMES.includes(file.mimetype)
          ? cb(null, true)
          : cb(
              new BadRequestException('Use uma imagem PNG, JPG, WEBP ou GIF'),
              false,
            ),
    }),
  )
  setImage(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.assets.setImage(actorOf(user), id, file);
  }

  @Delete(':id/imagem')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remover a imagem da oferta' })
  removeImage(
    @CurrentUser() user: JwtPayload | undefined,
    @Param('id') id: string,
  ) {
    return this.assets.removeImage(actorOf(user), id);
  }
}
