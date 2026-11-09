'use client';

import type { ReactNode } from 'react';
import { useCurrentUser } from '@/hooks/use-current-user';
import ClienteLayout from '../cliente/layout';

/** Offers are open to every account; clients still wait for approval. */
export default function OfferAccessLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useCurrentUser();
  if (user && !user.isClient) return <>{children}</>;
  return <ClienteLayout>{children}</ClienteLayout>;
}
