import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  Matches,
  ValidateIf,
} from 'class-validator';
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

/** Dados da empresa só são exigidos quando o documento informado é um CNPJ (pessoa jurídica). */
const isCompanyLead = (o: { cpf?: unknown }) =>
  typeof o.cpf === 'string' && o.cpf.replace(/\D/g, '').length === 14;

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

  @ApiPropertyOptional({
    example: 'Empresa LTDA',
    description: 'Obrigatório quando o documento é CNPJ',
  })
  @ValidateIf(isCompanyLead)
  @IsString()
  @IsNotEmpty()
  razaoSocial?: string;

  @ApiPropertyOptional({
    example: '12.345.678/0001-90',
    description: 'Opcional: assume o documento quando ele já é um CNPJ',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ inválido' })
  cnpj?: string;

  @ApiProperty({ example: '123.456.789-09 ou 12.345.678/0001-90' })
  @IsString()
  @IsNotEmpty()
  @IsDocument({ message: 'CPF ou CNPJ inválido' })
  cpf: string;

  @ApiPropertyOptional({
    enum: Faturamento,
    example: Faturamento.DE_50K_A_100K,
  })
  @ValidateIf(isCompanyLead)
  @IsEnum(Faturamento)
  faturamento?: Faturamento;

  @ApiPropertyOptional({
    enum: TempoOperacao,
    example: TempoOperacao.DE_1_A_3_ANOS,
  })
  @ValidateIf(isCompanyLead)
  @IsEnum(TempoOperacao)
  tempoOperacao?: TempoOperacao;

  @ApiPropertyOptional({
    enum: ModeloOperacao,
    example: ModeloOperacao.ECOMMERCE,
  })
  @IsOptional()
  @IsEnum(ModeloOperacao)
  modeloOperacao?: ModeloOperacao;

  @ApiPropertyOptional({ enum: CargoEmpresa, example: CargoEmpresa.SOCIO })
  @ValidateIf(isCompanyLead)
  @IsEnum(CargoEmpresa)
  cargo?: CargoEmpresa;

  @ApiPropertyOptional({ example: 'Google' })
  @IsOptional()
  @IsString()
  comoConheceu?: string;

  @ApiPropertyOptional({
    example: 'ABC123',
    description:
      'Código de indicação do afiliado (query ?ref= do link público)',
  })
  @IsOptional()
  @IsString()
  referredByCode?: string;
}
