import { afterEach, expect, mock, test } from 'bun:test';
import { ensureDeliveryProfile } from './delivery-integration-profile';
import {
  decryptPlatformSecret,
  encryptPlatformSecret,
} from '../platform-integrations/platform-secrets';

const envKeys = ['DOM_TOKEN', 'PLATFORM_CONFIG_ENCRYPTION_KEY'] as const;
const previous = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
afterEach(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});
function fixture(saved: any = null) {
  process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'ab'.repeat(32);
  delete process.env.DOM_TOKEN;
  const db = {
    paymentIntegrationProfile: {
      findUnique: mock(async () => saved),
      upsert: mock(async ({ create }: any) => ({
        id: 'central-profile',
        isActive: true,
        ...create,
      })),
    },
  };
  return { db, run: () => ensureDeliveryProfile(db as never) };
}

test('initializes profile automatically from the admin DOM account', async () => {
  const { db, run } = fixture();
  process.env.DOM_TOKEN = ' admin-dom-account ';
  const profile = await run();
  expect(decryptPlatformSecret(profile.encryptedCredential)).toBe(
    'admin-dom-account',
  );
  expect(profile).toMatchObject({
    code: 'DELIVERY',
    acquirer: 'DOM',
    isActive: true,
  });
  expect(db.paymentIntegrationProfile.upsert.mock.calls[0][0].update).toEqual(
    {},
  );
});
test('uses the DOM_TOKEN as the central account', async () => {
  const { run } = fixture();
  process.env.DOM_TOKEN = 'admin-account';
  expect(decryptPlatformSecret((await run()).encryptedCredential)).toBe(
    'admin-account',
  );
});
test('retains an existing profile without rotating credentials or requiring another token', async () => {
  const { db, run } = fixture();
  const saved = {
    id: 'profile',
    code: 'DELIVERY',
    isActive: true,
    acquirer: 'DOM',
    encryptedCredential: encryptPlatformSecret('original-account'),
  };
  db.paymentIntegrationProfile.findUnique.mockResolvedValue(saved);
  process.env.DOM_TOKEN = 'different-account';
  expect(await run()).toEqual(saved);
  expect(db.paymentIntegrationProfile.upsert).not.toHaveBeenCalled();
});
test('rejects absent central credential with actionable error and no writes', async () => {
  const { db, run } = fixture();
  await expect(run()).rejects.toMatchObject({
    response: {
      code: 'DELIVERY_PROFILE_NOT_CONFIGURED',
      message: expect.stringContaining('DOM_TOKEN'),
    },
  });
  expect(db.paymentIntegrationProfile.upsert).not.toHaveBeenCalled();
});
test('never reactivates disabled profiles or changes their acquirer', async () => {
  for (const profile of [
    { isActive: false, acquirer: 'DOM' },
    { isActive: true, acquirer: 'FRENDZ' },
  ]) {
    const { db, run } = fixture(profile);
    process.env.DOM_TOKEN = 'admin-account';
    await expect(run()).rejects.toMatchObject({ status: 422 });
    expect(db.paymentIntegrationProfile.upsert).not.toHaveBeenCalled();
  }
});
