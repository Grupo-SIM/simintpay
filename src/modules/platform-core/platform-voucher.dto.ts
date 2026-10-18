import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

export class PlatformVoucherDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsEnum(['PERCENTAGE', 'FIXED']) discountType!: 'PERCENTAGE' | 'FIXED';
  @ValidateIf(value => value.discountType === 'PERCENTAGE') @IsNumber() @Min(0) @Max(1) discountRate?: number;
  @ValidateIf(value => value.discountType === 'FIXED') @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) discountAmountCents?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) maxUsage?: number;
}

export class PlatformVoucherValidationDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) amountCents!: number;
}

export class PlatformVoucherUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() code?: string;
  @IsOptional() @IsEnum(['PERCENTAGE', 'FIXED']) discountType?: 'PERCENTAGE' | 'FIXED';
  @IsOptional() @IsNumber() @Min(0) @Max(1) discountRate?: number;
  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) discountAmountCents?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) maxUsage?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
