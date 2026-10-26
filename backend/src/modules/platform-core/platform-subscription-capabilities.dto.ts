import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class PlatformSubscriptionPlanDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amountCents!: number;
  @IsEnum(['SEMANAL', 'MENSAL', 'ANUAL']) frequency!: 'SEMANAL' | 'MENSAL' | 'ANUAL';
  @IsOptional() @IsString() description?: string;
}

/** Existing provider plan mirror; this operation never creates a remote subscription. */
export class PlatformPlanImportDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amountCents!: number;
  @IsEnum(['MONTHLY', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']) type!: 'MONTHLY' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
  @IsOptional() @IsString() externalPlanId?: string;
  @IsOptional() @IsUrl() redirectUrl?: string;
  @IsOptional() @IsUrl() webhookUrl?: string;
  @IsOptional() @IsEnum(['PIX', 'CREDIT_CARD', 'BOTH']) paymentMethods?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
