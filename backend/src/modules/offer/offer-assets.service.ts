import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Offer, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import {
  MAX_FULFILLMENT_FILES,
  readOfferFulfillment,
  type FulfillmentFile,
} from './offer-fulfillment';
import type { OfferActor } from './offer.service';

export const OFFER_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/** Id estável de um arquivo de entrega: o gravado no upload ou, nos migrados, um hash da URL. */
export const fulfillmentFileId = (f: Pick<FulfillmentFile, 'id' | 'fileUrl'>) =>
  f.id ?? createHash('sha1').update(f.fileUrl).digest('hex').slice(0, 16);

export type OfferFileView = {
  id: string;
  fileName: string;
  fileSize: number | null;
};

const viewOf = (f: FulfillmentFile): OfferFileView => ({
  id: fulfillmentFileId(f),
  fileName: f.fileName,
  fileSize: f.fileSize ?? null,
});

/**
 * Arquivos de entrega (PDF) e imagem de uma oferta, guardados em `Offer.fulfillment`
 * (`files`, `imageUrl`). A leitura-alteração-gravação roda numa transação com a linha da oferta
 * travada, para uploads simultâneos não se sobrescreverem. O storage é o mesmo do link de pagamento.
 */
@Injectable()
export class OfferAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async listFiles(actor: OfferActor, id: string) {
    const offer = await this.owned(actor, id);
    return {
      files: readOfferFulfillment(offer.fulfillment).files.map(viewOf),
    };
  }

  async uploadFiles(
    actor: OfferActor,
    id: string,
    files: Express.Multer.File[],
  ) {
    const offer = await this.owned(actor, id);
    if (!files?.length) return this.listFiles(actor, id);
    const current = readOfferFulfillment(offer.fulfillment).files.length;
    if (current + files.length > MAX_FULFILLMENT_FILES)
      throw new BadRequestException(
        `Máximo de ${MAX_FULFILLMENT_FILES} arquivos por oferta`,
      );
    const uploaded: FulfillmentFile[] = [];
    try {
      for (const file of files)
        uploaded.push({
          id: crypto.randomUUID(),
          fileName: file.originalname,
          fileSize: file.size,
          fileUrl: await this.storage.uploadFile(file, 'offer-files'),
        });
      const saved = await this.mutate(id, (f) => {
        if (f.files.length + uploaded.length > MAX_FULFILLMENT_FILES)
          throw new BadRequestException(
            `Máximo de ${MAX_FULFILLMENT_FILES} arquivos por oferta`,
          );
        return { ...f, files: [...f.files, ...uploaded] };
      });
      return { files: saved.files.map(viewOf) };
    } catch (error) {
      await this.discard(uploaded.map((u) => u.fileUrl));
      throw error;
    }
  }

  async deleteFile(actor: OfferActor, id: string, fileId: string) {
    await this.owned(actor, id);
    let removed: FulfillmentFile | undefined;
    const saved = await this.mutate(id, (f) => {
      removed = f.files.find((x) => fulfillmentFileId(x) === fileId);
      if (!removed) throw new NotFoundException('Arquivo não encontrado');
      return { ...f, files: f.files.filter((x) => x !== removed) };
    });
    await this.discard([removed!.fileUrl]);
    return { files: saved.files.map(viewOf) };
  }

  async setImage(actor: OfferActor, id: string, file: Express.Multer.File) {
    await this.owned(actor, id);
    if (!file) throw new BadRequestException('Envie uma imagem');
    if (!OFFER_IMAGE_MIMES.includes(file.mimetype))
      throw new BadRequestException('Use uma imagem PNG, JPG, WEBP ou GIF');
    const imageUrl = await this.storage.uploadFile(file, 'offer-images');
    let previous: string | null = null;
    try {
      await this.mutate(id, (f) => {
        previous = f.imageUrl ?? null;
        return { ...f, imageUrl };
      });
    } catch (error) {
      await this.discard([imageUrl]);
      throw error;
    }
    if (previous) await this.discard([previous]);
    return { hasImage: true };
  }

  async removeImage(actor: OfferActor, id: string) {
    await this.owned(actor, id);
    let previous: string | null = null;
    await this.mutate(id, (f) => {
      previous = f.imageUrl ?? null;
      return { ...f, imageUrl: null };
    });
    if (previous) await this.discard([previous]);
    return { hasImage: false };
  }

  /** Imagem pública (o bucket é privado): só ofertas ativas, por código. */
  async publicImage(code: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { OR: [{ code }, { id: code }], isActive: true },
      select: { fulfillment: true },
    });
    const url = offer && readOfferFulfillment(offer.fulfillment).imageUrl;
    if (!url) throw new NotFoundException('Imagem não encontrada');
    if (!this.storage.tryExtractObjectKeyFromStoredUrl(url))
      return { kind: 'redirect', url: String(url) } as const;
    try {
      const { buffer, contentType } =
        await this.storage.getReceiptBufferByStoredUrl(url);
      if (!contentType.startsWith('image/')) throw new Error('NOT_IMAGE');
      return { kind: 'image', buffer, contentType } as const;
    } catch {
      throw new NotFoundException('Imagem não disponível');
    }
  }

  private async mutate(
    id: string,
    change: (f: ReturnType<typeof readOfferFulfillment>) => object,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "Offer" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.offer.findUnique({
        where: { id },
        select: { fulfillment: true },
      });
      if (!row) throw new NotFoundException('Oferta não encontrada');
      const next = change(readOfferFulfillment(row.fulfillment));
      await tx.offer.update({
        where: { id },
        data: { fulfillment: next as Prisma.InputJsonValue },
      });
      return readOfferFulfillment(next);
    });
  }

  /** Limpeza de objetos órfãos: falha de storage não desfaz a operação já gravada. */
  private async discard(urls: string[]) {
    await Promise.allSettled(urls.map((u) => this.storage.deleteFile(u)));
  }

  private async owned(actor: OfferActor, id: string): Promise<Offer> {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer || (actor.role !== 'ADMIN' && offer.ownerUserId !== actor.id))
      throw new NotFoundException('Oferta não encontrada');
    return offer;
  }
}
