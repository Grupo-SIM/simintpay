import { describe, expect, test } from 'bun:test';
import { OfferAssetsService, fulfillmentFileId } from './offer-assets.service';

type Row = { id: string; ownerUserId: string; fulfillment: unknown };

function build(row: Row) {
  const deleted: string[] = [];
  const prisma = {
    offer: {
      findUnique: async () => row,
      update: async ({ data }: { data: { fulfillment: unknown } }) => {
        row.fulfillment = data.fulfillment;
        return row;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  let n = 0;
  const storage = {
    uploadFile: async () => `https://gw/obj-${++n}`,
    deleteFile: async (u: string) => void deleted.push(u),
  };
  const service = new OfferAssetsService(prisma as never, storage as never);
  return { service, row, deleted };
}

const pdf = (name: string) =>
  ({ originalname: name, size: 7, mimetype: 'application/pdf' }) as never;
const owner = { id: 'u1', role: 'USER' };

describe('OfferAssetsService', () => {
  test('sobe, lista e remove arquivos pelo id', async () => {
    const { service, deleted } = build({
      id: 'o1',
      ownerUserId: 'u1',
      fulfillment: null,
    });
    const up = await service.uploadFiles(owner, 'o1', [pdf('a.pdf')]);
    expect(up.files).toHaveLength(1);
    expect(up.files[0]).toMatchObject({ fileName: 'a.pdf', fileSize: 7 });
    const after = await service.deleteFile(owner, 'o1', up.files[0].id);
    expect(after.files).toHaveLength(0);
    expect(deleted).toEqual(['https://gw/obj-1']);
  });

  test('limite de arquivos e titularidade', async () => {
    const { service } = build({
      id: 'o1',
      ownerUserId: 'u1',
      fulfillment: null,
    });
    const many = Array.from({ length: 11 }, (_, i) => pdf(`${i}.pdf`));
    await expect(service.uploadFiles(owner, 'o1', many)).rejects.toThrow(
      'Máximo',
    );
    await expect(
      service.listFiles({ id: 'u2', role: 'USER' }, 'o1'),
    ).rejects.toThrow('Oferta não encontrada');
  });

  test('arquivos migrados (sem id) ganham id estável pela URL', async () => {
    const f = { fileName: 'x.pdf', fileUrl: 'https://gw/x.pdf' };
    expect(fulfillmentFileId(f)).toBe(fulfillmentFileId({ ...f }));
    const { service } = build({
      id: 'o1',
      ownerUserId: 'u1',
      fulfillment: { files: [f] },
    });
    const { files } = await service.listFiles(owner, 'o1');
    expect((await service.deleteFile(owner, 'o1', files[0].id)).files).toEqual(
      [],
    );
  });

  test('imagem: troca apaga a anterior, remover limpa', async () => {
    const { service, row, deleted } = build({
      id: 'o1',
      ownerUserId: 'u1',
      fulfillment: null,
    });
    const img = { originalname: 'a.png', mimetype: 'image/png' } as never;
    await service.setImage(owner, 'o1', img);
    await service.setImage(owner, 'o1', img);
    expect(deleted).toEqual(['https://gw/obj-1']);
    await service.removeImage(owner, 'o1');
    expect(deleted).toContain('https://gw/obj-2');
    expect((row.fulfillment as { imageUrl: unknown }).imageUrl).toBeNull();
    await expect(
      service.setImage(owner, 'o1', {
        originalname: 'a.exe',
        mimetype: 'application/x-msdownload',
      } as never),
    ).rejects.toThrow('imagem');
  });
});
