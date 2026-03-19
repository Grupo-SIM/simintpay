import type { IUserRepository } from '../../../core/repositories/user.repository.interface';
import type { IWalletRepository } from '../../../core/repositories/wallet.repository.interface';
import type { IPaymentGateway } from '../../../core/services/payment-gateway.interface';
export declare class GetMeUseCase {
    private readonly users;
    private readonly wallets;
    private readonly gateway;
    constructor(users: IUserRepository, wallets: IWalletRepository, gateway: IPaymentGateway);
    execute(input: {
        userId: string;
    }): Promise<{
        id: string;
        name: string;
        email: string;
        role: string;
        isAdmin: boolean;
        wallet: {
            balance: number;
            lockedBalance: number;
            availableBalance: number;
            netBalance: number;
        };
        createdAt: string;
    }>;
}
