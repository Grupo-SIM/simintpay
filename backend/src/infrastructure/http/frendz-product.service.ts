import { getPlatformIntegrationValue } from '../../modules/platform-integrations/platform-integrations.store';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';
import { FRENDZ_API_BASE_URL } from '../../modules/frendz/frendz.config';

/**
 * ──────────────────────────────────────────────────────────────────────────
 * FrendzProductService — ponte entre o modelo da plataforma e o da Frendz.
 *
 * A plataforma cobra valores avulsos (como a DOM faz). A Frendz, porém, exige
 * um `offer_hash` em toda transação: você só cobra "uma oferta de um produto".
 *
 * Para não vazar esse conceito para os use-cases, este service garante — de
 * forma idempotente e cacheada — um PRODUTO "guarda-chuva" e uma OFERTA por
 * conta Frendz (identificada pelo api_token). O hash da oferta resultante é o
 * que o FrendzClient passa em `POST /transactions`.
 *
 * O valor real da cobrança vai sempre no campo `amount` da transação — a
 * oferta serve apenas como "container" exigido pela API. Por isso uma única
 * oferta atende qualquer valor.
 * ──────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class FrendzProductService {
  private readonly logger = new Logger(FrendzProductService.name);

  /** Cache em memória: api_token → offer_hash já resolvido. */
  private readonly offerHashCache = new Map<string, string>();

  /** Título do produto guarda-chuva criado automaticamente. */
  private static readonly UMBRELLA_PRODUCT_TITLE = 'Checkout (Sim Int Pay)';
  private static readonly UMBRELLA_OFFER_TITLE = 'Cobrança avulsa';

  constructor(private readonly http: HttpService) {}

  /**
   * Devolve um `offer_hash` válido para a conta do token informado, criando o
   * produto/oferta guarda-chuva na primeira vez. Resultado é cacheado em
   * memória por token.
   *
   * Permite override explícito por env (`{...}_FRENDZ_OFFER_HASH`) — útil se a
   * loja já tem uma oferta criada manualmente no painel e prefere reusá-la.
   */
  async resolveOfferHash(apiToken: string, slug?: string | null): Promise<string> {
    const envOverride = this.offerHashFromEnv(slug);
    if (envOverride) return envOverride;

    const cached = this.offerHashCache.get(apiToken);
    if (cached) return cached;

    // 1) Tenta reaproveitar um produto guarda-chuva já existente na conta.
    let productHash = await this.findUmbrellaProduct(apiToken);

    // 2) Se não existe, cria.
    if (!productHash) {
      productHash = await this.createUmbrellaProduct(apiToken);
    }

    // 3) Garante uma oferta para esse produto e pega o hash dela.
    const offerHash = await this.resolveOfferForProduct(apiToken, productHash);

    this.offerHashCache.set(apiToken, offerHash);
    this.logger.log(`[Frendz] offer_hash resolvido: ${offerHash}`);
    return offerHash;
  }

  private offerHashFromEnv(slug?: string | null): string | null {
    if (slug) return getPlatformIntegrationValue(slug, 'OFFER_HASH');
    const global = (getPlatformIntegrationValue('FRENDZ', 'OFFER_HASH') ?? undefined);
    return global && global.length > 0 ? global : null;
  }

  private authParams(apiToken: string): Record<string, string> {
    return { api_token: apiToken };
  }

  private async findUmbrellaProduct(apiToken: string): Promise<string | null> {
    try {
      const res = await firstValueFrom(
        this.http.get<any>(`${FRENDZ_API_BASE_URL}/products`, {
          params: this.authParams(apiToken),
        }),
      );
      const list: any[] = res.data?.data ?? res.data?.products ?? res.data ?? [];
      const found = Array.isArray(list)
        ? list.find(
            (p) => (p?.title ?? p?.name) === FrendzProductService.UMBRELLA_PRODUCT_TITLE,
          )
        : null;
      const hash = found?.hash ?? found?.id ?? null;
      return hash ? String(hash) : null;
    } catch (err) {
      this.logger.warn(`[Frendz] Falha ao listar produtos: ${this.errMsg(err)}`);
      return null;
    }
  }

  private async createUmbrellaProduct(apiToken: string): Promise<string> {
    const body = {
      title: FrendzProductService.UMBRELLA_PRODUCT_TITLE,
      product_type: 'digital',
      payment_type: 1, // pagamento único
      delivery_type: 2, // entrega externa (área fora da Frendz)
      amount: 100, // R$ 1,00 em centavos — placeholder; o valor real vai na transação
    };
    const res = await firstValueFrom(
      this.http.post<any>(`${FRENDZ_API_BASE_URL}/products`, body, {
        params: this.authParams(apiToken),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      }),
    );
    const root = res.data?.data ?? res.data;
    const hash = root?.hash ?? root?.id;
    if (!hash) throw new Error('Frendz: criação de produto não retornou hash');
    this.logger.log(`[Frendz] produto guarda-chuva criado: ${hash}`);
    return String(hash);
  }

  private async resolveOfferForProduct(
    apiToken: string,
    productHash: string,
  ): Promise<string> {
    // A criação de produto às vezes já devolve uma oferta default; tentamos
    // criar uma explícita e, se a API recusar por duplicidade, relistar.
    try {
      const res = await firstValueFrom(
        this.http.post<any>(
          `${FRENDZ_API_BASE_URL}/products/${productHash}/offers`,
          {
            title: FrendzProductService.UMBRELLA_OFFER_TITLE,
            amount: 100, // placeholder; valor real vai na transação
          },
          {
            params: this.authParams(apiToken),
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          },
        ),
      );
      const root = res.data?.data ?? res.data;
      const hash = root?.hash ?? root?.id;
      if (hash) return String(hash);
    } catch (err) {
      this.logger.warn(
        `[Frendz] criação de oferta falhou (${this.errMsg(err)}); tentando reusar produto`,
      );
    }

    // Fallback: consulta o produto e usa a primeira oferta existente.
    const res = await firstValueFrom(
      this.http.get<any>(`${FRENDZ_API_BASE_URL}/products/${productHash}`, {
        params: this.authParams(apiToken),
      }),
    );
    const root = res.data?.data ?? res.data;
    const offers: any[] = root?.offers ?? [];
    const offerHash = offers?.[0]?.hash ?? offers?.[0]?.id;
    if (!offerHash) {
      throw new Error(
        `Frendz: não foi possível resolver uma oferta para o produto ${productHash}`,
      );
    }
    return String(offerHash);
  }

  private errMsg(err: unknown): string {
    const ax = err as AxiosError<any>;
    return (
      ax?.response?.data?.message ??
      ax?.response?.data?.error ??
      (err as Error)?.message ??
      'erro desconhecido'
    );
  }
}
