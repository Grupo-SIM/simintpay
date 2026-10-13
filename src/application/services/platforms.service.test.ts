import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { PlatformsService } from './platforms.service';
import type { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const user = { sub: 'owner', email: 'owner@example.com', role: 'USER' };

function service(platform = { id: 'platform', tag: 'SHOP', ownerUserId: 'owner' }) {
  const update = mock(async () => platform);
  const prisma = { platform: { findUnique: mock(async () => platform), update }, user: { findFirst: mock(async () => null), findUnique: mock(async () => ({ id: 'owner', role: 'USER', isActive: true, isPurged: false })) } };
  return { service: new PlatformsService(prisma as unknown as PrismaService), update };
}

describe('Platform ownership', () => {
  test('owner cannot transfer platform', async () => {
    const fixture = service();
    await expect(fixture.service.update('SHOP', user, { ownerUserId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('different owner cannot edit platform', async () => {
    const fixture = service({ id: 'platform', tag: 'SHOP', ownerUserId: 'other' });
    await expect(fixture.service.update('SHOP', user, { name: 'Renamed' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  test('owner cannot create platform assigned to another user', async () => {
    const fixture = service();
    await expect(fixture.service.create(user, { tag: 'SHOP', name: 'Shop', ownerUserId: 'other' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
