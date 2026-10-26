import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePlanDto } from './create-plan.dto';
export class UpdatePlanDto extends PartialType(CreatePlanDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
