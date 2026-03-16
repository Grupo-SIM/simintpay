import { IsNotEmpty, IsNumber, IsString, Matches, Min } from 'class-validator';

export class RequestWithdrawDto {
  @IsNumber()
  @Min(100, { message: 'O valor mínimo para saque é de R$ 100,00' })
  valor!: number;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, {
    message:
      'Chave PIX deve estar no formato CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)',
  })
  chavePix!: string;
}
