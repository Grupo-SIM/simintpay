import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import type { ChangePasswordDto } from '../../dtos/settings/change-password.dto';

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
  ) {}

  async execute(input: {
    userId: string;
    dto: ChangePasswordDto;
  }): Promise<{ data: { updated: boolean } }> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundException('Usuário não encontrado');

    const valid = await this.hash.compare(
      input.dto.currentPassword,
      user.password,
    );
    if (!valid) throw new BadRequestException('Senha atual incorreta');

    const hashed = await this.hash.hash(input.dto.newPassword);
    await this.users.updatePassword(input.userId, hashed);

    return { data: { updated: true } };
  }
}
