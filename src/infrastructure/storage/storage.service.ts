import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

function normalizeStorjRegion(raw: string | undefined): string {
  const trimmed = (raw || 'us-1').trim();
  // "US1" quebra o X-Amz-Credential no gateway Storj; o valor correto é "us-1"
  if (/^us1$/i.test(trimmed) || trimmed.toUpperCase() === 'US1') {
    return 'us-1';
  }
  return trimmed;
}

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly endpointBase: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    this.accessKeyId = (process.env.STORJ_ACCESS_KEY || '').trim();
    this.secretAccessKey = (process.env.STORJ_SECRET_KEY || '').trim();
    const rawEndpoint = process.env.STORJ_ENDPOINT || 'https://gateway.storjshare.io';
    this.endpointBase = rawEndpoint.replace(/\/$/, '').trim();
    const region = normalizeStorjRegion(process.env.STORJ_REGION);
    this.bucket = (process.env.STORJ_BUCKET || 'ebook').trim();

    if (!this.accessKeyId || !this.secretAccessKey) {
      this.logger.warn(
        'STORJ_ACCESS_KEY ou STORJ_SECRET_KEY ausente — upload de arquivos falhará até configurar.',
      );
    }

    this.s3Client = new S3Client({
      region,
      endpoint: this.endpointBase,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'receipts'): Promise<string> {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        'Armazenamento não configurado: defina STORJ_ACCESS_KEY e STORJ_SECRET_KEY no servidor.',
      );
    }

    const fileExtension = file.originalname.split('.').pop();
    const fileName = `${folder}/${uuidv4()}.${fileExtension}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fileName,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read',
        }),
      );

      return `${this.endpointBase}/${this.bucket}/${fileName}`;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error uploading file to Storj: ${message}`);
      throw new Error(`Falha ao fazer upload do arquivo: ${message}`);
    }
  }
}
