import { IsOptional, IsString } from 'class-validator';

export class RejectLeadDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
