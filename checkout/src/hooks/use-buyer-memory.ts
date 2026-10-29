'use client';

import { useEffect, useRef, useState } from 'react';
import {
  readBuyerMemory,
  removeBuyerMemory,
  writeBuyerMemory,
  type BuyerContact,
} from '@/lib/buyer-memory';

/**
 * Restores the buyer's contact on mount and, only while the buyer has consented,
 * saves every change in this browser. Unchecking the consent deletes the saved data.
 */
export function useBuyerMemory(
  contact: BuyerContact,
  restore: (saved: BuyerContact) => void,
) {
  const [remember, setRemember] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    // localStorage only exists in the browser, so it is read after hydration to avoid SSR mismatch.
    // A saved record only exists because the buyer consented earlier.
    const saved = readBuyerMemory();
    if (saved) {
      restoreRef.current(saved);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
      setRemember(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !remember) return;
    const timer = window.setTimeout(
      () => setStorageError(!writeBuyerMemory(contact)),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [
    ready,
    remember,
    contact.name,
    contact.email,
    contact.document,
    contact.phone,
  ]);

  function changeRemember(checked: boolean) {
    setRemember(checked);
    setStorageError(
      checked ? !writeBuyerMemory(contact) : !removeBuyerMemory(),
    );
  }

  return { remember, ready, storageError, changeRemember };
}
