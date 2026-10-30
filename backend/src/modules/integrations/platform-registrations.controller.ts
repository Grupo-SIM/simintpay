import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Put,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { ProvisionDeliveryOwnerService } from './provision-delivery-owner.service';
import { ProvisionDeliveryOwnerDto } from './provision-delivery-owner.dto';
import { ensureDeliveryOwnerPlatform } from './delivery-owner-platform';
import { reserveDeliveryPlatform } from './delivery-platform-registration';
import {
  assertDeliveryProvisioningToken,
  deliveryAccessResult,
  ensureDeliveryAccess,
} from './delivery-canonical-access';
import { PlatformPaymentLookup } from '../unified-platform/payments/platform-payment-lookup';
import { readDeliveryFees, saveDeliveryFees } from './delivery-fee-settings';
import { platformMerchant } from '../platform-core/platform-merchant-lookup';

class CompatibilityDto {
  @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) references!: string[];
}
class FeeLaneDto {
  @IsIn(['PIX', 'DEBIT_CARD', 'CREDIT_CARD']) method!:
    | 'PIX'
    | 'DEBIT_CARD'
    | 'CREDIT_CARD';
  @IsIn(['ONLINE']) channel!: 'ONLINE';
  @IsInt() @Min(1) @Max(12) installments!: number;
  @IsInt() @Min(0) @Max(1_000_000_000) fixedCents!: number;
  @IsInt() @Min(0) @Max(1_000_000) ratePpm!: number;
}
class FeesDto {
  @IsString() version!: string;
  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => FeeLaneDto)
  lanes!: FeeLaneDto[];
}
class RegistrationDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsString() @MinLength(1) legalName!: string;
}
class RegistrationOwnerDto extends ProvisionDeliveryOwnerDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
}
@Controller('platform-registrations')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class PlatformRegistrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly owners: ProvisionDeliveryOwnerService,
  ) {}
  @Put(':companyId')
  @Header('Cache-Control', 'no-store')
  async reserve(
    @Param('companyId') companyId: string,
    @Body() body: RegistrationDto,
    @Headers('x-provisioning-token') token?: string,
  ) {
    assertDeliveryProvisioningToken(token);
    return this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.deliveryPlatformRegistration.findUnique({
          where: { externalMerchantId: companyId },
        });
        const registration = await reserveDeliveryPlatform(
          tx,
          previous?.platformId
            ? previous.integrationKey
            : `sim-delivery_${body.slug}`,
          companyId,
          body.legalName,
        );
        let platformId = registration.platformId;
        if (!platformId) {
          let saved = await tx.integrationMerchant.findUnique({
            where: {
              integrationKey_externalMerchantId: {
                integrationKey: registration.integrationKey,
                externalMerchantId: companyId,
              },
            },
            include: { user: true },
          });
          if (!saved) {
            const candidates = await tx.integrationMerchant.findMany({
              where: {
                externalMerchantId: companyId,
                integrationKey: { startsWith: 'sim-delivery_' },
              },
              include: { user: true },
            });
            if (candidates.length > 1)
              throw new ConflictException(
                'Múltiplos comerciantes históricos; exige revisão administrativa',
              );
            saved = candidates[0] ?? null;
          }
          if (!saved) return { id: registration.id, status: 'PENDING_OWNER' };
          if (!saved.user.isActive || saved.user.isPurged)
            throw new BadRequestException('Comerciante inativo');
          platformId = (
            await ensureDeliveryOwnerPlatform(
              tx,
              saved.integrationKey,
              companyId,
              saved.userId,
              body.legalName,
            )
          ).id;
        }
        const platform = await tx.platform.findUniqueOrThrow({
          where: { id: platformId },
          include: { owner: true },
        });
        if (
          !platform.isActive ||
          !platform.owner.isActive ||
          platform.owner.isPurged
        )
          throw new BadRequestException('Plataforma ou dono inativo');
        const merchant = await platformMerchant(
          tx as unknown as PrismaService,
          platform,
          companyId,
        );
        const access = await ensureDeliveryAccess(tx, platform.id, merchant);
        return {
          id: platform.id,
          status: 'READY',
          ...deliveryAccessResult(access, platform, merchant),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  @Get(':companyId/fees')
  @Header('Cache-Control', 'no-store')
  async fees(
    @Param('companyId') companyId: string,
    @Headers('x-provisioning-token') token?: string,
  ) {
    assertDeliveryProvisioningToken(token);
    return this.prisma.$transaction((tx) => readDeliveryFees(tx, companyId));
  }
  @Put(':companyId/fees')
  @Header('Cache-Control', 'no-store')
  async saveFees(
    @Param('companyId') companyId: string,
    @Body() body: FeesDto,
    @Headers('x-provisioning-token') token?: string,
  ) {
    assertDeliveryProvisioningToken(token);
    return this.prisma.$transaction(
      (tx) => saveDeliveryFees(tx, companyId, body),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  @Post(':companyId/compatibility')
  @Header('Cache-Control', 'no-store')
  async compatibility(
    @Param('companyId') companyId: string,
    @Body() body: CompatibilityDto,
    @Headers('x-provisioning-token') token?: string,
  ) {
    assertDeliveryProvisioningToken(token);
    const registration =
      await this.prisma.deliveryPlatformRegistration.findUnique({
        where: { externalMerchantId: companyId },
      });
    if (!registration?.platformId)
      return { compatible: false, conflicts: body.references };
    const platform = await this.prisma.platform.findUniqueOrThrow({
      where: { id: registration.platformId },
      include: { owner: true },
    });
    if (
      !platform.isActive ||
      !platform.owner.isActive ||
      platform.owner.isPurged
    )
      throw new BadRequestException('Plataforma ou dono inativo');
    const merchant = await platformMerchant(this.prisma, platform, companyId);
    const conflicts: string[] = [];
    for (const reference of [...new Set(body.references)]) {
      if (
        !(await new PlatformPaymentLookup(this.prisma).find(
          platform,
          reference,
          merchant.userId,
        ))
      )
        conflicts.push(reference);
    }
    return { compatible: conflicts.length === 0, conflicts };
  }
  @Put(':companyId/owner')
  @Header('Cache-Control', 'no-store')
  async owner(
    @Param('companyId') companyId: string,
    @Body() body: RegistrationOwnerDto,
    @Headers('x-provisioning-token') token?: string,
  ) {
    assertDeliveryProvisioningToken(token);
    await this.reserve(companyId, body, token);
    const registration =
      await this.prisma.deliveryPlatformRegistration.findUniqueOrThrow({
        where: { externalMerchantId: companyId },
      });
    return this.owners.execute(
      registration.integrationKey,
      companyId,
      body,
      true,
    );
  }
}
