import { expect, test, mock } from 'bun:test';
import type { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { ApiDomClient } from './api-dom.client';
import { subscriptionStatusGroup } from '../../application/use-cases/subscription/subscription-status';

test('preserves unknown and paused subscription states instead of labeling them inactive', async () => {
  const get = mock(() => of({ data: { subscriptions: [
    { id: 'unknown', status: 'NEW_PROVIDER_STATE', actived: false },
    { id: 'missing' },
    { id: 'paused', status: 'paused' },
    { id: 'cancelled', status: 'CANCELLED' },
    { id: 'active', actived: true },
  ] } }));
  const client = new ApiDomClient({ get } as unknown as HttpService);
  const result = await client.listSubscriptions('local-test', { page: 1, pageSize: 20 });
  expect(result.items.map(row => subscriptionStatusGroup(row.status))).toEqual(['unknown', 'unknown', 'paused', 'deactivated', 'active']);
  expect(result.items[0].status).toBe('new_provider_state');
  expect(result.items[1].status).toBeUndefined();
});
