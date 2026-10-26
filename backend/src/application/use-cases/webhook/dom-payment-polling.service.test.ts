import { describe, expect, mock, test } from 'bun:test';
import { DomPaymentPollingService } from './dom-payment-polling.service';

describe('DOM payment polling lifecycle', () => {
  test('starts immediately, polls again after five seconds and stops on shutdown', async () => {
    const pollRecentPayments = mock(async () => undefined);
    const service = new DomPaymentPollingService({ pollRecentPayments } as never);
    try {
      service.onApplicationBootstrap();
      service.onApplicationBootstrap();
      expect(pollRecentPayments).toHaveBeenCalledTimes(1);
      await Bun.sleep(5_100);
      expect(pollRecentPayments).toHaveBeenCalledTimes(2);
    } finally {
      service.onApplicationShutdown();
    }
  }, 7_000);
});
