import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export type PlanTipoDto = 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

export class CreatePlanDto {
  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsNumber()
  preco!: number;

  @IsEnum(['MENSAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'])
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
  emailBody?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  plataformas?: string[];
}
