import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';
import type { UpdateEmailSettingsDto } from '../../dtos/settings/update-email-settings.dto';

@Injectable()
export class UpdateEmailSettingsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: {
    userId: string;
    dto: UpdateEmailSettingsDto;
  }): Promise<{ data: unknown }> {
    const updated = await this.prisma.userSettings.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        emailNotifications: input.dto.emailNotifications ?? true,
      },
      update: {
        emailNotifications: input.dto.emailNotifications ?? undefined,
      },
    });

    return { data: { emailNotifications: updated.emailNotifications } };
  }
}
