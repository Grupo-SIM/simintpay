import type { ISessionRepository } from '../../../core/repositories/session.repository.interface';
export declare class LogoutUseCase {
    private readonly sessions;
    constructor(sessions: ISessionRepository);
    execute(input: {
        refreshToken: string;
    }): Promise<void>;
}
