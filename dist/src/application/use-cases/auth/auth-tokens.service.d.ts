import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
export declare class AuthTokensService {
    private readonly jwt;
    constructor(jwt: JwtService);
    signAccessToken(payload: {
        sub: string;
        email: string;
        role: Role;
    }): Promise<{
        token: string;
        expiresIn: number;
    }>;
}
