// Public browser configuration; never place private gateway credentials here.
export const SIM_API_URL = (
  process.env.NEXT_PUBLIC_SIM_API_URL ||
  'https://simpay-back.simintermediacoes.com'
).replace(/\/$/, '');
export const PAGATG_API_URL = (
  process.env.NEXT_PUBLIC_API_PAGATG_URL || 'https://api-bot.jbmidia.com'
).replace(/\/$/, '');
export const EBOOK_API_URL = (
  process.env.NEXT_PUBLIC_EBOOK_API_URL || 'https://back.ebooksim.com'
).replace(/\/$/, '');
