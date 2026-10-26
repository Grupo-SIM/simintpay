import { BadRequestException, Controller, Get, Query, Req, SetMetadata, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from './platform-auth.guard';
import type { PlatformContext } from './platform-context.service';
import { PlatformSalesEventsService } from './platform-sales-events.service';
@Controller('platforms/:tag')
@UseGuards(PlatformAuthGuard)
export class PlatformSalesEventsController {
  constructor(private readonly events: PlatformSalesEventsService) {}
  // SSE /events remains backwards-compatible. Durable replay has separate route.
  @Get('event-history') @SetMetadata('platform-operation', 'events:read')
  history(@Req() req: { platformContext: PlatformContext }, @Query('cursor') cursor = '') {
    if (cursor && !/^\d+$/.test(cursor)) throw new BadRequestException('Cursor inválido');
    return this.events.history(req.platformContext, cursor);
  }
}
