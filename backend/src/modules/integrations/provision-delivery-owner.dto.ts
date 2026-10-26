import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ProvisionDeliveryOwnerDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  legalName: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  cnpj?: string;
}
