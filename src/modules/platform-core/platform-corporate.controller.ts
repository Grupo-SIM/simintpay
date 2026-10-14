import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, SetMetadata, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AtlasMailService } from '../atlas/services/atlas-mail.service';
import { SendVmAccessDto } from '../atlas/dtos/send-vm-access.dto';
import { ReturnBetCommunityStatusService } from '../return-bet/return-bet-community-status.service';
import { ReturnBetWithdrawalPolicyService } from '../return-bet/return-bet-withdrawal-policy.service';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { unsupportedCapability } from './platform-adapters';

@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformCorporateController {
  constructor(private readonly modules: ModuleRef, private readonly prisma: PrismaService) {}
  @Put('return-bet/accounts/:externalUserId') @SetMetadata('platform-operation', 'maintenance:run')
  async associateAccount(@Req() request: { platformContext: PlatformContext }, @Param('externalUserId') externalUserId: string, @Body() body: { userId: string }) {
    if (request.platformContext.tag !== 'RETURN-BET') unsupportedCapability('return-bet.account-binding');
    if (!externalUserId.trim() || typeof body?.userId !== 'string') throw new BadRequestException('Usuário e referência obrigatórios');
    const user = await this.prisma.user.findUnique({ where: { id: body.userId } });
    if (!user?.isActive || user.isPurged || !user.cpf && !user.cnpj) throw new BadRequestException('Conta ativa com documento obrigatório');
    const account = await this.prisma.returnBetAccount.upsert({ where: { externalUserId }, create: { externalUserId, userId: user.id, name: user.name, email: user.email, document: user.cpf ?? user.cnpj! }, update: { userId: user.id, name: user.name, email: user.email, document: user.cpf ?? user.cnpj! } });
    return { id: account.id, externalUserId: account.externalUserId, userId: account.userId };
  }
  @Post('mail/vm-access') @SetMetadata('platform-operation', 'mail:send')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async vmAccess(@Req() request: { platformContext: PlatformContext }, @Body() body: SendVmAccessDto) {
    if (request.platformContext.tag !== 'ATLAS') unsupportedCapability('mail.vm-access');
    await this.modules.get(AtlasMailService, { strict: false }).sendVmAccess({ to: body.email, vmIp: body.vmIp, vmPassword: body.vmPassword });
    return { success: true };
  }
  @Get('community/status') @SetMetadata('platform-operation', 'community:read')
  community(@Req() request: { platformContext: PlatformContext }, @Query('cpf') cpf?: string, @Query('email') email?: string) {
    if (request.platformContext.tag !== 'RETURN-BET') unsupportedCapability('community.status');
    return this.modules.get(ReturnBetCommunityStatusService, { strict: false }).checkOne({ cpf, email });
  }
  @Get('finance/withdrawal-policy') @SetMetadata('platform-operation', 'finance:read')
  async policy(@Req() request: { platformContext: PlatformContext }) {
    if (request.platformContext.tag !== 'RETURN-BET') unsupportedCapability('withdrawal-policy');
    const policy = await this.modules.get(ReturnBetWithdrawalPolicyService, { strict: false }).get();
    return { minimumGrossAmountCents: Math.round(policy.minimumGrossAmount * 100), fixedWithdrawalFeeCents: Math.round(policy.fixedWithdrawalFee * 100), withdrawalWindowDays: policy.withdrawalWindowDays };
  }
}
