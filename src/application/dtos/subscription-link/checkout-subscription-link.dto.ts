import {
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutCardDto {
  @IsString() @IsNotEmpty() token!: string;
  @IsString() @IsOptional() brand?: string;
  @IsString() @IsOptional() bin?: string;
  @IsString() @IsNotEmpty() exp_month!: string;
  @IsString() @IsNotEmpty() exp_year!: string;
  @IsString() @IsNotEmpty() cvv!: string;
  @IsString() @IsNotEmpty() holder_name!: string;
  @IsString() @IsNotEmpty() holder_document!: string;
  @IsString() @IsOptional() number?: string;
}

export class CheckoutSubscriptionLinkCardDto {
  @IsString() @IsNotEmpty() customerName!: string;
  @IsString() @IsNotEmpty() customerEmail!: string;
  @IsString() @IsNotEmpty() customerDocument!: string;
  @IsString() @IsOptional() customerPhone?: string;
  @IsString() @IsOptional() voucherCode?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => CheckoutCardDto)
  card!: CheckoutCardDto;
}

export class CheckoutSubscriptionLinkPixDto {
  @IsString() @IsNotEmpty() customerName!: string;
  @IsString() @IsNotEmpty() customerEmail!: string;
  @IsString() @IsNotEmpty() customerDocument!: string;
  @IsString() @IsOptional() customerPhone?: string;
  @IsString() @IsOptional() voucherCode?: string;
}
