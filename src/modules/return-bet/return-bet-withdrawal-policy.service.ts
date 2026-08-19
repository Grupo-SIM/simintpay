import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';

const POLICY_ID = 'default';
const DEFAULT_POLICY = {
  minimumGrossAmount: 100,
  fixedWithdrawalFee: 2,
  withdrawalWindowDays: 30,
};

export interface ReturnBetWithdrawalPolicyInput {
  minimumGrossAmount: number;
  fixedWithdrawalFee: number;
  withdrawalWindowDays: number;
}

export interface ReturnBetWithdrawalPolicy extends ReturnBetWithdrawalPolicyInput {}

@Injectable()
export class ReturnBetWithdrawalPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ReturnBetWithdrawalPolicy> {
    const policy = await this.prisma.returnBetWithdrawalPolicy.upsert({
      where: { id: POLICY_ID },
      create: { id: POLICY_ID, ...DEFAULT_POLICY },
      update: {},
    });
    return this.serialize(policy);
  }

  async set(input: ReturnBetWithdrawalPolicyInput): Promise<ReturnBetWithdrawalPolicy> {
    this.validate(input);
    const policy = await this.prisma.returnBetWithdrawalPolicy.upsert({
      where: { id: POLICY_ID },
      create: { id: POLICY_ID, ...input },
      update: input,
    });
    return this.serialize(policy);
  }

  private validate(input: ReturnBetWithdrawalPolicyInput) {
    if (!Number.isFinite(input.minimumGrossAmount) || input.minimumGrossAmount < 1) {
      throw new BadRequestException('O valor mínimo deve ser de ao menos R$ 1,00.');
    }
    if (
      !Number.isFinite(input.fixedWithdrawalFee) ||
      input.fixedWithdrawalFee < 0 ||
      input.fixedWithdrawalFee >= input.minimumGrossAmount
    ) {
      throw new BadRequestException('A taxa deve ser positiva ou zero e menor que o valor mínimo.');
    }
    if (
      !Number.isInteger(input.withdrawalWindowDays) ||
      input.withdrawalWindowDays < 1 ||
      input.withdrawalWindowDays > 365
    ) {
      throw new BadRequestException('A janela de saque deve ter entre 1 e 365 dias.');
    }
  }

  private serialize(policy: {
    minimumGrossAmount: { toNumber(): number };
    fixedWithdrawalFee: { toNumber(): number };
    withdrawalWindowDays: number;
  }): ReturnBetWithdrawalPolicy {
    return {
      minimumGrossAmount: policy.minimumGrossAmount.toNumber(),
      fixedWithdrawalFee: policy.fixedWithdrawalFee.toNumber(),
      withdrawalWindowDays: policy.withdrawalWindowDays,
    };
  }
}
