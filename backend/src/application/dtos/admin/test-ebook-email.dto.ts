import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class TestEbookEmailDto {
  @ApiProperty({ description: 'E-mail de destino', example: 'seuemail@exemplo.com' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiPropertyOptional({ description: 'Nome do comprador', example: 'Gabriel' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ description: 'Título (assunto)', example: 'Meu Ebook X' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({
    description: 'Corpo do e-mail (texto; quebras de linha viram parágrafos, URLs viram links)',
    example: 'Olá! Obrigado pela compra.\nAcesse seu ebook: https://drive.google.com/seu-link',
  })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'URL do botão "Acessar conteúdo"', example: 'https://exemplo.com/area' })
  @IsOptional()
  @IsString()
  redirectUrl?: string;
}
