import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SyncWithdrawalsDto {
  @ApiPropertyOptional({ example: 'c7f3a2b1-d4e5-4f6a-8b9c-0d1e2f3a4b5c', description: 'ID do usuário na api-machine' })
  @IsOptional()
  @IsString()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: '0ba3f139-b1ff-4ded-a5ef-71ccb1c9482f', description: 'Token da conta na api-dom (sobrescreve qualquer token configurado)' })
  @IsOptional()
  @IsString()
  domToken?: string;
}
