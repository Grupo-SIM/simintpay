import { Session } from '@prisma/client';
export declare const SESSION_REPOSITORY: unique symbol;
export type CreateSessionData = {
    userId: string;
    refreshToken: string;
    userAgent?: string | null;
    ipAddress?: string | null;
    expiresAt: Date;
};
export interface ISessionRepository {
    findByRefreshToken(refreshToken: string): Promise<Session | null>;
    create(data: CreateSessionData): Promise<Session>;
    deleteById(id: string): Promise<void>;
    deleteByRefreshToken(refreshToken: string): Promise<void>;
}
