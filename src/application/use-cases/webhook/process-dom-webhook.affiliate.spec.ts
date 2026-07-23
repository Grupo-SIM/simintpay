jest.mock('uuid', () => ({ v4: () => 'test-uuid', v5: () => 'test-uuid', MAX: '', NIL: '' }));

import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';
import { TransactionStatus } from '@prisma/client';

/**
 * `handleTransaction` é privado; testamos via `execute()` com um payload de
 * transação regular (evento 'charge'), que é o que dispara o branch.
 * O foco aqui é só confirmar que o hook de comissão é chamado com os
 * argumentos certos — o resto do fluxo já tem cobertura própria no arquivo.
 */
describe('ProcessDomWebhookUseCase — hook de comissão de afiliado', () => {
  function buildUseCase(existingTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const wallet = {
      id: 'wallet1',
      balance: { add: (d: any) => wallet.balance, sub: (d: any) => wallet.balance },
      lockedBalance: { add: (d: any) => wallet.lockedBalance },
      version: 1,
    };

    const prismaTxClient = {
      transaction: { update: jest.fn().mockResolvedValue({}) },
      transactionStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      balanceLog: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wh1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      // `execute()` primeiro tenta achar uma SubscriptionLinkOrder pelo domPaymentId;
      // null faz cair no fluxo normal de handleTransaction.
      subscriptionLinkOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      transaction: { findFirst: jest.fn().mockResolvedValue(existingTx) },
      voucher: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const voucherService = { recordUsage: jest.fn() } as any;

    // Terceiro arg (affiliateCommission) é sobrescrito logo abaixo — passamos
    // `undefined as any` só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessDomWebhookUseCase(prisma, voucherService, undefined as any);
    (uc as any).affiliateCommission = { applyForTransaction, reverseForTransaction };

    return { uc, applyForTransaction, reverseForTransaction, prisma };
  }

  it('chama applyForTransaction quando a transação vira COMPLETED', async () => {
    const existingTx = {
      id: 'tx1',
      userId: 'user1',
      status: TransactionStatus.PENDING,
      netAmount: '50.00',
      platformFee: '5.00',
      description: null,
      domPaymentId: 'dom-1',
    };
    const { uc, applyForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      event: 'charge',
      signature: 'sig-1',
      data: { id: 'dom-1', amount: 5000, status: 'paid' },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transactionId: 'tx1', referredUserId: 'user1', platformFee: '5.00' }),
    );
  });

  it('chama reverseForTransaction quando a transação vai de COMPLETED pra REFUNDED', async () => {
    const existingTx = {
      id: 'tx2',
      userId: 'user1',
      status: TransactionStatus.COMPLETED,
      netAmount: '50.00',
      platformFee: '5.00',
      description: null,
      domPaymentId: 'dom-2',
    };
    const { uc, reverseForTransaction } = buildUseCase(existingTx);

    await uc.execute({
      event: 'charge',
      signature: 'sig-2',
      data: { id: 'dom-2', amount: 5000, status: 'refunded' },
    });

    expect(reverseForTransaction).toHaveBeenCalledWith(expect.anything(), 'tx2');
  });
});
