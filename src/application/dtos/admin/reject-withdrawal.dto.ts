import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Chave PIX inválida' })
  @IsString()
  @MinLength(3)
  motivo: string;
}
