import { Session } from '@prisma/client';
import { CreateSessionData, ISessionRepository } from '../../../core/repositories/session.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaSessionRepository implements ISessionRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findByRefreshToken(refreshToken: string): Promise<Session | null>;
    create(data: CreateSessionData): Promise<Session>;
    deleteById(id: string): Promise<void>;
    deleteByRefreshToken(refreshToken: string): Promise<void>;
}
