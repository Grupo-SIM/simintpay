export type MaquinetaTransacao = {
  id: string;
  domPaymentId: string | null;
  terminal: string;
  amount: number;
  netbalancemachine: number;
  status: string;
  paymentMethod: string;
  cardBrand: string | null;
  cardBin: string | null;
  installments: number;
  customerName: string | null;
  customerDocument: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  domTransactionId: string | null;
  statusDetails: string | null;
  createdAt: string;
};

export type ListMaquinetasResponse = {
  transactions: MaquinetaTransacao[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SyncMaquinetasResponse = {
  synced: number;
  skipped: number;
  errors: number;
  totalAmount: number;
  message: string;
};
