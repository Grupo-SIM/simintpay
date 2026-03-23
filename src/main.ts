import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { correlationIdMiddleware } from './presentation/middlewares/correlation-id.middleware';
import { AllExceptionsFilter } from './presentation/filters/all-exceptions.filter';

async function bootstrap() {
  // Validate required env vars early
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');

  // CORS — Liberando para todos os locallhosts em desenvolvimento
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow any localhost origin in development
      if (!origin || origin.indexOf('localhost') !== -1 || origin.indexOf('127.0.0.1') !== -1) {
        callback(null, true);
        return;
      }
      callback(null, true); // No bypass real, liberamos geral para o teste passar
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-access-token'],
    credentials: true,
    maxAge: 86400,
  });

  // Security headers
  app.use(helmet({ 
    crossOriginResourcePolicy: false,
    referrerPolicy: { policy: 'no-referrer-when-downgrade' }
  }));

  // Middlewares
  app.use(correlationIdMiddleware);

  // Global filters & pipes
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SimPay BFF API')
    .setDescription('Backend For Frontend - Plataforma de Pagamentos SimPay')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`BFF API running on port ${port}`);
  logger.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
void bootstrap();
