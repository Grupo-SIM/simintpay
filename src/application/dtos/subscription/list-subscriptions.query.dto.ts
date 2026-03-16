import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ListSubscriptionsQueryDto {
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
  pageSize?: number = 20;
}
