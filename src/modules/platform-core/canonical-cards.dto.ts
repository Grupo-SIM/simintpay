import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
export class CanonicalCustomerDto {
  @IsString() @MinLength(1) @MaxLength(128) externalCustomerId!: string;
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsEmail() email!: string;
  @IsString() @Matches(/^\d{11}(?:\d{3})?$/) document!: string;
  @IsOptional() @IsString() phone?: string;
}
export class CanonicalCardDto {
  @IsString() @Matches(/^\d{13,19}$/) number!: string;
  @IsString() @Matches(/^\d{3,4}$/) cvv!: string;
  @IsInt() @Min(1) @Max(12) expMonth!: number;
  @IsInt() @Min(2000) @Max(2200) expYear!: number;
  @IsString() @MinLength(2) holderName!: string;
  @IsString() @Matches(/^\d{11}(?:\d{3})?$/) holderDocument!: string;
}
