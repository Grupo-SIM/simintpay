import { IsObject } from 'class-validator';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateBoletoDto {
  @IsOptional()
  @IsObject()
  coproduction?: unknown;

  @IsString()
  @IsNotEmpty()
  titulo!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  valor!: number;

  /** Dias até o vencimento do boleto (boletoExpireDay na DOM). */
  @IsInt()
  @Min(0)
  @Max(90)
  @IsOptional()
  /** Zero representa ausência de vencimento configurado. */
  vencimentoDias?: number;

  @IsString()
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @IsOptional()
  webhookUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsDateString()
  @IsOptional()
  dataExpiracao?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  plataformas?: string[];
}
