import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class ExportReportQueryDto {
  @IsEnum(['csv', 'xlsx', 'pdf'])
  formato!: 'csv' | 'xlsx' | 'pdf';

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
  pageSize?: number = 100;
}
