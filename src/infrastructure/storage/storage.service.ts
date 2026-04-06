import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
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

  /**
   * Extrai a chave S3 a partir da URL pública gravada no banco (`endpoint/bucket/key`).
   */
  tryExtractObjectKeyFromStoredUrl(storedUrl: string): string | null {
    try {
      const u = new URL(storedUrl.trim());
      const gatewayHost = new URL(this.endpointBase).hostname;
      if (u.hostname !== gatewayHost) return null;
      const path = decodeURIComponent(u.pathname);
      const prefix = `/${this.bucket}/`;
      if (!path.startsWith(prefix)) return null;
      return path.slice(prefix.length);
    } catch {
      return null;
    }
  }

  private async streamToBuffer(body: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    const stream = body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Lê o comprovante: GetObject com credenciais (bucket privado) ou GET HTTP no mesmo host do gateway.
   */
  async getReceiptBufferByStoredUrl(storedUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const trimmed = storedUrl.trim();
    if (!trimmed) {
      throw new Error('EMPTY_RECEIPT_URL');
    }

    const key = this.tryExtractObjectKeyFromStoredUrl(trimmed);
    if (key && this.accessKeyId && this.secretAccessKey) {
      try {
        const res = await this.s3Client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
          }),
        );
        if (!res.Body) throw new Error('EMPTY_BODY');
        const buffer = await this.streamToBuffer(res.Body);
        const contentType =
          res.ContentType?.split(';')[0]?.trim() ?? 'application/octet-stream';
        return { buffer, contentType };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`GetObject comprovante falhou (key=${key}): ${msg}`);
      }
    }

    return this.fetchReceiptViaAllowedHttp(trimmed);
  }

  /** Só o host do STORJ_ENDPOINT (evita SSRF). */
  private async fetchReceiptViaAllowedHttp(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('INVALID_RECEIPT_URL');
    }
    const allowedHost = new URL(this.endpointBase).hostname;
    if (parsed.hostname !== allowedHost) {
      throw new Error('RECEIPT_HOST_NOT_ALLOWED');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('INVALID_RECEIPT_URL');
    }

    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!res.ok) {
      throw new Error(`HTTP_${res.status}`);
    }
    const ab = await res.arrayBuffer();
    const contentType =
      res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream';
    return { buffer: Buffer.from(ab), contentType };
  }
}
