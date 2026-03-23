import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(StorageService.name);

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.STORJ_REGION || 'US1',
      endpoint: process.env.STORJ_ENDPOINT || 'https://gateway.storjshare.io',
      credentials: {
        accessKeyId: process.env.STORJ_ACCESS_KEY || '',
        secretAccessKey: process.env.STORJ_SECRET_KEY || '',
      },
      forcePathStyle: true,
    });
    this.bucket = process.env.STORJ_BUCKET || 'ebook';
  }

  async uploadFile(file: Express.Multer.File, folder: string = 'receipts'): Promise<string> {
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

      // Construct the public URL
      // Storj gateway URLs are usually: {endpoint}/{bucket}/{key}
      const publicUrl = `${process.env.STORJ_ENDPOINT}/${this.bucket}/${fileName}`;
      return publicUrl;
    } catch (error) {
      this.logger.error(`Error uploading file to Storj: ${error.message}`);
      throw new Error(`Falha ao fazer upload do arquivo: ${error.message}`);
    }
  }
}
