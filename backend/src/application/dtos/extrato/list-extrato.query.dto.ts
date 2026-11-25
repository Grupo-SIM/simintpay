import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const EXTRATO_NATURES = [
  'SALE',
  'COMMISSION',
  'COPRODUCTION',
  'AFFILIATE',
  'WITHDRAWAL',
  'REFUND',
  'ADJUSTMENT',
  'TRANSFER',
] as const;

export class ListExtratoQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  /** `YYYY-MM-DD` (America/Sao_Paulo), inclusive. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dataInicio?: string;

  /** `YYYY-MM-DD` (America/Sao_Paulo), inclusive. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dataFim?: string;

  /** Direção do movimento no saldo disponível. */
  @IsOptional()
  @IsIn(['ENTRADA', 'SAIDA', 'all'])
  tipo?: 'ENTRADA' | 'SAIDA' | 'all';

  @IsOptional()
  @IsIn([...EXTRATO_NATURES, 'all'])
  natureza?: (typeof EXTRATO_NATURES)[number] | 'all';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  busca?: string;
}
