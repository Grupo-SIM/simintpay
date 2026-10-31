jest.mock('uuid', () => ({
  v4: () => 'test-uuid',
  v5: () => 'test-uuid',
  MAX: '',
  NIL: '',
}));
jest.mock('../../../modules/ebooksim/ebooksim.config', () => ({
  ...jest.requireActual('../../../modules/ebooksim/ebooksim.config'),
  getEbookTaxaServico: () => 4,
}));

import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';
import { TransactionStatus } from '@prisma/client';

/**
 * Crédito duplicado na wallet: uma venda paga não pode ser creditada duas vezes
 * (regressão COMPLETED → PENDING/FAILED/EXPIRED seguida de novo "paid", ou webhooks simultâneos).
 */
describe('ProcessDomWebhookUseCase — proteção contra crédito duplicado', () => {
  function buildUseCase(existingTx: any, statusUpdateCount = 1) {
    const walletDeltas: string[] = [];
    const wallet = {
      id: 'wallet1',
      balance: {
        add: (d: any) => {
          walletDeltas.push(d.toString());
          return wallet.balance;
        },
      },
      lockedBalance: { add: () => wallet.lockedBalance },
      version: 1,
    };

    const prismaTxClient = {
      transaction: {
        updateMany: jest.fn().mockResolvedValue({ count: statusUpdateCount }),
      },
      transactionStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      wallet: {
        findUnique: jest.fn().mockResolvedValue(wallet),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      balanceLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wh1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscriptionLinkOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      transaction: { findFirst: jest.fn().mockResolvedValue(existingTx) },
      voucher: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const uc = new ProcessDomWebhookUseCase(
      prisma,
      { recordUsage: jest.fn() } as any,
      undefined as any,
    );
    (uc as any).affiliateCommission = {
      applyForTransaction: jest.fn().mockResolvedValue(undefined),
      reverseForTransaction: jest.fn().mockResolvedValue(undefined),
    };

    return { uc, prisma, prismaTxClient, walletDeltas };
  }

  const ebookTx = (status: TransactionStatus) => ({
    id: 'tx-ebook',
    userId: 'seller1',
    status,
    netAmount: '50.92',
    platformFee: '0',
    description: 'ORD-2026-000001 [TENANT:EBOOK] [CPF_DONO:00000000000]',
    platformTag: 'EBOOK',
    domPaymentId: 'dom-ebook',
  });

  it.each(['pending', 'failed', 'expired'])(
    'ignora regressão de COMPLETED para "%s" (sem alterar status nem wallet)',
    async (domStatus) => {
      const { uc, prisma, walletDeltas } = buildUseCase(
        ebookTx(TransactionStatus.COMPLETED),
      );

      await uc.execute({
        event: 'charge',
        signature: `sig-${domStatus}`,
        data: { id: 'dom-ebook', amount: 5990, status: domStatus },
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(walletDeltas).toHaveLength(0);
    },
  );

  it('não credita quando outro webhook já mudou o status (updateMany condicional = 0)', async () => {
    const { uc, prismaTxClient, walletDeltas } = buildUseCase(
      ebookTx(TransactionStatus.PENDING),
      0,
    );

    await uc.execute({
      event: 'charge',
      signature: 'sig-race',
      data: { id: 'dom-ebook', amount: 5990, status: 'paid' },
    });

    expect(prismaTxClient.transaction.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx-ebook', status: TransactionStatus.PENDING },
      }),
    );
    expect(walletDeltas).toHaveLength(0);
  });

  it('venda EBOOK credita netAmount − TAXA_SERVICO (uma única taxa fixa)', async () => {
    const { uc, walletDeltas } = buildUseCase(
      ebookTx(TransactionStatus.PENDING),
    );

    await uc.execute({
      event: 'charge',
      signature: 'sig-paid',
      data: { id: 'dom-ebook', amount: 5990, status: 'paid' },
    });

    expect(walletDeltas).toEqual(['46.92']);
  });
});
