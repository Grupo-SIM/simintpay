import { IsDateString, IsInt, IsOptional, Min } from 'class-validator';

export class ChangeBillingQuantityDto {
  @IsInt()
  @Min(0)
  targetQuantity!: number;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsDateString()
  @IsOptional()
  effectiveAt?: string;
}
