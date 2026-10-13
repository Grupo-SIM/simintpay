import { IsNotEmpty, IsOptional, IsNumber, IsString, Matches, Min } from 'class-validator';

export class RequestWithdrawDto {
  @IsOptional()
  @IsString()
  platformTag?: string;

  @IsNumber()
  @Min(0.01, { message: 'Valor de saque deve ser positivo' })
  valor!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, {
    message:
      'Chave PIX deve estar no formato CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)',
  })
  chavePix!: string;
}
