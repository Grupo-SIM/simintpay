import { Role, User } from '@prisma/client';
export declare const USER_REPOSITORY: unique symbol;
export type CreateUserData = {
    name: string;
    email: string;
    password: string;
    role?: Role;
    isActive?: boolean;
    domUserId?: string | null;
    domToken?: string | null;
};
export interface IUserRepository {
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
}
