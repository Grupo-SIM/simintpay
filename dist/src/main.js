"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
const swagger_1 = require("@nestjs/swagger");
const app_module_1 = require("./app.module");
const correlation_id_middleware_1 = require("./presentation/middlewares/correlation-id.middleware");
const all_exceptions_filter_1 = require("./presentation/filters/all-exceptions.filter");
async function bootstrap() {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is required');
    }
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { rawBody: true });
    const logger = new common_1.Logger('Bootstrap');
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    app.enableCors({
        origin: [frontendUrl, 'http://localhost:3000', 'https://simpay-back.simintermediacoes.com'],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
        maxAge: 86400,
    });
    app.use((0, helmet_1.default)({ crossOriginResourcePolicy: false }));
    app.use(correlation_id_middleware_1.correlationIdMiddleware);
    app.useGlobalFilters(new all_exceptions_filter_1.AllExceptionsFilter());
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('SimPay BFF API')
        .setDescription('Backend For Frontend - Plataforma de Pagamentos SimPay')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('api/docs', app, document);
    const port = process.env.PORT ?? 3001;
    await app.listen(port);
    logger.log(`BFF API running on port ${port}`);
    logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
void bootstrap();
//# sourceMappingURL=main.js.map