import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class ListWithdrawalsQueryDto {
  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value != null ? Number(value) : value,
  )
  page?: number = 1;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value != null ? Number(value) : value,
  )
  pageSize?: number = 10;

  @IsEnum(['PENDENTE', 'APROVADO', 'REJEITADO', 'PAGO', 'all'])
  @IsOptional()
  status?: 'PENDENTE' | 'APROVADO' | 'REJEITADO' | 'PAGO' | 'all';
}
