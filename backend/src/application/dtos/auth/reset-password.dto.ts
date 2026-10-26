import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'jwt-reset-token' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ example: 'nova-senha-forte' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}
