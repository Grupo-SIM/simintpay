import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreatePaymentLinkDto {
  @IsString()
  @IsNotEmpty()
  titulo!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  valor!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  parcelasMax?: number;

  @IsBoolean()
  @IsOptional()
  aceitaCartao?: boolean;

  @IsBoolean()
  @IsOptional()
  aceitaPix?: boolean;

  @IsString()
  @IsOptional()
  redirectUrl?: string;
}
