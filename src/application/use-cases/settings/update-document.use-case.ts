import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

/**
 * Permite o usuário cadastrar o próprio CPF/CNPJ quando a conta ainda não tem.
 * Imutável depois de definido (alteração somente via suporte/admin).
 */
@Injectable()
export class UpdateDocumentUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    userId: string;
    documento: string;
  }): Promise<{ data: { cpf?: string; cnpj?: string }; message: string }> {
    const digits = (input.documento ?? '').replace(/\D/g, '');
    if (digits.length !== 11 && digits.length !== 14) {
      throw new BadRequestException(
        'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, cpf: true, cnpj: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const existingDoc = (user.cpf || (user as any).cnpj || '').replace(/\D/g, '');
    if (existingDoc) {
      throw new BadRequestException(
        'Sua conta já possui um documento cadastrado. Entre em contato com o suporte para alterar.',
      );
    }

    // Unicidade: nenhum outro usuário pode ter o mesmo documento
    if (digits.length === 11) {
      const variants = [
        digits,
        digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
      ];
      const duplicate = await this.prisma.user.findFirst({
        where: { cpf: { in: variants }, id: { not: user.id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('Já existe uma conta com este CPF');
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { cpf: digits },
      });
      return { data: { cpf: digits }, message: 'CPF cadastrado com sucesso' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const duplicateCnpj = await (this.prisma.user as any).findFirst({
      where: { cnpj: digits, id: { not: user.id } },
      select: { id: true },
    });
    if (duplicateCnpj) {
      throw new ConflictException('Já existe uma conta com este CNPJ');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.prisma.user as any).update({
      where: { id: user.id },
      data: { cnpj: digits },
    });
    return { data: { cnpj: digits }, message: 'CNPJ cadastrado com sucesso' };
  }
}
