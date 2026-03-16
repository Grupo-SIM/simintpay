import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListTransactionsQueryDto {
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

  @IsOptional()
  @IsIn(['PENDENTE', 'APROVADA', 'RECUSADA', 'ESTORNADA'])
  status?: 'PENDENTE' | 'APROVADA' | 'RECUSADA' | 'ESTORNADA';

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  dataInicio?: string;

  @IsOptional()
  @IsString()
  dataFim?: string;

  @IsOptional()
  @IsIn(['PIX', 'CREDIT_CARD'])
  metodo?: 'PIX' | 'CREDIT_CARD';
}
