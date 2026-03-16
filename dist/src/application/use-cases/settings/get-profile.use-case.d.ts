import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
export declare class GetProfileUseCase {
    private readonly users;
    constructor(users: IUserRepository);
    execute(input: {
        userId: string;
    }): Promise<{
        data: unknown;
    }>;
}
