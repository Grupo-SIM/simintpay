import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class PlatformSubscriptionPlanDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amountCents!: number;
  @IsEnum(['SEMANAL', 'MENSAL', 'ANUAL']) frequency!: 'SEMANAL' | 'MENSAL' | 'ANUAL';
  @IsOptional() @IsString() description?: string;
}
