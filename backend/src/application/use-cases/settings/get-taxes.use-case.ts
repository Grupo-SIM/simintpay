import { Inject, Injectable } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { getPlatformTaxaEffective } from '../../../modules/platform-taxas/platform-taxas.store';
import { PLATFORM_TAXA_DEFAULTS } from '../../../modules/platform-taxas/platform-taxas.keys';

@Injectable()
export class GetTaxesUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(input: { userId: string }): Promise<{ data: unknown }> {
    const user = await this.users.findById(input.userId);

    const platformTag = (user as any)?.platform?.tag?.toUpperCase() ?? 'GLOBAL';

    const taxaServico = getPlatformTaxaEffective(
      platformTag,
      'TAXA_SERVICO',
      PLATFORM_TAXA_DEFAULTS.TAXA_SERVICO,
    );
    const taxaFixaTransacao = getPlatformTaxaEffective(
      platformTag,
      'TAXA_FIXA_TRANSACAO',
      PLATFORM_TAXA_DEFAULTS.TAXA_FIXA_TRANSACAO,
    );
    const taxaCashback = getPlatformTaxaEffective(
      platformTag,
      'TAXA_CASHBACK',
      PLATFORM_TAXA_DEFAULTS.TAXA_CASHBACK,
    );
    const liquidez = getPlatformTaxaEffective(
      platformTag,
      'LIQUIDEZ',
      PLATFORM_TAXA_DEFAULTS.LIQUIDEZ,
    );
    const mdrPix = getPlatformTaxaEffective(
      platformTag,
      'MDR_PIX',
      PLATFORM_TAXA_DEFAULTS.MDR_PIX,
    );

    const plataforma = {
      taxaServico,
      taxaFixaTransacao,
      taxaCashback,
      liquidez,
      mdrPix,
    };

    return { data: { plataforma } };
  }
}
