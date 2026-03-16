import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CreateLeadDto } from '../../application/dtos/lead/create-lead.dto';
import { CreateLeadUseCase } from '../../application/use-cases/lead/create-lead.use-case';
import { getRequestIp } from '../../shared/utils/request.utils';

@ApiTags('Leads (Solicitações de Cadastro)')
@Controller('leads')
export class LeadController {
  constructor(
    private readonly createLead: CreateLeadUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute for this public endpoint
  @ApiOperation({ summary: 'Enviar solicitação de cadastro (público, sem auth)' })
  @ApiBody({
    type: CreateLeadDto,
    examples: {
      default: {
        value: {
          name: 'João Silva',
          phone: '(11) 99999-9999',
          email: 'joao@empresa.com',
          razaoSocial: 'Empresa LTDA',
          cnpj: '12.345.678/0001-90',
          faturamento: 'DE_50K_A_100K',
          tempoOperacao: 'DE_1_A_3_ANOS',
          modeloOperacao: 'ECOMMERCE',
          cargo: 'SOCIO',
          comoConheceu: 'Google',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    schema: {
      example: {
        data: { id: 'uuid-lead-1' },
        message: 'Solicitação enviada com sucesso! Entraremos em contato em breve.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    schema: {
      example: {
        statusCode: 400,
        message: ['email must be an email'],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: 409,
    schema: {
      example: {
        statusCode: 409,
        message: 'Já existe uma solicitação pendente com este e-mail',
      },
    },
  })
  async create(@Body() dto: CreateLeadDto, @Req() req: Request) {
    const ip = getRequestIp(req) ?? req.ip ?? 'unknown';
    return this.createLead.execute(dto);
  }
}
