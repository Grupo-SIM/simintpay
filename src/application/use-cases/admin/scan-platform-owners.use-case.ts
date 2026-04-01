import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import { CpfLookupService } from '../../../infrastructure/http/cpf-lookup.service';

/**
 * Mapeia cada tag de tenant para o slug da plataforma correspondente.
 * Sempre que uma nova plataforma começar a usar [CPF_DONO:...] na descrição,
 * basta adicionar aqui.
 */
const TENANT_TO_PLATFORM: Record<string, string> = {
  EBOOK: 'ebook',
  EBOOKSIM: 'ebook',
  RENOVADA: 'renovada',
  REVALIDA: 'revalida',
  BOSQUE: 'bosque',
  PAGATG: 'pagatg',
  FRENDZ: 'frendz',
};

// Regex para extrair [TENANT:XXX] e [CPF_DONO:YYY] da descrição
const TENANT_REGEX = /\[TENANT:([A-Z0-9_]+)\]/i;
const CPF_DONO_REGEX = /\[CPF_DONO:(\d{11})\]/i;

@Injectable()
export class ScanPlatformOwnersUseCase {
  private readonly logger = new Logger(ScanPlatformOwnersUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cpfLookup: CpfLookupService,
  ) {}

  async execute(): Promise<{
    scanned: number;
    created: number;
    linked: number;
    walletsUpdated: number;
  }> {
    let scanned = 0;
    let created = 0;
    let linked = 0;
    let walletsUpdated = 0;

    // Busca todas as transações que possuem [CPF_DONO:] na descrição
    const transactions = await this.prisma.transaction.findMany({
      where: {
        description: { contains: '[CPF_DONO:' },
      },
      select: {
        id: true,
        description: true,
        netAmount: true,
        amount: true,
        status: true,
      },
    });

    scanned = transactions.length;

    // Agrupa por (cpf + plataforma) → soma netAmount de transações COMPLETED
    const ownerMap = new Map<
      string,
      { cpf: string; platform: string; totalNet: number }
    >();

    for (const tx of transactions) {
      const desc = tx.description ?? '';
      const cpfMatch = CPF_DONO_REGEX.exec(desc);
      const tenantMatch = TENANT_REGEX.exec(desc);

      if (!cpfMatch || !tenantMatch) continue;

      const cpf = cpfMatch[1];
      const tenantTag = tenantMatch[1].toUpperCase();
      const platform = TENANT_TO_PLATFORM[tenantTag];

      if (!platform) continue;

      const key = `${cpf}::${platform}`;
      const current = ownerMap.get(key) ?? { cpf, platform, totalNet: 0 };

      if (tx.status === 'COMPLETED') {
        current.totalNet += Number(tx.netAmount ?? tx.amount ?? 0);
      }

      ownerMap.set(key, current);
    }

    // Processa cada owner encontrado
    for (const { cpf, platform, totalNet } of ownerMap.values()) {
      try {
        // Verifica se já existe ExternalPlatformUser para esse cpf+plataforma
        const existing = await this.prisma.externalPlatformUser.findUnique({
          where: { cpf_platform: { cpf, platform } },
          include: { wallet: true },
        });

        // Tenta encontrar usuário Simpay com esse CPF
        const simpayUser = await this.prisma.user.findUnique({
          where: { cpf },
          select: { id: true, name: true },
        });

        if (existing) {
          // Atualiza vinculação se encontrou usuário Simpay e ainda não estava vinculado
          if (simpayUser && !existing.userId) {
            await this.prisma.externalPlatformUser.update({
              where: { id: existing.id },
              data: { userId: simpayUser.id },
            });
            linked++;
          }

          // Atualiza saldo da wallet
          if (existing.wallet) {
            await this.prisma.externalPlatformWallet.update({
              where: { externalUserId: existing.id },
              data: { balance: totalNet },
            });
            walletsUpdated++;
          } else {
            await this.prisma.externalPlatformWallet.create({
              data: { externalUserId: existing.id, balance: totalNet },
            });
            walletsUpdated++;
          }
        } else {
          // Novo owner: busca nome via CPF
          let name = simpayUser?.name ?? null;
          if (!name) {
            name = await this.cpfLookup.lookupName(cpf);
          }
          if (!name) {
            name = `CPF ${cpf}`; // fallback
          }

          const newExtUser = await this.prisma.externalPlatformUser.create({
            data: {
              cpf,
              name,
              platform,
              userId: simpayUser?.id ?? null,
            },
          });

          await this.prisma.externalPlatformWallet.create({
            data: { externalUserId: newExtUser.id, balance: totalNet },
          });

          created++;
          if (simpayUser) linked++;
          walletsUpdated++;
        }
      } catch (err: any) {
        this.logger.error(
          `Erro ao processar owner CPF=${cpf} plataforma=${platform}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `ScanPlatformOwners: scanned=${scanned} created=${created} linked=${linked} walletsUpdated=${walletsUpdated}`,
    );

    return { scanned, created, linked, walletsUpdated };
  }
}
