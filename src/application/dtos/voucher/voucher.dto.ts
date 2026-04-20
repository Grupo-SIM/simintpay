import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  IsDateString,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVoucherDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ['PERCENTAGE', 'FIXED'] })
  @IsEnum(['PERCENTAGE', 'FIXED'])
  discountType: 'PERCENTAGE' | 'FIXED';

  @ApiProperty()
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  maxUsage?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  maxDiscountValue?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  applicablePlans?: string[];

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderValue?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  allowedChannels?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  allowedLinkCodes?: string[];
}

export class UpdateVoucherDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: ['PERCENTAGE', 'FIXED'] })
  @IsEnum(['PERCENTAGE', 'FIXED'])
  @IsOptional()
  discountType?: 'PERCENTAGE' | 'FIXED';

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  maxUsage?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  maxDiscountValue?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  validUntil?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  applicablePlans?: string[];

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  minOrderValue?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  allowedChannels?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  allowedLinkCodes?: string[];

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ValidateVoucherDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  voucherCode?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  groupPageId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  planId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  linkCode?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetOwnerId?: string;
}

export class RecordVoucherUsageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  voucherId: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  transactionId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  subscriptionId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerEmail: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  customerDocument: string;

  @ApiProperty()
  @IsNumber()
  originalAmount: number;

  @ApiProperty()
  @IsNumber()
  discountAmount: number;

  @ApiProperty()
  @IsNumber()
  finalAmount: number;
}
