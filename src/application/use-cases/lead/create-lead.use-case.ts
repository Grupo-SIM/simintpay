import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { LEAD_REPOSITORY } from '../../../core/repositories/lead.repository.interface';
import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';
import { CreateLeadDto } from '../../dtos/lead/create-lead.dto';

@Injectable()
export class CreateLeadUseCase {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository,
  ) {}

  async execute(dto: CreateLeadDto) {
    const existing = await this.leads.findByEmailOrCnpj(dto.email, dto.cnpj);
    if (existing && existing.status !== 'REJECTED') {
      throw new ConflictException(
        'Já existe uma solicitação pendente com este e-mail ou CNPJ',
      );
    }

    const lead = await this.leads.create({
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      razaoSocial: dto.razaoSocial,
      cnpj: dto.cnpj,
      faturamento: dto.faturamento,
      tempoOperacao: dto.tempoOperacao,
      modeloOperacao: dto.modeloOperacao,
      cargo: dto.cargo,
      comoConheceu: dto.comoConheceu,
    });

    return {
      data: { id: lead.id },
      message:
        'Solicitação enviada com sucesso! Entraremos em contato em breve.',
    };
  }
}
