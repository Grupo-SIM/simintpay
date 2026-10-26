import { ApproveLeadUseCase } from './approve-lead.use-case';

function build(lead: any) {
  const leads = {
    findById: jest.fn().mockResolvedValue(lead),
    approve: jest.fn().mockResolvedValue({}),
  } as any;
  const users = {
    findByEmail: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'newUser1' }),
    updateDomData: jest.fn().mockResolvedValue({}),
    findByAffiliateCode: jest.fn().mockResolvedValue(null),
    setReferredBy: jest.fn().mockResolvedValue({}),
  } as any;
  const wallets = { createForUser: jest.fn().mockResolvedValue({}) } as any;
  const hash = { hash: jest.fn().mockResolvedValue('hashed') } as any;
  const gateway = {
    register: jest.fn().mockRejectedValue(new Error('dom indisponível em teste')),
    generateToken: jest.fn(),
  } as any;
  const email = { sendWelcome: jest.fn().mockResolvedValue(undefined) } as any;
  const linkExternal = { linkByCpf: jest.fn(), linkByCnpj: jest.fn() } as any;

  const uc = new ApproveLeadUseCase(leads, users, wallets, hash, gateway, email, linkExternal);
  return { uc, users };
}

describe('ApproveLeadUseCase — vínculo automático de afiliado', () => {
  it('vincula referredByUserId quando o lead tem referredByCode válido', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: 'ABC123',
    };
    const { uc, users } = build(lead);
    users.findByAffiliateCode.mockResolvedValue({ id: 'affiliate1' });

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.findByAffiliateCode).toHaveBeenCalledWith('ABC123');
    expect(users.setReferredBy).toHaveBeenCalledWith('newUser1', 'affiliate1');
  });

  it('não vincula nada quando o lead não tem referredByCode', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: null,
    };
    const { uc, users } = build(lead);

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.findByAffiliateCode).not.toHaveBeenCalled();
    expect(users.setReferredBy).not.toHaveBeenCalled();
  });

  it('não vincula nada quando o código não bate com nenhum afiliado', async () => {
    const lead = {
      id: 'lead1', email: 'novo@x.com', name: 'Novo', status: 'PENDING',
      cpf: '12345678901', cnpj: null, referredByCode: 'CODIGO_INEXISTENTE',
    };
    const { uc, users } = build(lead);
    users.findByAffiliateCode.mockResolvedValue(null);

    await uc.execute({ leadId: 'lead1', adminUserId: 'admin1' });

    expect(users.setReferredBy).not.toHaveBeenCalled();
  });
});
