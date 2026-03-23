import { IsEmail, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CheckoutCreditCardDto {
  @IsNumber()
  @Min(0.01)
  price: number;

  @IsString()
  @IsNotEmpty()
  document: string;

  @IsString()
  @IsNotEmpty()
  document_type: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  mobile_phone?: string;

  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  holder_name: string;

  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsNotEmpty()
  bin: string;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsNumber()
  @Min(1)
  installments: number;

  @IsString()
  store?: string;
}
