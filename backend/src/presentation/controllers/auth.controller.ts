import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { RefreshTokenDto } from '../../application/dtos/auth/refresh-token.dto';
import { LogoutDto } from '../../application/dtos/auth/logout.dto';
import { ForgotPasswordDto } from '../../application/dtos/auth/forgot-password.dto';
import { ResetPasswordDto } from '../../application/dtos/auth/reset-password.dto';
import { LoginUseCase } from '../../application/use-cases/auth/login.use-case';
import { RefreshTokenUseCase } from '../../application/use-cases/auth/refresh-token.use-case';
import { LogoutUseCase } from '../../application/use-cases/auth/logout.use-case';
import { GetMeUseCase } from '../../application/use-cases/auth/get-me.use-case';
import { ForgotPasswordUseCase } from '../../application/use-cases/auth/forgot-password.use-case';
import { ResetPasswordUseCase } from '../../application/use-cases/auth/reset-password.use-case';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';
import { getRequestIp } from '../../shared/utils/request.utils';
import { setAccessTokenCookie } from '../../shared/utils/cookie.utils';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshTokenUseCase,
    private readonly logout: LogoutUseCase,
    private readonly me: GetMeUseCase,
    private readonly forgotPassword: ForgotPasswordUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Login' })
  @ApiBody({
    type: LoginDto,
    examples: {
      default: {
        value: {
          email: 'joao@empresa.com',
          password: 'senha123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: {
          accessToken: 'jwt-access-token',
          refreshToken: 'jwt-refresh-token',
          user: { id: 'uuid-user-1', name: 'João', email: 'joao@empresa.com' },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: { statusCode: 400, message: ['email must be an email'] },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Credenciais inválidas' } },
  })
  async loginRoute(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: unknown }> {
    const ip = getRequestIp(req) ?? req.ip ?? 'unknown';

    const out = await this.login.execute({
      dto,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: ip,
    });

    setAccessTokenCookie(res, out.accessToken);

    return { data: out };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Renovar access token' })
  @ApiBody({
    type: RefreshTokenDto,
    examples: {
      default: { value: { refreshToken: 'jwt-refresh-token' } },
    },
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: {
          accessToken: 'jwt-access-token',
          refreshToken: 'jwt-refresh-token',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Refresh token inválido' } },
  })
  async refreshRoute(
    @Body() dto: RefreshTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: unknown }> {
    const out = await this.refresh.execute({ refreshToken: dto.refreshToken });
    setAccessTokenCookie(res, out.accessToken);
    return { data: out };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout' })
  @ApiBody({
    type: LogoutDto,
    examples: {
      default: { value: { refreshToken: 'jwt-refresh-token' } },
    },
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async logoutRoute(@Body() dto: LogoutDto): Promise<void> {
    await this.logout.execute({ refreshToken: dto.refreshToken });
  }

  @Post('forgot-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Solicitar redefinição de senha (envia e-mail com link)',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, schema: { example: { data: { sent: true } } } })
  async forgotPasswordRoute(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ data: unknown }> {
    const out = await this.forgotPassword.execute({ email: dto.email });
    return out;
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redefinir senha usando o token recebido por e-mail',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: 200,
    schema: { example: { data: { updated: true } } },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: 'Link de redefinição inválido ou expirado. Solicite um novo.',
      },
    },
  })
  async resetPasswordRoute(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ data: unknown }> {
    const out = await this.resetPassword.execute({
      token: dto.token,
      newPassword: dto.newPassword,
    });
    return out;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dados do usuário autenticado' })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: { id: 'uuid-user-1', name: 'João', email: 'joao@empresa.com' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
  async meRoute(
    @CurrentUser() user: JwtPayload | undefined,
  ): Promise<{ data: unknown }> {
    const out = await this.me.execute({ userId: user?.sub ?? '' });
    return { data: out };
  }
}
