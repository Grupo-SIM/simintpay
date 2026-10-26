jest.mock('uuid', () => ({ v4: () => 'test-uuid', v5: () => 'test-uuid', MAX: '', NIL: '' }));

import { ProcessDomWebhookUseCase } from './process-dom-webhook.use-case';

/**
 * `handleSubscriptionLinkPix` é privado e cria a `Transaction` já `COMPLETED`
 * (Areaflix subcontas, comunidades) num caminho que roda ANTES do fluxo
 * regular `handleTransaction` (coberto por process-dom-webhook.affiliate.spec.ts).
 * Testamos via `execute()` com um payload cujo `data.id` bate com uma
 * `SubscriptionLinkOrder`, garantindo que o hook de comissão também dispara
 * aqui. O resto dos efeitos colaterais da função (e-mail, fetch externo,
 * provisionamento) não é escopo deste spec.
 */
describe('ProcessDomWebhookUseCase — comissão de afiliado em handleSubscriptionLinkPix', () => {
  function buildUseCase(order: any, createdTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const prismaTxClient = {} as any;

    const prisma = {
      webhookEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'wh1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      subscriptionLinkOrder: {
        findFirst: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({}),
      },
      communityLinkBinding: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      transaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdTx),
      },
      $transaction: jest.fn().mockImplementation((cb: any) => cb(prismaTxClient)),
    } as any;

    const voucherService = { recordUsage: jest.fn() } as any;

    // Terceiro arg (affiliateCommission) é sobrescrito logo abaixo — passamos
    // `undefined as any` só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessDomWebhookUseCase(prisma, voucherService, undefined as any);
    (uc as any).affiliateCommission = { applyForTransaction, reverseForTransaction };

    return { uc, applyForTransaction, prisma };
  }

  function baseOrder(overrides: Record<string, any> = {}) {
    return {
      id: 'suborder-1',
      userId: 'user-aff-1',
      status: 'pending',
      domPixPaymentId: 'dom-sub-1',
      subscriptionLinkId: 'link-1',
      amountCharged: 100,
      platformFeeAmount: 10,
      customerName: 'Cliente Teste',
      customerEmail: 'cliente@example.com',
      customerDocument: '12345678900',
      customerPhone: null,
      subscriptionLink: {
        name: 'Plano Teste',
        webhookUrl: null,
        platformTag: null,
        plataformas: [],
        frequencyType: 'MONTHLY',
        emailBody: null,
        redirectUrl: null,
      },
      ...overrides,
    };
  }

  it('credita comissão de afiliado na transação criada pelo branch subPlatformTag (link com platformTag)', async () => {
    const order = baseOrder({
      subscriptionLink: {
        name: 'Plano Renovada',
        webhookUrl: null,
        platformTag: 'RENOVADA',
        plataformas: [],
        frequencyType: 'MONTHLY',
        emailBody: null,
        redirectUrl: null,
      },
    });
    const createdTx = { id: 'newtx-1', platformFee: 10 };
    const { uc, applyForTransaction } = buildUseCase(order, createdTx);

    await uc.execute({
      event: 'charge',
      signature: 'sig-subaffiliate-1',
      data: { id: 'dom-sub-1', amount: 10000, status: 'paid' },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transactionId: 'newtx-1',
        referredUserId: 'user-aff-1',
        platformFee: 10,
      }),
    );
  });

  it('credita comissão de afiliado na transação criada pelo branch de fallback/comunidade', async () => {
    const order = baseOrder();
    const createdTx = { id: 'newtx-2', platformFee: 10 };
    const { uc, applyForTransaction, prisma } = buildUseCase(order, createdTx);
    prisma.communityLinkBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      community: { slug: 'clube-x' },
    });

    await uc.execute({
      event: 'charge',
      signature: 'sig-subaffiliate-2',
      data: { id: 'dom-sub-1', amount: 10000, status: 'paid' },
    });

    expect(applyForTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transactionId: 'newtx-2',
        referredUserId: 'user-aff-1',
        platformFee: 10,
      }),
    );
  });
});
