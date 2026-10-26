import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

/**
 * Serviço responsável por vincular automaticamente um ExternalPlatformUser
 * (identificado por CPF ou CNPJ nas transações de plataformas) ao User da Simpay
 * quando ele realiza cadastro ou tem conta aprovada.
 */
@Injectable()
export class LinkExternalPlatformUserService {
  private readonly logger = new Logger(LinkExternalPlatformUserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async linkByCpf(userId: string, cpf: string): Promise<void> {
    const cleanCpf = cpf.replace(/\D/g, '');
    if (!cleanCpf || cleanCpf.length !== 11) return;

    try {
      const externals = await this.prisma.externalPlatformUser.findMany({
        where: { cpf: cleanCpf, userId: null },
      });

      if (externals.length === 0) return;

      await this.prisma.externalPlatformUser.updateMany({
        where: { cpf: cleanCpf, userId: null },
        data: { userId },
      });

      this.logger.log(
        `Vinculados ${externals.length} ExternalPlatformUser(s) ao userId=${userId} (CPF=${cleanCpf})`,
      );
    } catch (err: any) {
      this.logger.error(
        `Erro ao vincular ExternalPlatformUser userId=${userId} CPF=${cleanCpf}: ${err.message}`,
      );
    }
  }

  async linkByCnpj(userId: string, cnpj: string): Promise<void> {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (!cleanCnpj || cleanCnpj.length !== 14) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const externals = await (this.prisma.externalPlatformUser as any).findMany({
        where: { cnpj: cleanCnpj, userId: null },
      });

      if (externals.length === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.prisma.externalPlatformUser as any).updateMany({
        where: { cnpj: cleanCnpj, userId: null },
        data: { userId },
      });

      this.logger.log(
        `Vinculados ${externals.length} ExternalPlatformUser(s) ao userId=${userId} (CNPJ=${cleanCnpj})`,
      );
    } catch (err: any) {
      this.logger.error(
        `Erro ao vincular ExternalPlatformUser userId=${userId} CNPJ=${cleanCnpj}: ${err.message}`,
      );
    }
  }
}
