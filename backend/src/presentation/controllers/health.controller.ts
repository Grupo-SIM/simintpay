import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@ApiTags('Health')
export class HealthController {
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Healthcheck' })
  @ApiResponse({ status: 200, schema: { example: { status: 'ok' } } })
  get(): { status: string } {
    return { status: 'ok' };
  }
}
