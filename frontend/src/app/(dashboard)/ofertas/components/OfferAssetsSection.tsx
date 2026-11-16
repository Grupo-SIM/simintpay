'use client';

import { useRef, useState } from 'react';
import { FileText, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { getDefaultApiBaseUrl } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useClienteApi } from '../../cliente/_shared';
import { OFFERS_QUERY_KEY } from '../offers';

type FileView = { id: string; fileName: string; fileSize: number | null };

const MAX_FILES = 10;

const sizeLabel = (bytes: number | null) =>
  bytes == null
    ? ''
    : bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** PDFs entregues ao comprador e imagem exibida quando a oferta é vendida como bump/upsell/downsell. */
export function OfferAssetsSection({
  offerId,
  offerCode,
  hasImage,
}: {
  offerId: string | null;
  offerCode: string | null;
  hasImage: boolean;
}) {
  const api = useClienteApi();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<{ has: boolean; version: number }>({
    has: hasImage,
    version: 0,
  });
  const filesKey = [OFFERS_QUERY_KEY, 'files', offerId];
  const files = useQuery({
    queryKey: filesKey,
    enabled: Boolean(offerId),
    queryFn: () =>
      api.get<{ files: FileView[] }>(endpoints.ofertas.files(offerId!)),
  });

  if (!offerId)
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Salve a oferta para anexar PDFs de entrega e a imagem do funil.
      </p>
    );

  const list = files.data?.files ?? [];
  async function run(action: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      void queryClient.invalidateQueries({ queryKey: [OFFERS_QUERY_KEY] });
    } catch (error) {
      toast({
        type: 'error',
        title: 'Erro',
        description: error instanceof Error ? error.message : failure,
      });
    } finally {
      setBusy(false);
    }
  }

  const upload = (picked: FileList | null) => {
    if (!picked?.length) return;
    const body = new FormData();
    for (const file of Array.from(picked)) body.append('files', file);
    void run(async () => {
      const res = await api.post<{ files: FileView[] }>(
        endpoints.ofertas.files(offerId),
        body,
      );
      queryClient.setQueryData(filesKey, res);
    }, 'Não foi possível enviar os arquivos.');
    if (fileInput.current) fileInput.current.value = '';
  };

  const uploadImage = (picked: FileList | null) => {
    const file = picked?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    void run(async () => {
      await api.post(endpoints.ofertas.image(offerId), body);
      setImage((current) => ({ has: true, version: current.version + 1 }));
    }, 'Não foi possível enviar a imagem.');
    if (imageInput.current) imageInput.current.value = '';
  };

  return (
    <div className="grid gap-5" data-testid="offer-assets">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Arquivos entregues por e-mail (PDF, até 25 MB cada)
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={busy || list.length >= MAX_FILES}
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden className="h-4 w-4" />
            Enviar PDF
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="application/pdf"
            onChange={(event) => upload(event.target.files)}
          />
        </div>
        {files.isError && (
          <p role="alert" className="text-sm text-red-600">
            Não foi possível carregar os arquivos.
          </p>
        )}
        {list.length > 0 && (
          <ul className="flex flex-col gap-2">
            {list.map((file) => (
              <li
                key={file.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText aria-hidden className="h-4 w-4 shrink-0" />
                  <span className="truncate">{file.fileName}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {sizeLabel(file.fileSize)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Remover ${file.fileName}`}
                  className="cursor-pointer"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const res = await api.delete<{ files: FileView[] }>(
                        endpoints.ofertas.file(offerId, file.id),
                      );
                      queryClient.setQueryData(filesKey, res);
                    }, 'Não foi possível remover o arquivo.')
                  }
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Imagem no checkout (PNG, JPG, WEBP ou GIF, até 5 MB)
        </span>
        <div className="flex items-center gap-3">
          {image.has && offerCode && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${getDefaultApiBaseUrl()}${endpoints.ofertas.publicImage(offerCode)}?v=${image.version}`}
              alt="Imagem da oferta"
              className="h-16 w-16 rounded-lg border border-zinc-200 object-cover dark:border-white/10"
            />
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={busy}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus aria-hidden className="h-4 w-4" />
            {image.has ? 'Trocar imagem' : 'Enviar imagem'}
          </Button>
          {image.has && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.delete(endpoints.ofertas.image(offerId));
                  setImage({ has: false, version: 0 });
                }, 'Não foi possível remover a imagem.')
              }
            >
              <Trash2 aria-hidden className="h-4 w-4" />
              Remover
            </Button>
          )}
          <input
            ref={imageInput}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => uploadImage(event.target.files)}
          />
        </div>
      </div>
    </div>
  );
}
