export function sanitizeCheckoutText(text: string | null | undefined): string {
  if (!text) return '';
  return (
    text
      .replace(/\[TENANT:[^\]]*\]/gi, '')
      .replace(/\[CPF_DONO:[^\]]*\]/gi, '')
      .replace(/\[NOME_DONO:[^\]]*\]/gi, '')
      .replace(/\[CPF:[^\]]*\]/gi, '')
      .replace(/\[ORIGEM:[^\]]*\]/gi, '')
      // Remove padrão de 11 dígitos (CPF) com ou sem pontuação
      .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '')
      .replace(/pagatg/gi, '')
      .replace(/ebook/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}
