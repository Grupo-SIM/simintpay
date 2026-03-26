import { IsEmail, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CheckoutPixDto {
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
  store?: string;
}
