import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

@Controller('public/users')
export class PublicUserController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('check-account/:cpf')
  async checkAccount(@Param('cpf') cpf: string) {
    const cpfClean = cpf.replace(/\D/g, '');
    
    // Busca no sistema Simpay se existe qualquer usuário com esse CPF ou CNPJ
    const user = cpfClean.length === 14
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (this.prisma.user as any).findFirst({ where: { cnpj: cpfClean } })
      : await this.prisma.user.findFirst({
          where: {
            cpf: { in: [cpfClean, cpfClean.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')] },
          },
        });
    
    return {
      exists: !!user,
    };
  }
}
