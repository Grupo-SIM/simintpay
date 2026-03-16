import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { UpdateProfileDto } from '../../dtos/settings/update-profile.dto';
export declare class UpdateProfileUseCase {
    private readonly users;
    constructor(users: IUserRepository);
    execute(input: {
        userId: string;
        dto: UpdateProfileDto;
    }): Promise<{
        data: unknown;
    }>;
}
