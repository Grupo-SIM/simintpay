import {
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

  @IsUrl()
  @IsOptional()
  webhookUrl?: string;

  @IsUrl()
  @IsOptional()
  redirectUrl?: string;
}
