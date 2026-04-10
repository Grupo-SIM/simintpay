import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../infrastructure/security/guards/jwt-auth.guard';
import { DeleteClienteUseCase } from '../../application/use-cases/cliente/delete-cliente.use-case';
import { ListClientesUseCase } from '../../application/use-cases/cliente/list-clientes.use-case';
import { GetClienteUseCase } from '../../application/use-cases/cliente/get-cliente.use-case';
import { CreateClienteUseCase } from '../../application/use-cases/cliente/create-cliente.use-case';
import { GetClientePlanAccessUseCase } from '../../application/use-cases/cliente/get-cliente-plan-access.use-case';
import { CreateClienteDto } from '../../application/dtos/cliente/create-cliente.dto';
import { CurrentUser } from '../../infrastructure/security/decorators/current-user.decorator';
import type { JwtPayload } from '../../infrastructure/security/strategies/jwt.strategy';

@ApiTags('Clientes')
@Controller('clientes')
export class ClienteController {
  constructor(
    private readonly deleteCliente: DeleteClienteUseCase,
    private readonly listClientes: ListClientesUseCase,
    private readonly getCliente: GetClienteUseCase,
    private readonly createCliente: CreateClienteUseCase,
    private readonly getPlanAccess: GetClientePlanAccessUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar clientes' })
  @ApiResponse({ status: 200, description: 'Lista de clientes.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  async list(@CurrentUser() user: JwtPayload) {
    return this.listClientes.execute({ userId: user.sub, role: user.role });
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Criar cliente' })
  @ApiResponse({ status: 201, description: 'Cliente criado com sucesso.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateClienteDto,
  ) {
    return this.createCliente.execute({ userId: user.sub, body });
  }

  @Get('email/:email')
  @ApiOperation({ summary: 'Buscar cliente por e-mail' })
  @ApiResponse({ status: 200, description: 'Cliente encontrado.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async getByEmail(@Param('email') email: string) {
    return this.getCliente.executeByEmail({
      userId: '',
      role: undefined,
      email,
    });
  }

  @Get('plan-access/:customerId')
  @ApiOperation({
    summary: 'Consultar acesso ao plano por customerId (público)',
  })
  @ApiResponse({ status: 200, description: 'Status do acesso ao plano.' })
  async getPlanAccessByCustomerId(
    @Param('customerId') customerId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.getPlanAccess.executeByCustomerId({
      userId: user?.sub ?? '',
      customerId,
    });
  }

  @Get('plan-access/email/:email')
  @ApiOperation({ summary: 'Consultar acesso ao plano por e-mail (público)' })
  @ApiResponse({ status: 200, description: 'Status do acesso ao plano.' })
  async getPlanAccessByEmail(
    @Param('email') email: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.getPlanAccess.executeByEmail({
      userId: user?.sub ?? '',
      email,
    });
  }

  @Get('public/basic-info/:id')
  @ApiOperation({
    summary: 'Buscar informações básicas do cliente (id e email) - público',
  })
  @ApiResponse({ status: 200, description: 'Retorna id e email do cliente.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async getBasicInfo(@Param('id') id: string) {
    return this.getCliente.executeBasicInfo(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar cliente por ID' })
  @ApiResponse({ status: 200, description: 'Cliente encontrado.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async getById(@Param('id') id: string) {
    return this.getCliente.executeById({
      userId: '',
      role: undefined,
      id,
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Excluir um cliente e cancelar suas assinaturas' })
  @ApiResponse({ status: 200, description: 'Cliente excluído com sucesso.' })
  @ApiResponse({ status: 401, description: 'Não autorizado.' })
  @ApiResponse({ status: 404, description: 'Cliente não encontrado.' })
  async delete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.deleteCliente.execute({ userId: user.sub, role: user.role, id });
    return { success: true, message: 'Cliente excluído com sucesso.' };
  }
}
