import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class CpfLookupService {
  private readonly logger = new Logger(CpfLookupService.name);
  private readonly cache = new Map<string, string>();

  constructor(private readonly http: HttpService) {}

  /**
   * Busca o nome do titular de um CPF via BrasilAPI.
   * Retorna null se não encontrar ou ocorrer erro.
   */
  async lookupName(cpf: string): Promise<string | null> {
    const cleaned = cpf.replace(/\D/g, '');
    if (cleaned.length !== 11) return null;

    if (this.cache.has(cleaned)) {
      return this.cache.get(cleaned)!;
    }

    try {
      const res = await firstValueFrom(
        this.http.get<any>(`https://brasilapi.com.br/api/cpf/v1/${cleaned}`, {
          timeout: 8000,
          headers: { Accept: 'application/json' },
        }),
      );
      const name: string | undefined = res.data?.nome || res.data?.name;
      if (name) {
        this.cache.set(cleaned, name);
        return name;
      }
    } catch (err: any) {
      this.logger.warn(`CPF lookup falhou para ${cleaned}: ${err?.message}`);
    }

    return null;
  }
}
