// SDK de tokenização de cartão (gateway de pagamentos — usado pelo checkout Simpay)
import CryptoJS from 'crypto-js';

interface CardData {
  name: string;
  document: string;
  customer_id?: string;
  number: string;
  cvv: string;
  month: string;
  year: any;
}

interface TokenResponse {
  status?: string;
  token?: string;
  brand?: string;
  bin?: string;
  msgError?: string;
}

interface CryptoJsJsonFormat {
  ct: string;
  iv?: string;
  s?: string;
}

const BASE_URL = 'https://apiv3.dompagamentos.com.br';
const VERSION = '3.2.1/RN';

const CryptoJsJson = {
  stringify: function (cipherParams: any): string {
    const jsonData: CryptoJsJsonFormat = {
      ct: cipherParams.ciphertext.toString(CryptoJS.enc.Base64),
    };

    if (cipherParams.iv) {
      jsonData.iv = cipherParams.iv.toString();
    }
    if (cipherParams.salt) {
      jsonData.s = cipherParams.salt.toString();
    }

    return JSON.stringify(jsonData);
  },
  parse: function (jsonStr: string) {
    const jsonData = JSON.parse(jsonStr);

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: CryptoJS.enc.Base64.parse(jsonData.ct),
    });

    if (jsonData.iv) {
      cipherParams.iv = CryptoJS.enc.Hex.parse(jsonData.iv);
    }
    if (jsonData.s) {
      cipherParams.salt = CryptoJS.enc.Hex.parse(jsonData.s);
    }

    return cipherParams;
  },
};

const getEndpoint = (publicKey: string, installments: number): string =>
  `${BASE_URL}/public/gw/${publicKey}/${installments}`;

const getBin = (cardNumber: string): string => {
  const number = cardNumber.replace(/\s/g, '');
  return (
    number.substring(0, 6) + '******' + number.substring(number.length - 4)
  );
};

const validateCardNumber = (number: string): boolean => {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
};

const identifyCardBrand = (number: string): string => {
  const cleanNumber = number.replace(/\D/g, '');
  const patterns = {
    visa: /^4/,
    mastercard: /^5[1-5]/,
    amex: /^3[47]/,
    elo: /^(401178|401179|431274|438935|451416|457393|457631|457632|504175|627780|636297|636368|(506699|5067[0-6]\d|50677[0-8])|(50900\d|5090[1-9]\d|509[1-9]\d{2})|65003[1-3]|(65003[5-9]|65004\d|65005[0-1])|(65040[5-9]|6504[1-3]\d)|(65048[5-9]|65049\d|6505[0-2]\d|65053[0-8])|(65054[1-9]|6505[5-8]\d|65059[0-8])|(65070\d|65071[0-8])|65072[0-7]|(65090[1-9]|65091\d|650920)|(65165[2-9]|6516[6-7]\d)|(65500\d|65501\d)|(65502[1-9]|6550[3-4]\d|65505[0-8]))/,
    hipercard: /^(606282\d{10}(\d{3})?)|(3841\d{15})/,
    diners: /^3(?:0[0-5]|[68][0-9])[0-9]/,
  };

  for (const [brand, pattern] of Object.entries(patterns)) {
    if (pattern.test(cleanNumber)) return brand;
  }
  return 'unknown';
};

const validateCardData = (cardData: CardData): string | null => {
  if (!cardData.name || cardData.name.length < 3) {
    return 'Nome inválido';
  }
  if (!cardData.document || cardData.document.replace(/\D/g, '').length < 11) {
    return 'Documento inválido';
  }
  if (!validateCardNumber(cardData.number)) {
    return 'Número de cartão inválido';
  }
  if (!cardData.cvv || cardData.cvv.length < 3) {
    return 'CVV inválido';
  }
  if (!cardData.month || !cardData.year) {
    return 'Data de validade inválida';
  }
  return null;
};

const encryptData = (data: CardData, publicKey: string): string => {
  const jsonString = JSON.stringify(data);
  return CryptoJS.AES.encrypt(jsonString, publicKey, {
    format: CryptoJsJson,
  }).toString();
};

const formatCardData = (cardData: CardData): CardData => ({
  name: cardData.name,
  document: cardData.document.replace(/\D/g, ''),
  customer_id: cardData.customer_id || '',
  number: cardData.number.replace(/\s/g, ''),
  cvv: cardData.cvv.replace(/\s/g, ''),
  month: cardData.month,
  year:
    parseInt(cardData.year) < 100
      ? parseInt(cardData.year) + 2000
      : parseInt(cardData.year),
});

const getTokenCard = async (
  publicKey: string,
  cardData: CardData,
  installments: number = 1,
): Promise<TokenResponse> => {
  try {
    if (!publicKey) {
      throw new Error('Public key is required');
    }

    const validationError = validateCardData(cardData);
    if (validationError) {
      return {
        status: 'FAIL',
        msgError: validationError,
      };
    }

    const cardDataFormatted = formatCardData(cardData);
    const brand = identifyCardBrand(cardDataFormatted.number);
    const bin = getBin(cardDataFormatted.number);

    const encrypted = encryptData(cardDataFormatted, publicKey);

    const response = await fetch(getEndpoint(publicKey, installments), {
      method: 'POST',
      body: JSON.stringify({ encrypted }),
      headers: {
        'Content-type': 'application/json; charset=UTF-8',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.msg || 'Failed to get token');
    }

    return {
      ...data,
      brand,
      bin,
    };
  } catch (error) {
    return {
      status: 'FAIL',
      msgError:
        error instanceof Error
          ? error.message
          : 'Não foi possível gerar o token!',
    };
  }
};

export { getTokenCard };
