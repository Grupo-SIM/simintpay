import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ example: 'senha-atual' })
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty({ example: 'nova-senha-forte' })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
