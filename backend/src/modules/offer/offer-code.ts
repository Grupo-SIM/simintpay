import { randomInt } from 'node:crypto';

// Sem 0/O/1/I/L para evitar confusão ao ditar ou digitar o código.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Código público curto e imprevisível; a unicidade é garantida pelo serviço. */
export function generateOfferCode(length = 10): string {
  let code = '';
  for (let i = 0; i < length; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
