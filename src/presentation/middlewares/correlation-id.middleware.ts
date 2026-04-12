import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';

const httpLogger = new Logger('HTTP');

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers['x-correlation-id'];
  const correlationId =
    typeof header === 'string' && header.length > 0 ? header : randomUUID();

  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  httpLogger.log(`${req.method} ${req.url} [cid=${correlationId}]`);

  next();
}
