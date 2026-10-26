import { BadRequestException, ConflictException } from '@nestjs/common';
import { DeleteLeadsUseCase } from './delete-leads.use-case';

describe('DeleteLeadsUseCase', () => {
  function build(leads: Array<{ id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }>) {
    const repository = {
      findByIds: jest.fn().mockResolvedValue(leads),
      deleteMany: jest.fn().mockResolvedValue(leads.length),
    };
    return { repository, sut: new DeleteLeadsUseCase(repository as any) };
  }

  it('deletes only finalized lead requests', async () => {
    const { sut, repository } = build([
      { id: 'approved', status: 'APPROVED' },
      { id: 'rejected', status: 'REJECTED' },
    ]);

    await expect(sut.execute({ leadIds: ['approved', 'rejected'] })).resolves.toEqual({ deleted: 2 });

    expect(repository.deleteMany).toHaveBeenCalledWith(['approved', 'rejected']);
  });

  it('refuses to delete a pending request', async () => {
    const { sut, repository } = build([{ id: 'pending', status: 'PENDING' }]);

    await expect(sut.execute({ leadIds: ['pending'] })).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.deleteMany).not.toHaveBeenCalled();
  });

  it('fails safely when a request changes status before deletion', async () => {
    const { sut } = build([
      { id: 'approved', status: 'APPROVED' },
      { id: 'rejected', status: 'REJECTED' },
    ]);
    // Simula o repositório protegendo um item que virou PENDING no DELETE.
    (sut as any).leads.deleteMany.mockResolvedValue(1);

    await expect(sut.execute({ leadIds: ['approved', 'rejected'] })).rejects.toBeInstanceOf(ConflictException);
  });
});
