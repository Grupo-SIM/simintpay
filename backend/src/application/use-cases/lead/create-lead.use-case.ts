import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { LEAD_REPOSITORY } from '../../../core/repositories/lead.repository.interface';
import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { CreateLeadDto } from '../../dtos/lead/create-lead.dto';

@Injectable()
export class CreateLeadUseCase {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(dto: CreateLeadDto) {
    const email = dto.email.trim().toLowerCase();
    const cpf = dto.cpf.replace(/\D/g, '');
    // Pessoa física não tem CNPJ: a checagem de conflito usa o próprio documento.
    const cnpj =
      dto.cnpj?.replace(/\D/g, '') || (cpf.length === 14 ? cpf : undefined);

    if (await this.users.hasIdentityConflict(email, cpf, cnpj ?? cpf)) {
      throw new ConflictException(
        'Já existe uma conta com este e-mail, CPF ou CNPJ',
      );
    }

    if (await this.leads.hasIdentityConflict(email, cpf, cnpj ?? cpf)) {
      throw new ConflictException(
        'Já existe uma solicitação pendente ou aprovada com este e-mail, CPF ou CNPJ',
      );
    }

    const lead = await this.leads.create({
      name: dto.name,
      phone: dto.phone,
      email,
      razaoSocial: dto.razaoSocial,
      cnpj,
      cpf,
      faturamento: dto.faturamento,
      tempoOperacao: dto.tempoOperacao,
      modeloOperacao: dto.modeloOperacao,
      cargo: dto.cargo,
      comoConheceu: dto.comoConheceu,
      referredByCode: dto.referredByCode,
    });

    return {
      data: { id: lead.id },
      message:
        'Solicitação enviada com sucesso! Entraremos em contato em breve.',
    };
  }
}
