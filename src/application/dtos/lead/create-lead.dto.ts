import { IsString, IsEmail, IsOptional, IsEnum, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDocument } from '../../validators/is-document.validator';

export enum Faturamento {
  ATE_10K = 'ATE_10K',
  DE_10K_A_50K = 'DE_10K_A_50K',
  DE_50K_A_100K = 'DE_50K_A_100K',
  DE_100K_A_500K = 'DE_100K_A_500K',
  ACIMA_500K = 'ACIMA_500K',
}

export enum TempoOperacao {
  MENOS_1_ANO = 'MENOS_1_ANO',
  DE_1_A_3_ANOS = 'DE_1_A_3_ANOS',
  DE_3_A_5_ANOS = 'DE_3_A_5_ANOS',
  MAIS_5_ANOS = 'MAIS_5_ANOS',
}

export enum ModeloOperacao {
  ECOMMERCE = 'ECOMMERCE',
  PRESENCIAL = 'PRESENCIAL',
  AMBOS = 'AMBOS',
  SERVICOS = 'SERVICOS',
  ASSINATURAS = 'ASSINATURAS',
}

export enum CargoEmpresa {
  SOCIO = 'SOCIO',
  DIRETOR = 'DIRETOR',
  GERENTE = 'GERENTE',
  FINANCEIRO = 'FINANCEIRO',
  TI = 'TI',
  OUTRO = 'OUTRO',
}

export class CreateLeadDto {
  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '(11) 99999-9999' })
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'joao@empresa.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'Empresa LTDA' })
  @IsString()
  @IsNotEmpty()
  razaoSocial: string;

  @ApiProperty({ example: '12.345.678/0001-90' })
  @IsString()
  @Matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ inválido' })
  cnpj: string;

  @ApiProperty({ example: '123.456.789-09 ou 12.345.678/0001-90' })
  @IsString()
  @IsNotEmpty()
  @IsDocument({ message: 'CPF ou CNPJ inválido' })
  cpf: string;

  @ApiProperty({ enum: Faturamento, example: Faturamento.DE_50K_A_100K })
  @IsEnum(Faturamento)
  faturamento: Faturamento;

  @ApiProperty({ enum: TempoOperacao, example: TempoOperacao.DE_1_A_3_ANOS })
  @IsEnum(TempoOperacao)
  tempoOperacao: TempoOperacao;

  @ApiPropertyOptional({ enum: ModeloOperacao, example: ModeloOperacao.ECOMMERCE })
  @IsOptional()
  @IsEnum(ModeloOperacao)
  modeloOperacao?: ModeloOperacao;

  @ApiProperty({ enum: CargoEmpresa, example: CargoEmpresa.SOCIO })
  @IsEnum(CargoEmpresa)
  cargo: CargoEmpresa;

  @ApiPropertyOptional({ example: 'Google' })
  @IsOptional()
  @IsString()
  comoConheceu?: string;
}
