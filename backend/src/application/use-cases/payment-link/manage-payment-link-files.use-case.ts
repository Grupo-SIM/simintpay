import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';

@Injectable()
export class ManagePaymentLinkFilesUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async uploadFiles(input: {
    userId: string;
    linkId: string;
    files: Express.Multer.File[];
  }): Promise<{ files: { id: string; fileName: string; fileUrl: string; fileSize: number; createdAt: Date }[] }> {
    const link = await this.prisma.paymentLink.findFirst({
      where: { id: input.linkId, userId: input.userId },
      select: { id: true },
    });
    if (!link) throw new NotFoundException('Link de pagamento não encontrado');

    const created = await Promise.all(
      input.files.map(async (file) => {
        const fileUrl = await this.storage.uploadFile(file, 'payment-link-files');
        return this.prisma.paymentLinkFile.create({
          data: {
            paymentLinkId: input.linkId,
            fileName: file.originalname,
            fileUrl,
            fileSize: file.size,
          },
          select: { id: true, fileName: true, fileUrl: true, fileSize: true, createdAt: true },
        });
      }),
    );

    return { files: created };
  }

  async deleteFile(input: {
    userId: string;
    linkId: string;
    fileId: string;
  }): Promise<void> {
    const file = await this.prisma.paymentLinkFile.findFirst({
      where: { id: input.fileId, paymentLinkId: input.linkId },
      include: { paymentLink: { select: { userId: true } } },
    });
    if (!file) throw new NotFoundException('Arquivo não encontrado');
    if (file.paymentLink.userId !== input.userId) throw new ForbiddenException('Sem permissão');

    await this.storage.deleteFile(file.fileUrl);
    await this.prisma.paymentLinkFile.delete({ where: { id: input.fileId } });
  }
}
