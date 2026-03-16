import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { UpdateProfileDto } from '../../dtos/settings/update-profile.dto';

@Injectable()
export class UpdateProfileUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
  ) {}

  async execute(input: {
    userId: string;
    dto: UpdateProfileDto;
  }): Promise<{ data: unknown }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const updated = await this.users.updateProfile(input.userId, {
      name: input.dto.nome ?? user.name,
      email: input.dto.email ?? user.email,
    });

    return { data: { nome: updated.name, email: updated.email } };
  }
}
