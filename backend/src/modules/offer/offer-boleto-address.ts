import { BadRequestException } from '@nestjs/common';

export type BoletoAddressInput = {
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  complemento?: string;
};

export type BoletoAddress = {
  street: string;
  number: string;
  neighborhood: string;
  zipCode: string;
  city: string;
  uf: string;
  complement: string;
};

/**
 * Endereço do pagador de um boleto. Obrigatório: a DOM recusa sem street/cidade/uf/cep.
 * Mesma regra e mensagem do boleto avulso.
 */
export function normalizeBoletoAddress(
  input: BoletoAddressInput,
): BoletoAddress {
  const rua = (input.rua ?? '').trim();
  const cep = (input.cep ?? '').replace(/\D/g, '');
  const cidade = (input.cidade ?? '').trim();
  const uf = (input.uf ?? '').trim();
  const bairro = (input.bairro ?? '').trim();
  const numero = (input.numero ?? '').trim();
  if (!rua || !cidade || uf.length !== 2 || cep.length !== 8) {
    throw new BadRequestException(
      'Para boleto é obrigatório o endereço completo (CEP, rua, número, bairro, cidade e UF).',
    );
  }
  return {
    street: rua,
    number: numero || 'S/N',
    neighborhood: bairro,
    zipCode: cep,
    city: cidade,
    uf,
    complement: (input.complemento ?? '').trim(),
  };
}
