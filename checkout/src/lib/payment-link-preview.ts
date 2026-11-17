export function allowedPreviewOrigins(
  config: string | undefined,
  development: boolean,
): string[] {
  return (config ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => {
      try {
        const url = new URL(origin);
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(
          url.hostname,
        );
        return (
          url.origin === origin &&
          !url.username &&
          !url.password &&
          (local
            ? development &&
              ['http:', 'https:'].includes(url.protocol) &&
              url.hostname !== '[::1]'
            : url.protocol === 'https:')
        );
      } catch {
        return false;
      }
    });
}
export function isAllowedPreviewParent(
  origin: string,
  config: string | undefined,
  development: boolean,
): boolean {
  if (allowedPreviewOrigins(config, development).includes(origin)) return true;
  if (!development) return false;
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      ['http:', 'https:'].includes(url.protocol)
    );
  } catch {
    return false;
  }
}

/** Default is the dashboard origin; explicit empty configuration denies all parents. */
export const DEFAULT_PREVIEW_PARENT_ORIGIN = 'https://simintpay.com';

export function configuredPreviewParents() {
  return allowedPreviewOrigins(
    process.env.CHECKOUT_PREVIEW_PARENT_ORIGINS ??
      DEFAULT_PREVIEW_PARENT_ORIGIN,
    process.env.NODE_ENV === 'development',
  );
}

export function previewFramePolicy(origins: string[], development: boolean) {
  const ancestors = [
    ...origins,
    ...(development
      ? [
          'http://localhost:*',
          'https://localhost:*',
          'http://127.0.0.1:*',
          'https://127.0.0.1:*',
        ]
      : []),
  ];
  return `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"}`;
}
