import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength } from 'class-validator';

/** Body of `POST /ofertas/public/:code/renew`. `sig` is the HMAC of the contract id (renewal link). */
export class OfferRenewDto {
  @ApiProperty() @IsString() @MaxLength(64) contractId!: string;
  @ApiProperty() @IsString() @MaxLength(128) sig!: string;
  @ApiProperty({ enum: ['pix'] }) @IsIn(['pix']) paymentMethod!: 'pix';
}
