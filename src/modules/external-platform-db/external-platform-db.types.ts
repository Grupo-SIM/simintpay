/**
 * Tipos para a listagem de usuários lidos diretamente dos bancos de cada
 * plataforma externa (Atlas, EbookSim, Revalida, Patrimonial, Pagatg, Areaflix).
 *
 * Esses bancos NÃO pertencem ao simpay — são lidos somente leitura via pool `pg`
 * dedicado (ver external-platform-db.service.ts). Nenhuma escrita é feita aqui.
 */

export type ExternalPlatformSlug =
  | 'atlas'
  | 'ebooksim'
  | 'revalida'
  | 'patrimonial'
  | 'pagatg'
  | 'areaflix';

export interface ExternalPlatformPerson {
  id: string;
  name: string | null;
  email: string | null;
  cpf?: string | null;
  cnpj?: string | null;
  isActive?: boolean | null;
  createdAt?: Date | null;
}

/**
 * Resultado de uma plataforma: separa quem é operador/vendedor (dono ou
 * afiliado que recebe comissão) de quem é usuário comum (cliente final).
 *
 * Em Atlas/EbookSim/Revalida/Patrimonial, vendedor e usuário comum vivem na
 * MESMA tabela (`users`), diferenciados por role ou por ter comissão.
 * Em Pagatg/Areaflix, vivem em tabelas DIFERENTES (User vs CustomerTelegram/
 * Customer) — o operador é sempre quem roda o SaaS, o cliente final é quem
 * assina/compra.
 */
export interface ExternalPlatformUsersResult {
  platform: ExternalPlatformSlug;
  vendedores: ExternalPlatformPerson[];
  usuariosComuns: ExternalPlatformPerson[];
  /** true quando a plataforma separa as duas listas em tabelas distintas (Pagatg, Areaflix) */
  tabelasSeparadas: boolean;
}
