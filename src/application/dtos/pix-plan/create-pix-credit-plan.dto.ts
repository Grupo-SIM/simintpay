import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePixCreditPlanDto {
  @ApiProperty({ description: 'Valor do plano (reais)' })
  @IsNotEmpty()
  price: number;

  @ApiProperty({ description: 'Descrição do plano' })
  @IsNotEmpty()
  description: string;

  @ApiPropertyOptional({ description: 'URL de redirecionamento' })
  @IsOptional()
  @IsString()
  redirectUrl?: string;

  @ApiPropertyOptional({ description: 'URL de webhook' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({ enum: ['MONTH', 'QUARTER', 'SEMESTER', 'YEAR'] })
  @IsOptional()
  @IsIn(['MONTH', 'QUARTER', 'SEMESTER', 'YEAR'])
  frequency_type?: 'MONTH' | 'QUARTER' | 'SEMESTER' | 'YEAR';

  @ApiPropertyOptional({ description: 'Tag da plataforma vinculada (ex: PAGATG, RENOVADA)' })
  @IsOptional()
  @IsString()
  tenantTag?: string;

  @ApiPropertyOptional({ description: 'Corpo de e-mail personalizado enviado ao comprador (apenas itens de ebook)' })
  @IsOptional()
  @IsString()
  emailBody?: string;
}
