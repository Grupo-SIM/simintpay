import { IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PlatformPaymentCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(11) @MaxLength(20) document!: string;
  @IsIn(['CPF', 'CNPJ']) documentType!: 'CPF' | 'CNPJ';
  @IsOptional() @IsString() phone?: string;
}

export class PlatformPaymentCardDto {
  @IsString() @MinLength(1) @MaxLength(4096) token!: string;
  @IsString() @MinLength(2) @MaxLength(200) holderName!: string;
  @IsString() @MinLength(6) @MaxLength(8) bin!: string;
  @IsString() @MinLength(1) @MaxLength(40) brand!: string;
  @IsInt() @Min(1) @Max(12) installments!: number;
}

export class PlatformPaymentAllocationDto {
  @IsInt() @Min(0) merchantAmountCents!: number;
  @IsInt() @Min(0) platformFeeCents!: number;
}
export class CreatePlatformPaymentDto {
  @IsOptional() @ValidateNested() @Type(() => PlatformPaymentAllocationDto) allocation?: PlatformPaymentAllocationDto;
  @IsOptional() @IsString() @MaxLength(128) linkId?: string;
  @IsInt() @Min(1) @Max(999999999999) amountCents!: number;
  @IsIn(['PIX', 'CREDIT_CARD']) paymentMethod!: 'PIX' | 'CREDIT_CARD';
  @IsString() @MinLength(1) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsDefined() @ValidateNested() @Type(() => PlatformPaymentCustomerDto) customer!: PlatformPaymentCustomerDto;
  @ValidateIf(value => value.paymentMethod === 'CREDIT_CARD') @IsDefined() @ValidateNested() @Type(() => PlatformPaymentCardDto) card?: PlatformPaymentCardDto;
}
