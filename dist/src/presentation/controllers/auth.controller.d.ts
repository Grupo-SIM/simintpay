import type { Request, Response } from 'express';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { RegisterDto } from '../../application/dtos/auth/register.dto';
import { RefreshTokenDto } from '../../application/dtos/auth/refresh-token.dto';
import { LogoutDto } from '../../application/dtos/auth/logout.dto';
import { LoginUseCase } from '../../application/use-cases/auth/login.use-case';
import { RegisterUseCase } from '../../application/use-cases/auth/register.use-case';
import { RefreshTokenUseCase } from '../../application/use-cases/auth/refresh-token.use-case';
import { LogoutUseCase } from '../../application/use-cases/auth/logout.use-case';
import { GetMeUseCase } from '../../application/use-cases/auth/get-me.use-case';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
export declare class AuthController {
    private readonly login;
    private readonly register;
    private readonly refresh;
    private readonly logout;
    private readonly me;
    constructor(login: LoginUseCase, register: RegisterUseCase, refresh: RefreshTokenUseCase, logout: LogoutUseCase, me: GetMeUseCase);
    loginRoute(dto: LoginDto, req: Request, res: Response): Promise<{
        data: unknown;
    }>;
    registerRoute(dto: RegisterDto, req: Request, res: Response): Promise<{
        data: unknown;
    }>;
    refreshRoute(dto: RefreshTokenDto, res: Response): Promise<{
        data: unknown;
    }>;
    logoutRoute(dto: LogoutDto): Promise<void>;
    meRoute(user: JwtPayload | undefined): Promise<{
        data: unknown;
    }>;
}
