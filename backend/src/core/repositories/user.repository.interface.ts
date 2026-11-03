import { ClientStatus, Role, User } from '@prisma/client';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export type CreateUserData = {
  name: string;
  email: string;
  password: string;
  phone?: string | null;
  role?: Role;
  isActive?: boolean;
  domUserId?: string | null;
  domToken?: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  platformId?: string | null;
  clientStatus?: ClientStatus | null;
  clientApprovedAt?: Date | null;
};

export interface IUserRepository {
  findById(id: string): Promise<any | null>;
  findByEmail(email: string): Promise<User | null>;
  hasIdentityConflict(
    email: string,
    cpf: string,
    cnpj: string,
  ): Promise<boolean>;
  create(data: CreateUserData): Promise<User>;
  updateProfile(
    id: string,
    data: { name?: string; email?: string },
  ): Promise<User>;
  updateDomData(
    id: string,
    data: { domUserId?: string | null; domToken?: string | null },
  ): Promise<User>;
  updatePassword(id: string, hashedPassword: string): Promise<void>;
  findByAffiliateCode(code: string): Promise<User | null>;
  setReferredBy(userId: string, referredByUserId: string | null): Promise<void>;
}
