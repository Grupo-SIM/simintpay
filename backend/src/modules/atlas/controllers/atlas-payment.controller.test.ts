import { describe, expect, mock, test } from 'bun:test';
import { NotFoundException } from '@nestjs/common';
import { AtlasPaymentController } from './atlas-payment.controller';

describe('AtlasPaymentController assigned owner', () => {
  test('fails before payment creation when platform is absent', async () => {
    const payments = { createPaymentPix: mock() };
    const prisma = { platform: { findFirst: mock().mockResolvedValue(null) } };
    const controller = new AtlasPaymentController(payments as any, prisma as any);
    await expect(controller.createPix({} as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(payments.createPaymentPix).not.toHaveBeenCalled();
  });

  test('uses the owner explicitly assigned to the platform', async () => {
    const payments = { createPaymentPix: mock().mockResolvedValue({ success: true }) };
    const prisma = { platform: { findFirst: mock().mockResolvedValue({ ownerUserId: 'assigned-owner' }) } };
    const controller = new AtlasPaymentController(payments as any, prisma as any);
    const body = {} as any;
    await controller.createPix(body);
    expect(payments.createPaymentPix).toHaveBeenCalledWith('assigned-owner', body);
  });
});
