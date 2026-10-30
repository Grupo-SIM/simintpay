/**
 * Normaliza a tag de um produto (front) para a tag canônica usada pelo backend
 * no consolidado (`lucroSimpayDetalhe.plataformas[].tag`).
 *
 * Espelha o `normalizePlatformTag` do api-machine: o produto "EbookSim" usa a
 * tag "EBOOKSIM" no front, mas o consolidado agrega como "EBOOK" — sem essa
 * normalização o find retorna null e cards como "Receita Total" mostram R$ 0,00
 * mesmo com vendas no período.
 */
export function consolidadoTagFor(produtoTag: string): string {
  const upper = String(produtoTag || '')
    .toUpperCase()
    .replaceAll('_', '-');
  if (upper === 'EBOOKSIM' || upper === 'EBOOK') return 'EBOOK';
  if (upper === 'CONTROLE_MOTORISTA' || upper === 'CONTROLE-MOTORISTA')
    return 'CONTROLE-MOTORISTA';
  if (upper === 'CONTROLE_PATRIMONIAL' || upper === 'CONTROLE-PATRIMONIAL')
    return 'CONTROLE-PATRIMONIAL';
  return upper;
}

/** Localiza a entrada da plataforma no detalhe do consolidado, tolerante a aliases (EBOOKSIM ≡ EBOOK). */
export function findPlataformaDetalheByTag<T extends { tag: string }>(
  plataformas: T[] | null | undefined,
  produtoTag: string,
): T | null {
  const canonical = consolidadoTagFor(produtoTag);
  return (
    plataformas?.find((p) => consolidadoTagFor(p.tag) === canonical) ?? null
  );
}
