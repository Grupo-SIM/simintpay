import { IsObject } from 'class-validator';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export type PlanTipoDto = 'SEMANAL' | 'MENSAL' | 'ANUAL';

export class CreatePlanDto {
  /** Explicit beneficiary; platform selection must agree with its registered owner. */
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsObject()
  coproduction?: unknown;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  preco!: number;

  @IsEnum(['SEMANAL', 'MENSAL', 'ANUAL'])
  tipo!: PlanTipoDto;

  @IsInt()
  @Min(1)
  @IsOptional()
  frequencia?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  repeticoes?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  diasRetentativa?: number;

  @IsUrl()
  @IsOptional()
  webhookUrl?: string;

  @IsUrl()
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  emailBody?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  plataformas?: string[];
}
