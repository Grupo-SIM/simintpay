import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import { buildResetTokenSecret } from './forgot-password.use-case';

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
    private readonly jwt: JwtService,
  ) {}

  async execute(input: { token: string; newPassword: string }): Promise<{ data: { updated: boolean } }> {
    const invalid = () =>
      new BadRequestException('Link de redefinição inválido ou expirado. Solicite um novo.');

    // 1. Lê o payload sem verificar para descobrir o usuário.
    const decoded = this.jwt.decode(input.token) as { sub?: string; type?: string } | null;
    if (!decoded?.sub || decoded.type !== 'pwreset') throw invalid();

    const user = await this.users.findById(decoded.sub);
    if (!user) throw invalid();

    // 2. Verifica a assinatura usando o hash ATUAL da senha. Se a senha já foi
    //    trocada (token já usado), a verificação falha → token inválido.
    try {
      await this.jwt.verifyAsync(input.token, { secret: buildResetTokenSecret(user.password) });
    } catch {
      throw invalid();
    }

    const hashed = await this.hash.hash(input.newPassword);
    await this.users.updatePassword(user.id, hashed);

    return { data: { updated: true } };
  }
}
