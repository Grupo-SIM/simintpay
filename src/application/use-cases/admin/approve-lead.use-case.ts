import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LEAD_REPOSITORY } from '../../../core/repositories/lead.repository.interface';
import { USER_REPOSITORY } from '../../../core/repositories/user.repository.interface';
import { WALLET_REPOSITORY } from '../../../core/repositories/wallet.repository.interface';
import { HASH_SERVICE } from '../../../core/services/hash.interface';
import { PAYMENT_GATEWAY } from '../../../core/services/payment-gateway.interface';
import type { ILeadRepository } from '../../../core/repositories/lead.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
import { EmailService } from '../../../infrastructure/email/email.service';
import { LinkExternalPlatformUserService } from '../../services/link-external-platform-user.service';

@Injectable()
export class ApproveLeadUseCase {
  private readonly logger = new Logger(ApproveLeadUseCase.name);

  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: ILeadRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository,
    @Inject(HASH_SERVICE) private readonly hash: IHashService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: IPaymentGateway,
    private readonly email: EmailService,
    private readonly linkExternal: LinkExternalPlatformUserService,
  ) {}

  async execute(input: { leadId: string; adminUserId: string }) {
    const lead = await this.leads.findById(input.leadId);
    if (!lead) throw new NotFoundException('Lead não encontrado');
    if (lead.status !== 'PENDING')
      throw new ConflictException('Lead não está pendente');

    const existing = await this.users.findByEmail(lead.email);
    if (existing)
      throw new ConflictException('Já existe um usuário com este e-mail');

    // Generate a secure temporary password
    const tempPassword = randomBytes(12).toString('base64').slice(0, 16);
    const hashed = await this.hash.hash(tempPassword);

    // Create local user record (with CPF from lead for transaction filtering)
    const user = await this.users.create({
      name: lead.name,
      email: lead.email,
      password: hashed,
      cpf: lead.cpf ?? null,
    });

    await this.wallets.createForUser(user.id);

    // Register user in Dom Pagamentos and save credentials
    try {
      const domReg = await this.gateway.register({
        name: lead.name,
        email: lead.email,
        password: tempPassword,
      });

      const domTok = await this.gateway.generateToken(
        lead.email,
        tempPassword,
      );

      await this.users.updateDomData(user.id, {
        domUserId: domReg.domUserId ?? null,
        domToken: domTok.domToken,
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao registrar usuário ${lead.email} na Dom: ${String(err)}. ` +
          'Usuário criado localmente, Dom pode ser associada depois.',
      );
    }

    await this.leads.approve(input.leadId, user.id);

    // Vincula ExternalPlatformUser pelo documento identificador do lead
    if (lead.cpf) {
      await this.linkExternal.linkByCpf(user.id, lead.cpf);
    } else if ((lead as any).cnpj) {
      await this.linkExternal.linkByCnpj(user.id, (lead as any).cnpj);
    }

    // Send welcome email (non-blocking — failure doesn't roll back)
    const loginUrl = process.env.APP_URL
      ? `${process.env.APP_URL}/login`
      : 'http://localhost:3000/login';

    await this.email.sendWelcome({
      to: lead.email,
      name: lead.name,
      tempPassword,
      loginUrl,
    });

    return { userId: user.id };
  }
}
