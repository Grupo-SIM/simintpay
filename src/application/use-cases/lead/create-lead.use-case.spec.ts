import { CreateLeadUseCase } from './create-lead.use-case';

const baseDto: any = {
  name: 'João',
  phone: '11999999999',
  email: 'joao@empresa.com',
  razaoSocial: 'Empresa LTDA',
  cnpj: '12.345.678/0001-90',
  cpf: '123.456.789-09',
  faturamento: 'DE_50K_A_100K',
  tempoOperacao: 'DE_1_A_3_ANOS',
  cargo: 'SOCIO',
};

function build() {
  const leads = {
    findByEmailOrCnpj: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'lead1' }),
  } as any;
  return { uc: new CreateLeadUseCase(leads), leads };
}

describe('CreateLeadUseCase — referredByCode', () => {
  it('repassa referredByCode pro repositório quando informado', async () => {
    const { uc, leads } = build();
    await uc.execute({ ...baseDto, referredByCode: 'ABC123' });
    expect(leads.create).toHaveBeenCalledWith(expect.objectContaining({ referredByCode: 'ABC123' }));
  });

  it('não quebra quando referredByCode não é informado', async () => {
    const { uc, leads } = build();
    await uc.execute({ ...baseDto });
    expect(leads.create).toHaveBeenCalledWith(expect.objectContaining({ referredByCode: undefined }));
  });
});
