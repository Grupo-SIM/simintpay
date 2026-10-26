import { ProcessWebhookUseCase } from './process-webhook.use-case';

/**
 * `handleSubscriptionLinkPix` é privado e cria a `Transaction` já `COMPLETED`
 * (Areaflix subcontas, comunidades) num caminho que roda ANTES do fluxo
 * regular de `execute()` (coberto por process-webhook.affiliate.spec.ts).
 * Testamos via `execute()` com um payload cujo `data.paymentId` bate com uma
 * `SubscriptionLinkOrder`, garantindo que o hook de comissão também dispara
 * aqui. O resto dos efeitos colaterais da função (e-mail, comunidade, fetch
 * externo) não é escopo deste spec.
 */
describe('ProcessWebhookUseCase — comissão de afiliado em handleSubscriptionLinkPix', () => {
  function buildUseCase(order: any, createdTx: any) {
    const applyForTransaction = jest.fn().mockResolvedValue(undefined);
    const reverseForTransaction = jest.fn().mockResolvedValue(undefined);

    const prismaTxClient = {} as any;

    const events = {
      findByEventId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as any;

    const transactions = {
      findByDomPaymentId: jest.fn().mockResolvedValue(null),
    } as any;

    const balanceLogs = {} as any;

    const prisma = {
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

    const renovadaEvents = { emitTransaction: jest.fn() } as any;

    // Sexto arg (affiliateCommission) é sobrescrito logo abaixo — `undefined as any`
    // só pra bater a contagem de parâmetros do construtor.
    const uc = new ProcessWebhookUseCase(events, transactions, balanceLogs, prisma, renovadaEvents, undefined as any);
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
        frequencyType: 'MONTHLY',
        emailBody: null,
        redirectUrl: null,
      },
      ...overrides,
    };
  }

  it('credita comissão de afiliado na transação criada pelo branch areaflix (webhookUrl contém "areaflix")', async () => {
    const order = baseOrder({
      subscriptionLink: {
        name: 'Plano Areaflix',
        webhookUrl: 'https://saas-areaflix-back.example.com/hook',
        frequencyType: 'MONTHLY',
        emailBody: null,
        redirectUrl: null,
      },
    });
    const createdTx = { id: 'newtx-1', platformFee: 10 };
    const { uc, applyForTransaction } = buildUseCase(order, createdTx);

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-subaffiliate-1',
        data: { paymentId: 'dom-sub-1', status: 'paid', amountWithoutAllFee: 90 },
      },
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

  it('credita comissão de afiliado na transação criada pelo branch de comunidade (hasCommunity)', async () => {
    const order = baseOrder();
    const createdTx = { id: 'newtx-2', platformFee: 10 };
    const { uc, applyForTransaction, prisma } = buildUseCase(order, createdTx);
    prisma.communityLinkBinding.findFirst.mockResolvedValue({
      id: 'binding-1',
      community: { slug: 'clube-x' },
    });

    await uc.execute({
      payload: {
        event: 'charge',
        signature: 'sig-subaffiliate-2',
        data: { paymentId: 'dom-sub-1', status: 'paid', amountWithoutAllFee: 90 },
      },
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
