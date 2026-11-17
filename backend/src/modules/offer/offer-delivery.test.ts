import { expect, mock, test } from 'bun:test';
import { sendLinkDelivery } from './offer-delivery';

test('upsell sem material não envia e-mail', async () => {
  const email: any = {
    sendEbookAccessEmail: mock(async () => {}),
    sendPaymentLinkFiles: mock(async () => {}),
    sendPaymentLinkConfirmation: mock(async () => {}),
  };
  const sent = await sendLinkDelivery(
    { email },
    { email: 'a@x.com', name: 'A', transactionId: 't' },
    {
      kind: 'OFFER',
      title: 'X',
      body: null,
      redirectUrl: null,
      files: [],
      items: [],
    },
  );
  expect(sent).toBe(false);
  expect(email.sendEbookAccessEmail).not.toHaveBeenCalled();
});

test('sendLinkDelivery preserva os formatos antigos do link (só PDFs / só redirect)', async () => {
  const email: any = {
    sendEbookAccessEmail: mock(async () => {}),
    sendPaymentLinkFiles: mock(async () => {}),
    sendPaymentLinkConfirmation: mock(async () => {}),
  };
  const storage: any = {
    getReceiptBufferByStoredUrl: async () => ({ buffer: Buffer.from('%PDF') }),
  };
  const to = { email: 'a@x.com', name: null, transactionId: 't' };
  await sendLinkDelivery({ email, storage }, to, {
    kind: 'MAIN',
    title: 'L',
    body: null,
    redirectUrl: null,
    files: [{ fileName: 'a.pdf', fileUrl: 'u' }],
    items: [],
  });
  await sendLinkDelivery({ email, storage }, to, {
    kind: 'MAIN',
    title: 'L',
    body: null,
    redirectUrl: 'https://r',
    files: [],
    items: [],
  });
  expect(email.sendPaymentLinkFiles).toHaveBeenCalledTimes(1);
  expect(email.sendPaymentLinkConfirmation).toHaveBeenCalledTimes(1);
  expect(email.sendEbookAccessEmail).not.toHaveBeenCalled();
});
