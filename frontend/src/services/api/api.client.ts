import { ApiError } from './types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type ApiClientOptions = {
  baseUrl: string;
  getToken?: () => string | undefined | null;
};

type RequestOptions = {
  method?: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  token?: string;
  headers?: HeadersInit;
  cache?: RequestCache;
  next?: NextFetchRequestConfig;
  signal?: AbortSignal;
};

function buildQuery(query?: RequestOptions['query']) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(opts: RequestOptions): Promise<T> {
    const token = opts.token ?? options.getToken?.() ?? undefined;

    const url = `${options.baseUrl}${opts.path}${buildQuery(opts.query)}`;

    const isFormData = opts.body instanceof FormData;

    const headers: HeadersInit = {
      Accept: 'application/json',
      ...(opts.body && !isFormData
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    };

    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body:
        opts.body instanceof FormData
          ? opts.body
          : opts.body
            ? JSON.stringify(opts.body)
            : undefined,
      cache: opts.cache,
      next: opts.next,
      signal: opts.signal,
    });

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const data: unknown = isJson
      ? await res.json().catch(() => undefined)
      : await res.text();

    if (!res.ok) {
      const message =
        typeof data === 'object' && data && 'message' in data
          ? Array.isArray(data.message)
            ? data.message.join(', ')
            : String(data.message)
          : `HTTP ${res.status}`;
      throw new ApiError(message, res.status, data);
    }

    return data as T;
  }

  return {
    request,
    get: <T>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
      request<T>({ ...opts, path, method: 'GET' }),
    post: <T>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'POST', body }),
    put: <T>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'PUT', body }),
    patch: <T>(
      path: string,
      body?: unknown,
      opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
    ) => request<T>({ ...opts, path, method: 'PATCH', body }),
    delete: <T>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
      request<T>({ ...opts, path, method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function getDefaultApiBaseUrl() {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url)
    throw new Error('NEXT_PUBLIC_API_BASE_URL não está definida no .env');
  return url;
}
