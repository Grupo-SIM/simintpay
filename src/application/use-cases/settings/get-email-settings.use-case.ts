import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma/prisma.service';

@Injectable()
export class GetEmailSettingsUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: { userId: string }): Promise<{ data: unknown }> {
    const settings = await this.prisma.userSettings.findUnique({
      where: { userId: input.userId },
    });

    return {
      data: {
        emailNotifications: settings?.emailNotifications ?? true,
      },
    };
  }
}
