import type { Role } from '@prisma/client';
export declare class AuthResponseUserDto {
    id: string;
    name: string;
    email: string;
    role: Role;
}
export declare class AuthResponseDto {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: AuthResponseUserDto;
}
