import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OFFER_TYPES, type OfferType } from '../../use-cases/payment-link/payment-link-offers.helper';

export class PaymentLinkOfferItemDto {
  /** Presente ao editar uma oferta existente */
  @IsString()
  @IsOptional()
  id?: string;

  @IsIn(OFFER_TYPES as unknown as string[])
  tipo!: OfferType;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  chamada?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  titulo!: string;

  @IsString()
  @IsOptional()
  @MaxLength(600)
  descricao?: string | null;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  imagemUrl?: string | null;

  @IsNumber()
  @Min(0.01)
  valor!: number;

  @IsNumber()
  @IsOptional()
  valorOriginal?: number | null;

  @IsBoolean()
  @IsOptional()
  ativo?: boolean;
}

export class SavePaymentLinkOffersDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => PaymentLinkOfferItemDto)
  ofertas!: PaymentLinkOfferItemDto[];
}
