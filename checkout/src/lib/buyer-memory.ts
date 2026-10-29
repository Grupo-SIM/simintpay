export const BUYER_MEMORY_KEY = 'simintpay:buyer-contact:v2';

export type BuyerContact = {
  name: string;
  email: string;
  document: string;
  phone: string;
};

const limits: Record<keyof BuyerContact, number> = {
  name: 200,
  email: 254,
  document: 18,
  phone: 20,
};

// Never spread a form or a parsed record into storage: this is the entire allowlist.
export function contactOnly(value: BuyerContact): BuyerContact {
  return {
    name: value.name.slice(0, limits.name),
    email: value.email.slice(0, limits.email),
    document: value.document.slice(0, limits.document),
    phone: value.phone.slice(0, limits.phone),
  };
}

export function readBuyerMemory(): BuyerContact | null {
  try {
    const raw = window.localStorage.getItem(BUYER_MEMORY_KEY);
    if (!raw || raw.length > 2048) return null;
    const value = JSON.parse(raw);
    const contact = value?.contact;
    if (
      value?.version !== 2 ||
      !contact ||
      typeof contact !== 'object' ||
      Array.isArray(contact) ||
      !Object.entries(limits).every(
        ([key, limit]) =>
          typeof contact[key] === 'string' && contact[key].length <= limit,
      )
    )
      return null;
    return contactOnly(contact);
  } catch {
    return null;
  }
}

export function writeBuyerMemory(contact: BuyerContact): boolean {
  try {
    window.localStorage.setItem(
      BUYER_MEMORY_KEY,
      JSON.stringify({ version: 2, contact: contactOnly(contact) }),
    );
    return true;
  } catch {
    return false;
  }
}
