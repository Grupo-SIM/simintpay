import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsIn, IsDateString, Min } from 'class-validator';

export class ListSubscribersQueryDto {
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

  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  planoId?: string;

  @IsIn(['active', 'paused', 'deactivated'])
  @IsOptional()
  statusGroup?: 'active' | 'paused' | 'deactivated';

  @IsIn(['MONTHLY', 'YEARLY'])
  @IsOptional()
  frequency?: 'MONTHLY' | 'YEARLY';

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  platform?: string;

  @IsDateString()
  @IsOptional()
  firstChargeFrom?: string;

  @IsDateString()
  @IsOptional()
  firstChargeTo?: string;
}
