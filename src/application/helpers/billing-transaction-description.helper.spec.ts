import { buildBillingTransactionDescription } from './billing-transaction-description.helper';

describe('buildBillingTransactionDescription', () => {
  it('acrescenta a tag normalizada da plataforma', () => {
    expect(
      buildBillingTransactionDescription('Workspace', {
        platformTag: 'teron',
      }),
    ).toBe('Workspace [TENANT:TERON]');
  });

  it('não duplica uma tag existente', () => {
    expect(
      buildBillingTransactionDescription('Workspace [TENANT:TERON]', {
        platformTag: 'TERON',
      }),
    ).toBe('Workspace [TENANT:TERON]');
  });
});
