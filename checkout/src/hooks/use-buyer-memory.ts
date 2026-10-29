'use client';

import { useEffect, useRef, useState } from 'react';
import {
  readBuyerMemory,
  writeBuyerMemory,
  type BuyerContact,
} from '@/lib/buyer-memory';

/** Restores the buyer's contact on mount and saves every change, in this browser only. */
export function useBuyerMemory(
  contact: BuyerContact,
  restore: (saved: BuyerContact) => void,
) {
  const [ready, setReady] = useState(false);
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    // localStorage only exists in the browser, so it is read after hydration to avoid SSR mismatch.
    const saved = readBuyerMemory();
    if (saved) restoreRef.current(saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => writeBuyerMemory(contact), 400);
    return () => window.clearTimeout(timer);
  }, [ready, contact.name, contact.email, contact.document, contact.phone]);
}
