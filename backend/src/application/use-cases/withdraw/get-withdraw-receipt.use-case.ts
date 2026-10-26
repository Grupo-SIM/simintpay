import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { StorageService } from '../../../infrastructure/storage/storage.service';

@Injectable()
export class GetWithdrawReceiptUseCase {
  private readonly logger = new Logger(GetWithdrawReceiptUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async execute(input: {
    withdrawId: string;
    requesterId: string;
    requesterRole: string;
  }): Promise<{ buffer: Buffer; contentType: string }> {
    const w = await this.prisma.withdrawRequest.findUnique({
      where: { id: input.withdrawId },
      select: { userId: true, receiptImage: true },
    });

    if (!w) {
      throw new NotFoundException('Saque não encontrado');
    }

    const url = w.receiptImage?.trim();
    if (!url) {
      throw new NotFoundException('Comprovante não disponível para este saque');
    }

    const isAdmin = input.requesterRole === 'ADMIN';
    if (!isAdmin && w.userId !== input.requesterId) {
      throw new ForbiddenException('Sem permissão para visualizar este comprovante');
    }

    try {
      return await this.storage.getReceiptBufferByStoredUrl(url);
    } catch (e) {
      this.logger.warn(
        `Falha ao ler comprovante withdrawId=${input.withdrawId}: ${e instanceof Error ? e.message : e}`,
      );
      throw new NotFoundException(
        'Comprovante indisponível. Verifique se o arquivo existe no armazenamento ou se a URL está correta.',
      );
    }
  }
}
