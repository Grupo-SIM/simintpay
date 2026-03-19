import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { UpdateProfileDto } from '../../application/dtos/settings/update-profile.dto';
import { UpdateEmailSettingsDto } from '../../application/dtos/settings/update-email-settings.dto';
import { GetProfileUseCase } from '../../application/use-cases/settings/get-profile.use-case';
import { UpdateProfileUseCase } from '../../application/use-cases/settings/update-profile.use-case';
import { GetEmailSettingsUseCase } from '../../application/use-cases/settings/get-email-settings.use-case';
import { UpdateEmailSettingsUseCase } from '../../application/use-cases/settings/update-email-settings.use-case';
import { GetTaxesUseCase } from '../../application/use-cases/settings/get-taxes.use-case';
import { ChangePasswordUseCase } from '../../application/use-cases/settings/change-password.use-case';
import { ChangePasswordDto } from '../../application/dtos/settings/change-password.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('configuracoes')
@UseGuards(JwtAuthGuard)
@ApiTags('Configurações')
@ApiBearerAuth()
export class SettingsController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly getEmail: GetEmailSettingsUseCase,
    private readonly updateEmail: UpdateEmailSettingsUseCase,
    private readonly taxes: GetTaxesUseCase,
    private readonly changePassword: ChangePasswordUseCase,
  ) {}

  @Get('perfil')
  @ApiOperation({ summary: 'Obter perfil' })
  @ApiResponse({ status: 200, schema: { example: { data: { nome: 'João', email: 'joao@empresa.com' } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async profileRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.getProfile.execute({ userId: user?.sub ?? '' });
  }

  @Put('perfil')
  @ApiOperation({ summary: 'Atualizar perfil' })
  @ApiBody({
    type: UpdateProfileDto,
    examples: {
      default: { value: { nome: 'João Silva', email: 'joao@empresa.com' } },
    },
  })
  @ApiResponse({ status: 200, schema: { example: { data: { updated: true } } } })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['email must be an email'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async updateProfileRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ data: unknown }> {
    return this.updateProfile.execute({ userId: user?.sub ?? '', dto });
  }

  @Get('taxas')
  @ApiOperation({ summary: 'Obter taxas' })
  @ApiResponse({
    status: 200,
    schema: { example: { data: { pix: { percentual: 1.99, fixo: 0.5 } } } },
  })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async taxesRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.taxes.execute({ userId: user?.sub ?? '' });
  }

  @Get('email')
  @ApiOperation({ summary: 'Obter configurações de e-mail' })
  @ApiResponse({ status: 200, schema: { example: { data: { emailNotifications: true } } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async emailRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    return this.getEmail.execute({ userId: user?.sub ?? '' });
  }

  @Put('senha')
  @ApiOperation({ summary: 'Alterar senha' })
  @ApiBody({
    type: ChangePasswordDto,
    examples: {
      default: { value: { currentPassword: 'senha-atual', newPassword: 'nova-senha' } },
    },
  })
  @ApiResponse({ status: 200, schema: { example: { data: { updated: true } } } })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: 'Senha atual incorreta' } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async changePasswordRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ data: unknown }> {
    return this.changePassword.execute({ userId: user?.sub ?? '', dto });
  }

  @Put('email')
  @ApiOperation({ summary: 'Atualizar configurações de e-mail' })
  @ApiBody({
    type: UpdateEmailSettingsDto,
    examples: {
      default: { value: { emailNotifications: true } },
    },
  })
  @ApiResponse({ status: 200, schema: { example: { data: { updated: true } } } })
  @ApiResponse({ status: 400, schema: { example: { statusCode: 400, message: ['emailNotifications must be a boolean value'] } } })
  @ApiResponse({ status: 401, schema: { example: { statusCode: 401, message: 'Unauthorized' } } })
  async updateEmailRoute(
    @CurrentUser() user: JwtPayload | undefined,
    @Body() dto: UpdateEmailSettingsDto,
  ): Promise<{ data: unknown }> {
    return this.updateEmail.execute({ userId: user?.sub ?? '', dto });
  }
}
