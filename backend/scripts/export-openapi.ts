import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function exportOpenApi() {
  // Preview scans controller metadata without constructing providers, opening
  // database/broker connections, starting schedules, or binding a server.
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
    abortOnError: false,
  });
  try {
    const config = new DocumentBuilder()
      .setTitle('SimPay BFF API')
      .setDescription('Backend For Frontend - Plataforma de Pagamentos SimPay')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    const directory = resolve(__dirname, '../out');
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, 'openapi.json'),
      JSON.stringify(document, null, 2) + '\n',
    );
    console.log(
      `Exported ${Object.keys(document.paths).length} API paths to out/openapi.json`,
    );
  } finally {
    await app.close();
  }
}

void exportOpenApi().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
