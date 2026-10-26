type CheckoutFields = {
  name: string;
  document: string;
  phone: string;
  email: string;
  cep?: string;
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
};

export function validateBoletoCheckout(fields: CheckoutFields) {
  const documentLength = fields.document.replace(/\D/g, '').length;
  const phoneLength = fields.phone.replace(/\D/g, '').length;
  return {
    dadosOk:
      fields.name.trim().length >= 3 &&
      (documentLength === 11 || documentLength === 14) &&
      (phoneLength === 10 || phoneLength === 11) &&
      /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(fields.email.trim()),
    enderecoOk:
      (fields.cep ?? '').replace(/\D/g, '').length === 8 &&
      (fields.rua ?? '').trim().length >= 2 &&
      (fields.numero ?? '').trim().length >= 1 &&
      (fields.bairro ?? '').trim().length >= 2 &&
      (fields.cidade ?? '').trim().length >= 2 &&
      /^[A-Za-z]{2}$/.test((fields.uf ?? '').trim()),
  };
}
