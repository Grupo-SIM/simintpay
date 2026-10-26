import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import { EmailService } from '../../../infrastructure/email/email.service';

/**
 * Segredo de assinatura do token de reset: combina o JWT_SECRET com o hash atual
 * da senha do usuário. Assim que a senha é trocada o hash muda e o token vira
 * inválido automaticamente (uso único, sem precisar de tabela/coluna no banco).
 */
export function buildResetTokenSecret(passwordHash: string): string {
  return `${process.env.JWT_SECRET ?? ''}|pwreset|${passwordHash}`;
}

@Injectable()
export class ForgotPasswordUseCase {
  private readonly logger = new Logger(ForgotPasswordUseCase.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async execute(input: { email: string }): Promise<{ data: { sent: boolean } }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    // Sempre responde sucesso para não revelar se o e-mail existe.
    if (!user) return { data: { sent: true } };

    try {
      const token = await this.jwt.signAsync(
        { sub: user.id, type: 'pwreset' },
        { secret: buildResetTokenSecret(user.password), expiresIn: '1h' },
      );

      const base = (process.env.APP_URL ?? process.env.FRONTEND_URL ?? 'https://www.simintpay.com').replace(/\/+$/, '');
      const resetUrl = `${base}/redefinir-senha?token=${encodeURIComponent(token)}`;

      await this.email.sendPasswordReset({ to: user.email, name: user.name, resetUrl });
    } catch (err) {
      this.logger.error(`Falha ao processar reset de senha para ${email}: ${String(err)}`);
      // Não propaga: mantém resposta genérica de sucesso.
    }

    return { data: { sent: true } };
  }
}
