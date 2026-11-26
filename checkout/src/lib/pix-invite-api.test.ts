import { describe, expect, test } from 'bun:test';
import { buildInviteLinkByCodeUrl } from './pix-invite-api';

describe('buildInviteLinkByCodeUrl', () => {
  test('usa o endpoint invite-link-by-code com planCode e email', () => {
    const url = new URL(
      buildInviteLinkByCodeUrl('PX-AB12', 'a+b@x.com', 'https://api.test'),
    );
    expect(url.origin + url.pathname).toBe(
      'https://api.test/group-pages/public/invite-link-by-code',
    );
    expect(url.searchParams.get('planCode')).toBe('PX-AB12');
    expect(url.searchParams.get('email')).toBe('a+b@x.com');
    expect(url.searchParams.has('linkCode')).toBe(false);
  });
});
