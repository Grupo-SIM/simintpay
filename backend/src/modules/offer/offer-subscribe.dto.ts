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
 * Card of a recurring checkout. Two shapes:
 * - `customer-token` (default): browser-made DOM token bound to `customerId`, plus display
 *   metadata (`last4`, expiry, brand, bin, holder_name). `number`/`cvv` are rejected.
 * - `subscription` / `card-token` (legacy): full card, used in memory for the single acquirer
 *   call and never stored or logged.
 * Only brand, last4 and expiry reach the card vault.
 */
export class OfferSubscribeCardDto {
  @ApiPropertyOptional({
    description:
      'customer-token: token do SDK gerado com o customer_id (reutilizável). Demais fontes: token de uso único',
  })
  @IsOptional()
  @IsString()
  token?: string;

  @ApiPropertyOptional({ description: 'Somente fontes legadas' })
  @IsOptional()
  @IsString()
  number?: string;
  @ApiPropertyOptional({ description: 'Somente fontes legadas' })
  @IsOptional()
  @IsString()
  cvv?: string;
  @ApiProperty() @IsString() exp_month!: string;
  @ApiProperty() @IsString() exp_year!: string;
  @ApiProperty() @IsString() holder_name!: string;
  @ApiPropertyOptional({ description: 'Somente fontes legadas' })
  @IsOptional()
  @IsString()
  holder_document?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bin?: string;
  @ApiPropertyOptional({ description: 'customer-token: 4 últimos dígitos' })
  @IsOptional()
  @IsString()
  last4?: string;
  @ApiPropertyOptional({
    description: 'customer-token: customerId devolvido por card-customer',
  })
  @IsOptional()
  @IsString()
  customerId?: string;
}

/** Cliente do adquirente para tokenizar o cartão já vinculado à carteira dele. */
export class OfferCardCustomerDto {
  @ApiProperty() @IsString() @MinLength(1) customerName!: string;
  @ApiProperty() @IsEmail() customerEmail!: string;
  @ApiProperty() @IsString() @MinLength(1) customerDocument!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPhone?: string;
}

/** Contratação pública de uma oferta recorrente (AUTO_CHARGE: cartão; MANUAL_PAY: PIX). */
export class OfferSubscribeDto {
  @ApiProperty({
    enum: ['pix', 'credit_card'],
    description:
      'boleto é recusado com uma mensagem clara (recorrência não o suporta)',
  })
  @IsIn(['pix', 'credit_card', 'boleto'])
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
