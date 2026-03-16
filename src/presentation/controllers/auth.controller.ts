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
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LoginDto } from '../../application/dtos/auth/login.dto';
import { RegisterDto } from '../../application/dtos/auth/register.dto';
import { RefreshTokenDto } from '../../application/dtos/auth/refresh-token.dto';
import { LogoutDto } from '../../application/dtos/auth/logout.dto';
import { LoginUseCase } from '../../application/use-cases/auth/login.use-case';
import { RegisterUseCase } from '../../application/use-cases/auth/register.use-case';
import { RefreshTokenUseCase } from '../../application/use-cases/auth/refresh-token.use-case';
import { LogoutUseCase } from '../../application/use-cases/auth/logout.use-case';
import { GetMeUseCase } from '../../application/use-cases/auth/get-me.use-case';
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
    private readonly register: RegisterUseCase,
    private readonly refresh: RefreshTokenUseCase,
    private readonly logout: LogoutUseCase,
    private readonly me: GetMeUseCase,
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
    schema: { example: { statusCode: 400, message: ['email must be an email'] } },
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

    try {
      const out = await this.login.execute({
        dto,
        userAgent: req.headers['user-agent'] ?? null,
        ipAddress: ip,
      });

      setAccessTokenCookie(res, out.accessToken);

      return { data: out };
    } catch (err) {
      throw err;
    }
  }

  @Post('register')
  @ApiOperation({ summary: 'Criar conta' })
  @ApiBody({
    type: RegisterDto,
    examples: {
      default: {
        value: {
          name: 'João Silva',
          email: 'joao@empresa.com',
          password: 'senha123',
          document: '123.456.789-00',
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
          user: { id: 'uuid-user-1', name: 'João Silva', email: 'joao@empresa.com' },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: { example: { statusCode: 400, message: ['password must be longer than or equal to 6 characters'] } },
  })
  @ApiResponse({
    status: 409,
    schema: { example: { statusCode: 409, message: 'E-mail já cadastrado' } },
  })
  async registerRoute(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: unknown }> {
    const ip = getRequestIp(req) ?? req.ip ?? 'unknown';

    const out = await this.register.execute({
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
