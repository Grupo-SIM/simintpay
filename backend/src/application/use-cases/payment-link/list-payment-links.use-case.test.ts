import { expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { ListPaymentLinksUseCase } from './list-payment-links.use-case';
import { ListPaymentLinksQueryDto } from '../../dtos/payment-link/list-payment-links.query.dto';
import { ListBoletosUseCase } from '../boleto/list-boletos.use-case';
import { ListSubscriptionLinksUseCase } from '../subscription-link/list-subscription-links.use-case';
import { ListPlansUseCase } from '../plan/list-plans.use-case';
import { PixPlanService } from '../pix-plan/pix-plan.service';
for (const role of ['ADMIN', 'USER']) for (const raw of [undefined, 'true', '1', 'false', '0']) {
  test(`${role} onlyMine=${raw} preserves authorization, count and pagination across five products`, async () => {
    const query = plainToInstance(ListPaymentLinksQueryDto, { page: '2', pageSize: '3', onlyMine: raw });
    const own = role !== 'ADMIN' || raw === 'true' || raw === '1';
    const calls: any[] = [];
    const model = { count: async (arg: any) => { calls.push({ count: arg }); return 5; }, findMany: async (arg: any) => { calls.push(arg); return []; } };
    const prisma: any = { paymentLink: model, boleto: model, plan: model, $transaction: async (queries: any) => Promise.all(queries) };
    for (const service of [new ListPaymentLinksUseCase({} as never, prisma), new ListBoletosUseCase({} as never, prisma)]) {
      calls.length = 0;
      const result = await service.execute({ userId: 'actor', role, query });
      expect(result.total).toBe(5); expect(result.page).toBe(2);
      expect(calls[1]).toMatchObject({ skip: 3, take: 3 });
      expect(calls[1].where).toEqual(own ? { userId: 'actor' } : undefined);
      expect(calls[0].count?.where).toEqual(own ? { userId: 'actor' } : undefined);
    }
    calls.length = 0;
    await new ListPlansUseCase(prisma).execute({ userId: 'actor', role, onlyMine: query.onlyMine });
    expect(calls[0].where).toEqual(own ? { userId: 'actor' } : undefined);
    const repo: any = {
      findAll: async (arg: any) => { calls.push(arg); return { items: [], total: 5 }; },
      findManyByUserId: async (arg: any) => { calls.push(arg); return { items: [], total: 5 }; },
    };
    calls.length = 0;
    await new ListSubscriptionLinksUseCase(repo).execute({ userId: 'actor', role, onlyMine: query.onlyMine, page: 2, pageSize: 3 });
    expect(calls[0]).toMatchObject({ page: 2, pageSize: 3 });
    expect(calls[0].userId).toBe(own ? 'actor' : undefined);
    calls.length = 0;
    await PixPlanService.prototype.listPixCreditPlansPaginated.call({ repo: { findPixCreditPlansByUserIdPaginated: async (arg: any) => { calls.push(arg); return { items: [], total: 5 }; } } } as any,
      { userId: 'actor', role, onlyMine: query.onlyMine, page: 2, limit: 3, search: 'Plan', status: 'active' });
    expect(calls[0]).toMatchObject({ userId: own ? 'actor' : undefined, page: 2, limit: 3, search: 'Plan', status: 'active' });
  });
}
