/** Legacy PIX descriptions may contain routing metadata; keep it outside editable text. */
export function splitPixDescription(description: string | null | undefined) {
  const metadata =
    description?.match(/\[(?:CPF_DONO|CPF|TENANT|NOME_DONO):[^\]]*\]/gi) ?? [];
  const text = (description ?? '')
    .replace(/\s*\[(?:CPF_DONO|CPF|TENANT|NOME_DONO):[^\]]*\]/gi, '')
    .trim();
  return { text, metadata };
}

export function editedPixDescription(
  text: string,
  original: string | null | undefined,
) {
  const { metadata } = splitPixDescription(original);
  return [text.trim(), ...metadata].filter(Boolean).join(' ');
}
