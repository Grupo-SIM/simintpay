import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PlatformPaymentCustomerDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(11) @MaxLength(20) document!: string;
  @IsIn(['CPF', 'CNPJ']) documentType!: 'CPF' | 'CNPJ';
  @IsOptional() @IsString() phone?: string;
}

export class CreatePlatformPaymentDto {
  @IsInt() @Min(1) @Max(999999999999) amountCents!: number;
  @IsIn(['PIX']) paymentMethod!: 'PIX';
  @IsString() @MinLength(1) @MaxLength(128) idempotencyKey!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ValidateNested() @Type(() => PlatformPaymentCustomerDto) customer!: PlatformPaymentCustomerDto;
}
