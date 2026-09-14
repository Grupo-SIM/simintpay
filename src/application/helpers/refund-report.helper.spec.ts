import { summarizeRefunds } from './refund-report.helper';

describe('summarizeRefunds', () => {
  it('counts refunds using the refund transition date', () => {
    const result = summarizeRefunds(
      [
        {
          amount: '125.50',
          updatedAt: new Date('2026-08-01T12:00:00.000Z'),
          statusHistory: [{ createdAt: new Date('2026-09-05T15:00:00.000Z') }],
        },
      ],
      {
        start: new Date('2026-09-01T00:00:00.000Z'),
        end: new Date('2026-09-30T23:59:59.999Z'),
      },
    );

    expect(result).toEqual({ quantidade: 1, valor: 125.5 });
  });

  it('uses updatedAt for synchronized refunds without status history', () => {
    const result = summarizeRefunds(
      [
        {
          amount: 80,
          updatedAt: new Date('2026-09-07T10:00:00.000Z'),
          statusHistory: [],
        },
        {
          amount: 20,
          updatedAt: new Date('2026-08-31T23:59:59.999Z'),
          statusHistory: [],
        },
      ],
      { start: new Date('2026-09-01T00:00:00.000Z') },
    );

    expect(result).toEqual({ quantidade: 1, valor: 80 });
  });

  it('counts every product refund without a date filter', () => {
    const result = summarizeRefunds([
      {
        amount: '1.005',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        statusHistory: [],
      },
      {
        amount: '2.005',
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        statusHistory: [],
      },
    ]);

    expect(result).toEqual({ quantidade: 2, valor: 3.01 });
  });

  it('counts product report refunds using the original transaction date', () => {
    const result = summarizeRefunds(
      [
        {
          amount: 1,
          createdAt: new Date('2026-05-09T23:06:00.000Z'),
          updatedAt: new Date('2026-09-11T12:00:00.000Z'),
          statusHistory: [{ createdAt: new Date('2026-09-11T12:00:00.000Z') }],
        },
      ],
      {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-30T23:59:59.999Z'),
        dateBasis: 'transaction',
      },
    );

    expect(result).toEqual({ quantidade: 1, valor: 1 });
  });
});
