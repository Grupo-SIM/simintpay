import type { ApiClient } from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import type { PaginatedResponse } from '@/services/api/types';

import type {
  CreateSaqueDto,
  ListSaquesQuery,
  Saque,
} from '../types/saque.types';

export async function listSaques(api: ApiClient, query: ListSaquesQuery) {
  return api.get<PaginatedResponse<Saque>>(endpoints.saque.list, { query });
}

export async function createSaque(api: ApiClient, dto: CreateSaqueDto) {
  return api.post<Saque>(endpoints.saque.create, dto);
}
