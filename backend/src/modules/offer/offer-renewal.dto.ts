import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of `POST /ofertas/public/:code/renew`. `sig` is the HMAC of the contract id (renewal link). */
export class OfferRenewDto {
  @ApiProperty() @IsString() @MaxLength(64) contractId!: string;
  @ApiProperty() @IsString() @MaxLength(128) sig!: string;
  /** `card` charges the contract's stored card; PIX is the default. */
  @ApiProperty({ enum: ['pix', 'card'], required: false })
  @IsOptional()
  @IsIn(['pix', 'card'])
  paymentMethod?: 'pix' | 'card';
}
