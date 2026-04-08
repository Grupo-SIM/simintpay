import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

@Controller('public/users')
export class PublicUserController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('check-account/:cpf')
  async checkAccount(@Param('cpf') cpf: string) {
    const cpfClean = cpf.replace(/\D/g, '');
    
    // Busca no sistema Simpay se existe qualquer usuário com esse CPF
    const user = await this.prisma.user.findFirst({
      where: {
        cpf: cpfClean,
      }
    });
    
    return {
      exists: !!user,
    };
  }
}
