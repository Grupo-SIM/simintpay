import { describe, expect, mock, test } from 'bun:test';
import { GoneException } from '@nestjs/common';
import { ScanPlatformOwnersUseCase } from './scan-platform-owners.use-case';

describe('ScanPlatformOwnersUseCase', () => {
  test('rejects automatic discovery without querying gateways or creating accounts', async () => {
    const useCase = new ScanPlatformOwnersUseCase();
    await expect(useCase.execute()).rejects.toBeInstanceOf(GoneException);
  });
});
