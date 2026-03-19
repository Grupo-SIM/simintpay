"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AllExceptionsFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllExceptionsFilter = void 0;
const common_1 = require("@nestjs/common");
let AllExceptionsFilter = AllExceptionsFilter_1 = class AllExceptionsFilter {
    logger = new common_1.Logger(AllExceptionsFilter_1.name);
    catch(exception, host) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        const axiosError = exception;
        const isAxiosError = axiosError?.isAxiosError === true || axiosError?.response !== undefined;
        let status;
        let message;
        let error;
        if (exception instanceof common_1.HttpException) {
            status = exception.getStatus();
            const exceptionResponse = exception.getResponse();
            message =
                typeof exceptionResponse === 'string'
                    ? exceptionResponse
                    : exceptionResponse?.message ??
                        exception.message;
            error = exception.name;
        }
        else if (isAxiosError && axiosError.response) {
            status = axiosError.response.status ?? common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            const data = axiosError.response.data;
            message =
                data?.message ??
                    data?.error ??
                    axiosError.message ??
                    'External service error';
            error = `ExternalServiceError`;
        }
        else {
            status = common_1.HttpStatus.INTERNAL_SERVER_ERROR;
            message =
                exception instanceof Error ? exception.message : 'Internal server error';
            error = 'InternalServerError';
        }
        const correlationIdHeader = request.headers['x-correlation-id'];
        const correlationId = typeof correlationIdHeader === 'string' ? correlationIdHeader : '';
        this.logger.error(`[${request.method} ${request.url}] ${status} — ${JSON.stringify(message)}`, exception instanceof Error ? exception.stack : String(exception));
        response.status(status).json({
            statusCode: status,
            message,
            error,
            timestamp: new Date().toISOString(),
            path: request.url,
            correlationId,
        });
    }
};
exports.AllExceptionsFilter = AllExceptionsFilter;
exports.AllExceptionsFilter = AllExceptionsFilter = AllExceptionsFilter_1 = __decorate([
    (0, common_1.Catch)()
], AllExceptionsFilter);
//# sourceMappingURL=all-exceptions.filter.js.map