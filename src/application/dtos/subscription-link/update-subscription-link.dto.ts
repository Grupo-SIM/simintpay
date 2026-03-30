import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateSubscriptionLinkDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  nome?: string;

  @IsString()
  @IsOptional()
  descricao?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  isStandalone?: boolean;

  @IsNumber()
  @IsOptional()
  platformFee?: number;

  @IsString()
  @IsOptional()
  redirectUrl?: string;

  @IsString()
  @IsOptional()
  webhookUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;
}
