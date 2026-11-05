import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Raw card of a recurring checkout. It is used in memory for the single acquirer call and
 * is never stored or logged; only brand, last4 and expiry reach the card vault.
 */
export class OfferSubscribeCardDto {
  @ApiPropertyOptional({ description: 'Token de uso único do frontend' })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiProperty() @IsString() number!: string;
  @ApiProperty() @IsString() cvv!: string;
  @ApiProperty() @IsString() exp_month!: string;
  @ApiProperty() @IsString() exp_year!: string;
  @ApiProperty() @IsString() holder_name!: string;
  @ApiProperty() @IsString() holder_document!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bin?: string;
}

/** Contratação pública de uma oferta recorrente (AUTO_CHARGE: cartão; MANUAL_PAY: PIX). */
export class OfferSubscribeDto {
  @ApiProperty({ enum: ['pix', 'credit_card'] })
  @IsIn(['pix', 'credit_card'])
  paymentMethod!: 'pix' | 'credit_card';

  @ApiProperty() @IsString() @MinLength(1) customerName!: string;
  @ApiProperty() @IsEmail() customerEmail!: string;
  @ApiProperty() @IsString() @MinLength(1) customerDocument!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'] })
  @IsOptional()
  @IsIn(['CPF', 'CNPJ'])
  documentType?: 'CPF' | 'CNPJ';

  @ApiPropertyOptional({ type: OfferSubscribeCardDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferSubscribeCardDto)
  card?: OfferSubscribeCardDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  tracking?: Record<string, string>;
}
