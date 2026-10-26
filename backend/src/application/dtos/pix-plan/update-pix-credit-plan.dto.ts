import { PartialType } from '@nestjs/swagger';
import { CreatePixCreditPlanDto } from './create-pix-credit-plan.dto';
export class UpdatePixCreditPlanDto extends PartialType(CreatePixCreditPlanDto) {}
