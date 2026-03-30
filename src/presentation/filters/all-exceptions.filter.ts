import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AxiosError } from 'axios';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const axiosError = exception as AxiosError;
    const isAxiosError =
      axiosError?.isAxiosError === true || axiosError?.response !== undefined;

    let status: number;
    let message: unknown;
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as { message?: unknown })?.message ??
            exception.message;
      error = exception.name;
    } else if (isAxiosError && axiosError.response) {
      status = axiosError.response.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      const data = axiosError.response.data as
        | Record<string, unknown>
        | undefined;
      // DOM costuma enviar `msg`; outros serviços usam `message` / `error`
      const rawMsg =
        data?.msg ?? data?.message ?? data?.error ?? axiosError.message;
      message =
        typeof rawMsg === 'string'
          ? rawMsg
          : Array.isArray(rawMsg)
            ? rawMsg.join('; ')
            : rawMsg != null
              ? JSON.stringify(rawMsg)
              : 'External service error';
      error = `ExternalServiceError`;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        exception instanceof Error ? exception.message : 'Internal server error';
      error = 'InternalServerError';
    }

    const correlationIdHeader = request.headers['x-correlation-id'];
    const correlationId =
      typeof correlationIdHeader === 'string' ? correlationIdHeader : '';

    this.logger.error(
      `[${request.method} ${request.url}] ${status} — ${JSON.stringify(message)}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId,
    });
  }
}
