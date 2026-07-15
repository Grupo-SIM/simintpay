import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class SendVmAccessDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  vmIp: string;

  @IsString()
  @IsNotEmpty()
  vmPassword: string;
}
