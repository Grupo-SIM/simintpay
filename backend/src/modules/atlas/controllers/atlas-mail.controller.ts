import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalTokenGuard } from '../../../infrastructure/security/guards/internal-token.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtlasMailService } from '../services/atlas-mail.service';
import { SendVmAccessDto } from '../dtos/send-vm-access.dto';

@ApiTags('Atlas Mail')
@Controller('atlas/mail')
export class AtlasMailController {
  constructor(private readonly mailService: AtlasMailService) {}

  @Post('vm-access')
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary: '[ATLAS] Enviar dados de acesso da VM (IP e senha) por e-mail',
  })
  async sendVmAccess(@Body() body: SendVmAccessDto) {
    await this.mailService.sendVmAccess({
      to: body.email,
      vmIp: body.vmIp,
      vmPassword: body.vmPassword,
    });
    return { success: true, message: 'E-mail de acesso enviado com sucesso' };
  }
}
