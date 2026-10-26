import { BadRequestException, Body, Controller, Param, Post, Put, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';
import { ReturnBetWithdrawalService } from '../return-bet/return-bet-withdrawal.service';
import { ReturnBetWithdrawalPolicyService } from '../return-bet/return-bet-withdrawal-policy.service';
import { ReturnBetCommunityStatusService } from '../return-bet/return-bet-community-status.service';
type RequestContext = { platformContext: PlatformContext; user?: { sub: string } };

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformReturnBetController {
  constructor(private readonly modules: ModuleRef) {}
  private service<T>(request: RequestContext, token: new (...args: any[]) => T): T {
    if (request.platformContext.tag !== 'RETURN-BET') unsupportedCapability('return-bet');
    return this.modules.get(token, { strict: false });
  }
  private fields(body: Record<string, unknown>, allowed: string[]) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('Contrato inválido');
  }
  private money(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BadRequestException('Valor exige centavos inteiros');
    return new Prisma.Decimal(value).div(100).toNumber();
  }
  private withdrawal(row: Awaited<ReturnType<ReturnBetWithdrawalService['request']>>) {
    const { grossAmount, netAmount, fee, ...data } = row;
    return { ...data, unit: 'cents', grossAmountCents: new Prisma.Decimal(grossAmount).mul(100).toNumber(), netAmountCents: new Prisma.Decimal(netAmount).mul(100).toNumber(), feeCents: new Prisma.Decimal(fee).mul(100).toNumber() };
  }
  @Put('finance/withdrawal-policy') @SetMetadata('platform-operation', 'maintenance:run')
  async policy(@Req() req: RequestContext, @Body() body: Record<string, unknown>) {
    this.fields(body, ['minimumGrossAmountCents', 'fixedWithdrawalFeeCents', 'withdrawalWindowDays']);
    if (!Number.isInteger(body.withdrawalWindowDays)) throw new BadRequestException('Janela inválida');
    const result = await this.service(req, ReturnBetWithdrawalPolicyService).set({ minimumGrossAmount: this.money(body.minimumGrossAmountCents), fixedWithdrawalFee: this.money(body.fixedWithdrawalFeeCents), withdrawalWindowDays: body.withdrawalWindowDays as number });
    return { minimumGrossAmountCents: new Prisma.Decimal(result.minimumGrossAmount).mul(100).toNumber(), fixedWithdrawalFeeCents: new Prisma.Decimal(result.fixedWithdrawalFee).mul(100).toNumber(), withdrawalWindowDays: result.withdrawalWindowDays };
  }
  @Post('community/status/batch') @SetMetadata('platform-operation', 'community:read')
  async community(@Req() req: RequestContext, @Body() body: { users: { id: string; cpf?: string; email?: string }[] }) {
    this.fields(body, ['users']);
    if (!Array.isArray(body.users) || body.users.length > 500 || body.users.some(row => !row || typeof row.id !== 'string' || row.cpf !== undefined && typeof row.cpf !== 'string' || row.email !== undefined && typeof row.email !== 'string')) throw new BadRequestException('Lista inválida');
    const service = this.service(req, ReturnBetCommunityStatusService);
    return { results: await service.checkBatch(body.users) };
  }
  @Post('finance/return-bet/withdrawals') @SetMetadata('platform-operation', 'finance:withdraw')
  async request(@Req() req: RequestContext, @Body() body: Record<string, unknown>) {
    this.fields(body, ['requestId', 'externalUserId', 'name', 'email', 'document', 'availableBalanceCents', 'amountCents', 'pixKey']);
    const strings: Record<string, string> = {};
    for (const key of ['requestId', 'externalUserId', 'name', 'email', 'document', 'pixKey']) {
      if (typeof body[key] !== 'string' || !(body[key] as string).trim()) throw new BadRequestException(`${key} obrigatório`);
      strings[key] = body[key] as string;
    }
    return this.withdrawal(await this.service(req, ReturnBetWithdrawalService).request({ requestId: strings.requestId, externalUserId: strings.externalUserId, name: strings.name, email: strings.email, document: strings.document, pixKey: strings.pixKey, availableBalance: this.money(body.availableBalanceCents), amount: this.money(body.amountCents) }));
  }
  @Post('finance/return-bet/withdrawals/status/batch') @SetMetadata('platform-operation', 'finance:read')
  async status(@Req() req: RequestContext, @Body() body: { requestIds: string[] }) {
    this.fields(body, ['requestIds']);
    if (!Array.isArray(body.requestIds) || body.requestIds.length > 500 || body.requestIds.some(id => typeof id !== 'string')) throw new BadRequestException('Lista inválida');
    return { results: (await this.service(req, ReturnBetWithdrawalService).listStatus(body.requestIds)).map(row => this.withdrawal(row)) };
  }
  @Post('finance/return-bet/withdrawals/:requestId/approve') @SetMetadata('platform-operation', 'maintenance:run')
  async approve(@Req() req: RequestContext, @Param('requestId') id: string, @Body() body: { receiptImage: string }) {
    this.fields(body, ['receiptImage']);
    if (typeof body.receiptImage !== 'string') throw new BadRequestException('Contrato inválido');
    return this.withdrawal(await this.service(req, ReturnBetWithdrawalService).approve(id, body.receiptImage, { actorReference: req.user?.sub }));
  }
  @Post('finance/return-bet/withdrawals/:requestId/reject') @SetMetadata('platform-operation', 'maintenance:run')
  async reject(@Req() req: RequestContext, @Param('requestId') id: string, @Body() body: { reason: string }) {
    this.fields(body, ['reason']);
    if (typeof body.reason !== 'string') throw new BadRequestException('Contrato inválido');
    return this.withdrawal(await this.service(req, ReturnBetWithdrawalService).reject(id, body.reason, { actorReference: req.user?.sub }));
  }
}
