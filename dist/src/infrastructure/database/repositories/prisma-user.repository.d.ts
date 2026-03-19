import { User } from '@prisma/client';
import { CreateUserData, IUserRepository } from '../../../core/repositories/user.repository.interface';
import { PrismaService } from '../prisma/prisma.service';
export declare class PrismaUserRepository implements IUserRepository {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    create(data: CreateUserData): Promise<User>;
    updateProfile(id: string, data: {
        name?: string;
        email?: string;
    }): Promise<User>;
    updateDomData(id: string, data: {
        domUserId?: string | null;
        domToken?: string | null;
    }): Promise<User>;
    updatePassword(id: string, hashedPassword: string): Promise<void>;
}
