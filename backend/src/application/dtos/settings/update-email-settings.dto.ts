import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateEmailSettingsDto {
  @IsBoolean()
  @IsOptional()
  emailNotifications?: boolean;
}
