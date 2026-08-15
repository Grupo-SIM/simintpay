import {
  advanceBillingPeriod,
  calculateProration,
  retreatBillingPeriod,
} from './proration-calculator';

describe('calculateProration', () => {
  it('calcula preço base, preço unitário e metade do período', () => {
    const result = calculateProration({
      baseAmount: '100.00',
      unitAmount: '20.00',
      previousQuantity: 10,
      targetQuantity: 13,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-01T00:00:00.000Z'),
      effectiveAt: new Date('2026-08-15T12:00:00.000Z'),
    });

    expect(result.previousRecurringAmount.toFixed(2)).toBe('300.00');
    expect(result.nextRecurringAmount.toFixed(2)).toBe('360.00');
    expect(result.remainingRatio.toFixed(10)).toBe('0.5322580645');
    expect(result.prorationAmount.toFixed(2)).toBe('31.94');
  });

  it('limita a fração a um no início e zero no fim', () => {
    const common = {
      baseAmount: 0,
      unitAmount: 10,
      previousQuantity: 1,
      targetQuantity: 2,
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-03-01T00:00:00.000Z'),
    };
    expect(
      calculateProration({
        ...common,
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      }).prorationAmount.toFixed(2),
    ).toBe('10.00');
    expect(
      calculateProration({
        ...common,
        effectiveAt: common.periodEnd,
      }).prorationAmount.toFixed(2),
    ).toBe('0.00');
  });

  it('mantém o sinal para redução; a política de crédito pertence ao use case', () => {
    const result = calculateProration({
      baseAmount: 0,
      unitAmount: 30,
      previousQuantity: 5,
      targetQuantity: 3,
      periodStart: new Date('2026-01-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-01T00:00:00.000Z'),
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(result.prorationAmount.toFixed(2)).toBe('-60.00');
  });

  it('rejeita período inválido e quantidades negativas', () => {
    const input = {
      baseAmount: 0,
      unitAmount: 10,
      previousQuantity: 1,
      targetQuantity: 2,
      periodStart: new Date('2026-02-01T00:00:00.000Z'),
      periodEnd: new Date('2026-02-01T00:00:00.000Z'),
      effectiveAt: new Date('2026-02-01T00:00:00.000Z'),
    };
    expect(() => calculateProration(input)).toThrow('periodEnd');
    expect(() =>
      calculateProration({
        ...input,
        periodEnd: new Date('2026-03-01'),
        targetQuantity: -1,
      }),
    ).toThrow('targetQuantity');
  });
});

describe('advanceBillingPeriod', () => {
  it('ajusta âncoras no fim do mês e anos bissextos', () => {
    expect(
      advanceBillingPeriod(
        new Date('2024-01-31T10:30:00.000Z'),
        'MONTH',
        1,
      ).toISOString(),
    ).toBe('2024-02-29T10:30:00.000Z');
    expect(
      advanceBillingPeriod(
        new Date('2024-02-29T10:30:00.000Z'),
        'YEAR',
        1,
      ).toISOString(),
    ).toBe('2025-02-28T10:30:00.000Z');
  });

  it('reconstrói o início do ciclo a partir da próxima fatura', () => {
    expect(
      retreatBillingPeriod(
        new Date('2024-03-31T10:30:00.000Z'),
        'MONTH',
        1,
      ).toISOString(),
    ).toBe('2024-02-29T10:30:00.000Z');
    expect(
      retreatBillingPeriod(
        new Date('2025-02-28T10:30:00.000Z'),
        'YEAR',
        1,
      ).toISOString(),
    ).toBe('2024-02-28T10:30:00.000Z');
  });
});
