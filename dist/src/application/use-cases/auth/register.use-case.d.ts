import { AuthResponseDto } from '../../dtos/auth/auth-response.dto';
import { RegisterDto } from '../../dtos/auth/register.dto';
import { AuthTokensService } from './auth-tokens.service';
import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IHashService } from '../../../core/services/hash.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
export declare class RegisterUseCase {
    private readonly users;
    private readonly sessions;
    private readonly wallets;
    private readonly hash;
    private readonly gateway;
    private readonly tokens;
    constructor(users: IUserRepository, sessions: ISessionRepository, wallets: IWalletRepository, hash: IHashService, gateway: IPaymentGateway, tokens: AuthTokensService);
    execute(input: {
        dto: RegisterDto;
        userAgent?: string | null;
        ipAddress?: string | null;
    }): Promise<AuthResponseDto>;
}
