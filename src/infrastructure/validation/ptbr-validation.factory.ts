import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

/** Rótulo amigável em PT-BR por nome de campo (fallback: o próprio nome). */
const FIELD_LABELS: Record<string, string> = {
  // Checkout / dados do comprador
  customerName: 'Nome completo',
  customerDocument: 'CPF/CNPJ',
  customerEmail: 'E-mail',
  customerPhone: 'Celular',
  document: 'CPF/CNPJ',
  phone: 'Celular',
  mobile_phone: 'Celular',
  // Genéricos
  name: 'Nome',
  nome: 'Nome',
  email: 'E-mail',
  descricao: 'Descrição',
  description: 'Descrição',
  valor: 'Valor',
  preco: 'Preço',
  price: 'Valor',
  amount: 'Valor',
  frequencia: 'Frequência',
  tipo: 'Tipo',
  paymentMethods: 'Formas de pagamento',
  paymentMethod: 'Forma de pagamento',
  installments: 'Parcelas',
  cardNumber: 'Número do cartão',
  cardHolder: 'Nome no cartão',
  cardExpiration: 'Validade do cartão',
  cardCvv: 'CVV do cartão',
  cvv: 'CVV',
};

function labelFor(property: string): string {
  return FIELD_LABELS[property] ?? property;
}

/** Traduz uma constraint do class-validator para PT-BR usando o rótulo do campo. */
function translate(constraintKey: string, rawMessage: string, label: string): string {
  switch (constraintKey) {
    case 'isNotEmpty':
      return `${label} é obrigatório.`;
    case 'isDefined':
      return `${label} é obrigatório.`;
    case 'isEmail':
      return `${label} deve ser um e-mail válido.`;
    case 'isString':
      return `${label} deve ser um texto.`;
    case 'isInt':
      return `${label} deve ser um número inteiro.`;
    case 'isNumber':
      return `${label} deve ser um número.`;
    case 'isPositive':
      return `${label} deve ser maior que zero.`;
    case 'isBoolean':
      return `${label} deve ser verdadeiro ou falso.`;
    case 'isEnum':
      return `${label} tem um valor inválido.`;
    case 'isArray':
      return `${label} deve ser uma lista.`;
    case 'isDateString':
      return `${label} deve ser uma data válida.`;
    case 'min':
      return `${label} está abaixo do valor mínimo permitido.`;
    case 'max':
      return `${label} está acima do valor máximo permitido.`;
    case 'minLength':
      return `${label} está muito curto.`;
    case 'maxLength':
      return `${label} está muito longo.`;
    case 'whitelistValidation':
      return `${label} não é um campo permitido.`;
    default: {
      // Fallback: traduz as frases inglesas mais comuns, mantendo o rótulo.
      const m = String(rawMessage ?? '')
        .replace(/should not be empty/i, 'é obrigatório')
        .replace(/must be an email/i, 'deve ser um e-mail válido')
        .replace(/must be a string/i, 'deve ser um texto')
        .replace(/must be a number.*/i, 'deve ser um número')
        .replace(/must be an integer.*/i, 'deve ser um número inteiro')
        .replace(/must be a boolean.*/i, 'deve ser verdadeiro ou falso')
        .replace(/must be one of the following values.*/i, 'tem um valor inválido')
        .replace(/must not be less than/i, 'não pode ser menor que')
        .replace(/must not be greater than/i, 'não pode ser maior que');
      // Substitui o nome cru do campo (início da mensagem) pelo rótulo amigável.
      return m.replace(new RegExp(`^${label}\\b`, 'i'), label);
    }
  }
}

function collectMessages(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const label = labelFor(err.property);
    if (err.constraints) {
      for (const key of Object.keys(err.constraints)) {
        out.push(translate(key, err.constraints[key], label));
      }
    }
    if (err.children && err.children.length > 0) {
      out.push(...collectMessages(err.children));
    }
  }
  return out;
}

/**
 * exceptionFactory do ValidationPipe global — devolve as mensagens de validação em PT-BR.
 * (O padrão do class-validator vem em inglês, ex.: "customerDocument should not be empty".)
 */
export function ptbrValidationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const messages = collectMessages(errors);
  return new BadRequestException(messages.length > 0 ? messages : ['Dados inválidos.']);
}
