export type BoletoStatus = 'Ativo' | 'Inativo';

export type BoletoRow = {
  id: string;
  titulo: string;
  valor: number;
  criadoPor: string;
  criadoPorEmail?: string | null;
  status: BoletoStatus;
  link: string | null;
  cpfDono: string | null;
  plataformas: string[];
};

export type BoletoFilters = {
  titulo: string;
  platform: string;
};
