jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
  v5: () => 'test-uuid',
  MAX: '',
  NIL: '',
}));

import { AdminController } from './admin.controller';

describe('AdminController.listCobrancaClientes', () => {
  const users = [
    {
      id: 'cliente', name: 'Cliente Real', email: 'cliente@exemplo.com', billingExcluded: false,
      isCompany: true, wallet: { balance: 125, lockedBalance: 25 },
    },
    {
      id: 'zerado', name: 'Cliente Sem Saldo', email: 'zerado@exemplo.com', billingExcluded: false,
      isCompany: true, wallet: { balance: 0, lockedBalance: 0 },
    },
    {
      id: 'devedor', name: 'Cliente Devedor', email: 'devedor@exemplo.com', billingExcluded: false,
      isCompany: true, wallet: { balance: -27.63, lockedBalance: 0 },
    },
    {
      id: 'pessoa', name: 'Pessoa Física', email: 'pessoa@exemplo.com', billingExcluded: false,
      isCompany: false, wallet: { balance: 40, lockedBalance: 0 },
    },
    {
      id: 'tecnico', name: 'Platform User', email: 'platform-a@auto.simpay.com', billingExcluded: false,
      isCompany: true, wallet: { balance: 0, lockedBalance: 0 },
    },
    {
      id: 'removido', name: 'Não cobrar', email: 'nao-cobrar@exemplo.com', billingExcluded: true,
      isCompany: true, wallet: { balance: 80, lockedBalance: 0 },
    },
  ];

  const filterUsers = (where: any) => users.filter((user) => {
    if (where.isCompany === true && !user.isCompany) return false;
    if (where.wallet?.is?.balance?.not === 0 && Number(user.wallet.balance) === 0) return false;
    if (where.billingExcluded === false && user.billingExcluded) return false;
    if (where.NOT?.email?.endsWith === '@auto.simpay.com' && user.email.endsWith('@auto.simpay.com')) return false;
    return true;
  });

  function makePrisma() {
    return {
      user: {
        count: jest.fn().mockImplementation(({ where }) => filterUsers(where).length),
        findMany: jest.fn().mockImplementation(({ where, skip, take }) => filterUsers(where).slice(skip, skip + take)),
        update: jest.fn().mockResolvedValue({ id: 'cliente', billingExcluded: true }),
      },
    };
  }

  it('não lista clientes com saldo zerado', async () => {
    const prisma = makePrisma();

    const result = await (AdminController.prototype as any).listCobrancaClientes.call(
      { prisma }, undefined, '1', '20',
    );

    expect(result.data.map((c: any) => c.id)).not.toContain('zerado');
  });

  it('lista clientes com saldo negativo (ainda há o que cobrar)', async () => {
    const prisma = makePrisma();

    const result = await (AdminController.prototype as any).listCobrancaClientes.call(
      { prisma }, undefined, '1', '20',
    );

    expect(result.data).toContainEqual(
      expect.objectContaining({ id: 'devedor', saldoDisponivel: -27.63 }),
    );
  });

  it('não lista contas pessoais (não marcadas como empresa)', async () => {
    const prisma = makePrisma();

    const result = await (AdminController.prototype as any).listCobrancaClientes.call(
      { prisma }, undefined, '1', '20',
    );

    expect(result.data.map((c: any) => c.id)).not.toContain('pessoa');
  });

  it('bloqueia cobrança em conta que não é empresa', async () => {
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'cliente' }]) },
    };

    await expect(
      (AdminController.prototype as any).assertClientesCobraveis.call({ prisma }, ['cliente', 'pessoa']),
    ).rejects.toThrow(/pessoa/);
  });

  it('não lista contas técnicas nem contas removidas da cobrança', async () => {
    const prisma = makePrisma();

    const result = await (AdminController.prototype as any).listCobrancaClientes.call(
      { prisma }, undefined, '1', '20',
    );

    expect(result.total).toBe(2);
    expect(result.data).toEqual([
      expect.objectContaining({ id: 'cliente', saldoDisponivel: 100 }),
      expect.objectContaining({ id: 'devedor', saldoDisponivel: -27.63 }),
    ]);
  });

  it('marca a conta escolhida como removida da lista de cobranças', async () => {
    const prisma = makePrisma();

    await (AdminController.prototype as any).excludeCobrancaCliente.call({ prisma }, 'cliente');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'cliente' },
      data: { billingExcluded: true },
    });
  });
});
