import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export type PlanTipoDto = 'SEMANAL' | 'MENSAL' | 'ANUAL';

export class CreatePlanDto {
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

  @IsNumber()
  @IsOptional()
  frequencia?: number;

  @IsNumber()
  @IsOptional()
  repeticoes?: number;

  @IsNumber()
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
