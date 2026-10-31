import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type {
  PaymentLinkFile,
  PaymentLinkOffer,
  PaymentLinkOfferType,
} from '@/app/(dashboard)/links-pagamento/types';

export async function uploadPaymentLinkFiles(
  api: ApiClient,
  linkId: string,
  files: File[],
): Promise<{ files: PaymentLinkFile[] }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post<{ files: PaymentLinkFile[] }>(
    endpoints.linksPagamento.uploadFiles(linkId),
    formData,
  );
}

export async function deletePaymentLinkFile(
  api: ApiClient,
  linkId: string,
  fileId: string,
): Promise<void> {
  await api.delete(endpoints.linksPagamento.deleteFile(linkId, fileId));
}

export type SavePaymentLinkOfferInput = {
  id?: string;
  tipo: PaymentLinkOfferType;
  chamada?: string | null;
  titulo: string;
  descricao?: string | null;
  imagemUrl?: string | null;
  mensagemEmail?: string | null;
  valor: number;
  valorOriginal?: number | null;
  ativo?: boolean;
};

/** Substitui o conjunto de ofertas do link. Ofertas omitidas são desativadas no backend (nunca apagadas). */
export async function savePaymentLinkOffers(
  api: ApiClient,
  linkId: string,
  ofertas: SavePaymentLinkOfferInput[],
): Promise<{ data: PaymentLinkOffer[] }> {
  return api.put<{ data: PaymentLinkOffer[] }>(
    endpoints.linksPagamento.offers(linkId),
    { ofertas },
  );
}

export async function uploadPaymentLinkOfferImage(
  api: ApiClient,
  linkId: string,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post<{ url: string }>(
    endpoints.linksPagamento.offerImage(linkId),
    formData,
  );
  return res.url;
}

export async function uploadPaymentLinkOfferFiles(
  api: ApiClient,
  linkId: string,
  offerId: string,
  files: File[],
): Promise<{ files: PaymentLinkFile[] }> {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  return api.post<{ files: PaymentLinkFile[] }>(
    endpoints.linksPagamento.offerFiles(linkId, offerId),
    formData,
  );
}

export async function deletePaymentLinkOfferFile(
  api: ApiClient,
  linkId: string,
  offerId: string,
  fileId: string,
): Promise<void> {
  await api.delete(
    endpoints.linksPagamento.deleteOfferFile(linkId, offerId, fileId),
  );
}
