import { ManagePaymentLinkFilesUseCase } from './manage-payment-link-files.use-case';
jest.mock('../../../infrastructure/storage/storage.service', () => ({
  StorageService: class {},
}));

describe('product assets respect authenticated administrative delegation', () => {
  it.each(['ADMIN', 'USER'])(
    '%s upload scope is checked server-side',
    async (role) => {
      const findFirst = jest.fn(async ({ where }) =>
        where.userId === 'actor' ? null : { id: 'link' },
      );
      const prisma = {
        user: { findUnique: async () => ({ role, isActive: true }) },
        paymentLink: { findFirst },
        paymentLinkFile: { create: jest.fn() },
      };
      const storage = { uploadFile: jest.fn() };
      const uc = new ManagePaymentLinkFilesUseCase(
        prisma as any,
        storage as any,
      );
      if (role === 'ADMIN')
        await expect(
          uc.uploadFiles({ userId: 'actor', linkId: 'link', files: [] }),
        ).resolves.toEqual({ files: [] });
      else
        await expect(
          uc.uploadFiles({ userId: 'actor', linkId: 'link', files: [] }),
        ).rejects.toThrow('não encontrado');
      expect(findFirst.mock.calls[0][0].where).toEqual(
        role === 'ADMIN' ? { id: 'link' } : { id: 'link', userId: 'actor' },
      );
    },
  );
});
