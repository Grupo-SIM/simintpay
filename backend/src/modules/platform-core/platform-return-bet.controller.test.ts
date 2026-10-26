import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { PlatformReturnBetController } from './platform-return-bet.controller';
import { ReturnBetController } from '../return-bet/return-bet.controller';
import { PlatformCorporateController } from './platform-corporate.controller';
import { ReturnBetWithdrawalService } from '../return-bet/return-bet-withdrawal.service';
import { ReturnBetWithdrawalPolicyService } from '../return-bet/return-bet-withdrawal-policy.service';
import { initializePlatformIntegrationsCache, invalidatePlatformIntegrationsCache } from '../platform-integrations/platform-integrations.store';
const req = { user: { sub: 'admin' }, platformContext: { id: 'p', tag: 'RETURN-BET', ownerUserId: 'owner', acquirer: 'DOM' as const } };
const row = { id: 'w', grossAmount: 120, netAmount: 118, fee: 2, status: 'PENDING' };
const translated = { id: 'w', grossAmountCents: 12000, netAmountCents: 11800, feeCents: 200, status: 'PENDING', unit: 'cents' };
beforeEach(async () => { await initializePlatformIntegrationsCache({ platformIntegration: { findMany: async () => [{ platform: { tag: 'RETURN-BET' }, key: 'INTERNAL_TOKEN', url: 'legacy-token' }] } } as any); });
afterEach(() => invalidatePlatformIntegrationsCache());
function fixture() {
  const withdrawals = { request: mock(async () => row), listStatus: mock(async () => [row]), approve: mock(async () => row), reject: mock(async () => row) };
  const policy = { get: mock(async () => ({ minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 30 })), set: mock(async (input: any) => input) };
  const community = { checkOne: mock(async () => ({ isActive: true })), checkBatch: mock(async () => [{ id: 'client', isActive: true }]) };
  const modules: any = { get: (key: any) => key === ReturnBetWithdrawalService ? withdrawals : key === ReturnBetWithdrawalPolicyService ? policy : community };
  return { withdrawals, policy, community, legacy: new ReturnBetController(community as any, withdrawals as any, policy as any), canonical: new PlatformReturnBetController(modules), corporate: new PlatformCorporateController(modules, {} as any) };
}
test('Return Bet withdrawal policy GET and PUT preserve service contracts and canonical cents', async () => {
  const { legacy, canonical, corporate, policy } = fixture();
  await expect(legacy.getWithdrawalPolicy('legacy-token')).resolves.toEqual({ minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 30 });
  expect(await corporate.policy(req)).toEqual({ minimumGrossAmountCents: 10000, fixedWithdrawalFeeCents: 200, withdrawalWindowDays: 30 });
  const input = { minimumGrossAmount: 100, fixedWithdrawalFee: 2, withdrawalWindowDays: 30 };
  await legacy.setWithdrawalPolicy(input, 'legacy-token');
  expect(await canonical.policy(req, { minimumGrossAmountCents: 10000, fixedWithdrawalFeeCents: 200, withdrawalWindowDays: 30 })).toEqual({ minimumGrossAmountCents: 10000, fixedWithdrawalFeeCents: 200, withdrawalWindowDays: 30 });
  expect(policy.set.mock.calls[0]).toEqual(policy.set.mock.calls[1]);
});
test('Return Bet community single and batch aliases use same services as canonical', async () => {
  const { legacy, canonical, corporate, community } = fixture();
  expect(await legacy.communityStatus_('123', undefined, 'legacy-token')).toEqual(await corporate.community(req, '123'));
  expect(await legacy.communityStatusBatch({ users: [{ id: 'client', cpf: '123' }] }, 'legacy-token')).toEqual(await canonical.community(req, { users: [{ id: 'client', cpf: '123' }] }));
  expect(community.checkBatch.mock.calls[0]).toEqual(community.checkBatch.mock.calls[1]);
});
test('Return Bet request and status aliases preserve response and translate cents once', async () => {
  const { legacy, canonical, withdrawals } = fixture();
  const input = { requestId: 'r', externalUserId: 'e', name: 'Name', email: 'client@example.com', document: '123', pixKey: '123', amount: 120, availableBalance: 150 };
  expect(await legacy.requestWithdrawal(input, 'legacy-token')).toEqual(row);
  const { amount, availableBalance, ...strings } = input;
  expect(await canonical.request(req, { ...strings, amountCents: 12000, availableBalanceCents: 15000 })).toEqual(translated);
  expect(withdrawals.request.mock.calls[0]).toEqual(withdrawals.request.mock.calls[1]);
  expect(await legacy.withdrawalStatusBatch({ requestIds: ['r'] }, 'legacy-token')).toEqual({ results: [row] });
  expect(await canonical.status(req, { requestIds: ['r'] })).toEqual({ results: [translated] });
});
for (const op of ['approve', 'reject'] as const) test(`Return Bet ${op} alias preserves lifecycle service arguments`, async () => {
  const { legacy, canonical, withdrawals } = fixture();
  if (op === 'approve') {
    const body = { receiptImage: 'https://receipt.test/file', actorReference: 'admin' };
    expect(await legacy.approveWithdrawal('r', body, 'legacy-token')).toEqual(row);
    expect(await canonical.approve(req, 'r', { receiptImage: body.receiptImage })).toEqual(translated);
  } else {
    const body = { reason: 'Invalid data', actorReference: 'admin' };
    expect(await legacy.rejectWithdrawal('r', body, 'legacy-token')).toEqual(row);
    expect(await canonical.reject(req, 'r', { reason: body.reason })).toEqual(translated);
  }
  expect(withdrawals[op].mock.calls[0]).toEqual(withdrawals[op].mock.calls[1]);
});
test('Return Bet legacy token, canonical units, foreign product and identity overrides are rejected', async () => {
  const { legacy, canonical, withdrawals } = fixture();
  expect(() => legacy.getWithdrawalPolicy('wrong')).toThrow('Token interno inválido');
  await expect(canonical.status({ platformContext: { ...req.platformContext, tag: 'BOSQUE' } }, { requestIds: [] })).rejects.toMatchObject({ response: { code: 'PLATFORM_CAPABILITY_UNAVAILABLE' } });
  await expect(canonical.request(req, { userId: 'other' })).rejects.toThrow('Contrato inválido');
  await expect(canonical.policy(req, { minimumGrossAmountCents: 100.5, fixedWithdrawalFeeCents: 2, withdrawalWindowDays: 30 })).rejects.toThrow('centavos inteiros');
  expect(withdrawals.request).not.toHaveBeenCalled();
});
