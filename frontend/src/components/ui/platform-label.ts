const platformLabels: Record<string, string> = {
  SIMINTPAY: 'Sim Int Pay',
  GLOBAL: 'Sim Int Pay',
  AREAFLIX: 'Áreaflix',
  EBOOKSIM: 'EbookSim',
  EBOOK: 'EbookSim',
  ATLAS: 'AtlasHosting',
};

export function platformLabel(tag: string) {
  return platformLabels[tag.toUpperCase()] ?? tag;
}
