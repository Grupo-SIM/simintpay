import { AuthTokensService } from './auth-tokens.service';
import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
export declare class RefreshTokenUseCase {
    private readonly sessions;
    private readonly users;
    private readonly tokens;
    constructor(sessions: ISessionRepository, users: IUserRepository, tokens: AuthTokensService);
    execute(input: {
        refreshToken: string;
    }): Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
    }>;
}
