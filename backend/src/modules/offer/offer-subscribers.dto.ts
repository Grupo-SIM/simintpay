import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toNumber = ({ value }: { value: unknown }) =>
  value != null && value !== '' ? Number(value) : undefined;

export class ListOfferSubscribersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({ enum: ['active', 'paused', 'deactivated'] })
  @IsOptional()
  @IsIn(['active', 'paused', 'deactivated'])
  statusGroup?: 'active' | 'paused' | 'deactivated';

  @ApiPropertyOptional({ enum: ['MONTHLY', 'YEARLY'] })
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  frequency?: 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({
    description: 'Nome, e-mail do assinante ou nome da oferta',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ description: 'Filtra por uma oferta' })
  @IsOptional()
  @IsString()
  @MaxLength(191)
  offerId?: string;

  @ApiPropertyOptional({ description: 'Tag da plataforma da oferta' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  platform?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  firstChargeFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  firstChargeTo?: string;
}
