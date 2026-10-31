import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTransactionsQueryDto } from '../src/application/dtos/transactions/list-transactions.query.dto';
import { ListTransactionsUseCase } from '../src/application/use-cases/transactions/list-transactions.use-case';
import type { PrismaService } from '../src/infrastructure/database/prisma/prisma.service';
import { listTransacoes } from '../../frontend/src/features/transacoes/services/transacoes.service';
import type { ApiClient } from '../../frontend/src/services/api/api.client';

// Exercise the frontend transport -> validated backend DTO -> ledger query without a database.
async function request(
  query: Parameters<typeof listTransacoes>[1],
  role = 'ADMIN',
) {
  let captured: Record<string, unknown> = {};
  let counted: unknown;
  let selected: any;
  const prisma = {
    user: { findUnique: async () => ({ cpf: null }) },
    transaction: {
      count: async ({ where }: any) => {
        counted = where;
        return 41;
      },
      findMany: async (args: any) => {
        selected = args;
        return [];
      },
    },
  };
  const useCase = new ListTransactionsUseCase(
    prisma as unknown as PrismaService,
  );
  const api = {
    get: async (_path: string, options: any) => {
      captured = Object.fromEntries(
        Object.entries(options.query).filter(
          ([, value]) => value !== undefined,
        ),
      );
      const dto = plainToInstance(ListTransactionsQueryDto, captured);
      expect(await validate(dto)).toEqual([]);
      return useCase.execute({ userId: 'owner', role, query: dto });
    },
  } as unknown as ApiClient;
  const result = await listTransacoes(api, query);
  expect(selected.where).toEqual(counted);
  return { result, captured, selected, predicates: selected.where.AND ?? [] };
}

describe('transaction filter transport and ledger integration', () => {
  test('combines all applied filters before pagination and returns the filtered total', async () => {
    const { captured, selected, predicates, result } = await request({
      page: 3,
      pageSize: 20,
      status: 'COMPLETED',
      paymentMethod: 'DEBIT_CARD',
      acquirer: 'FRENDZ',
      dataInicio: '2026-10-01',
      dataFim: '2026-10-31',
      q: ' reference ',
      domTransactionId: 'external',
      customerName: ' Maria ',
      customerEmail: 'maria@example.com',
      customerDocument: '123.456.789-00',
      plataforma: 'ATLAS',
      tipoTransacao: 'online',
    });
    expect(captured.status).toBe('COMPLETED');
    expect(captured.q).toBe('reference');
    expect(predicates).toContainEqual({ status: 'COMPLETED' });
    expect(predicates).toContainEqual({ paymentMethod: 'DEBIT_CARD' });
    expect(predicates).toContainEqual({ acquirer: 'FRENDZ' });
    expect(predicates).toContainEqual({
      customerName: { contains: 'Maria', mode: 'insensitive' },
    });
    expect(predicates).toContainEqual({
      platformTag: { equals: 'ATLAS', mode: 'insensitive' },
    });
    expect(JSON.stringify(predicates)).toContain('externalPaymentId');
    expect(JSON.stringify(predicates)).toContain('12345678900');
    expect(JSON.stringify(predicates)).toContain('"description":null');
    const dates = predicates.find((entry: any) => entry.createdAt).createdAt;
    expect(dates.gte.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(dates.lte.toISOString()).toBe('2026-11-01T02:59:59.999Z');
    expect(selected.skip).toBe(40);
    expect(selected.take).toBe(20);
    expect(result.total).toBe(41);
  });

  test('reset removes filters but never removes owner visibility', async () => {
    const { predicates, selected } = await request(
      { page: 1, pageSize: 20 },
      'USER',
    );
    expect(predicates).toHaveLength(1);
    expect(JSON.stringify(predicates)).toContain('owner');
    expect(JSON.stringify(predicates)).toContain('coproductionAllocations');
    expect(selected.skip).toBe(0);
  });

  test('export keeps applied filters for every page', async () => {
    const applied = {
      status: 'REFUNDED',
      paymentMethod: 'BOLETO',
      acquirer: 'DOM',
      tipoTransacao: 'maquinetas',
      plataforma: 'ATLAS',
    };
    const first = await request({ ...applied, page: 1, pageSize: 100 });
    const next = await request({ ...applied, page: 2, pageSize: 100 });
    expect(first.predicates).toEqual(next.predicates);
    expect(first.selected.take).toBe(100);
    expect(next.selected.skip).toBe(100);
    expect(JSON.stringify(first.predicates)).toContain('maquineta');
  });

  test('rejects invalid filters and inverted or impossible dates', async () => {
    expect(
      await validate(
        plainToInstance(ListTransactionsQueryDto, {
          status: 'PAID',
          payment_method: 'card',
          acquirer: 'other',
        }),
      ),
    ).toHaveLength(3);
    await expect(request({ dataInicio: '2026-02-30' })).rejects.toThrow(
      'Data inválida',
    );
    await expect(
      request({ dataInicio: '2026-10-31', dataFim: '2026-10-01' }),
    ).rejects.toThrow('Data inicial');
  });
});
