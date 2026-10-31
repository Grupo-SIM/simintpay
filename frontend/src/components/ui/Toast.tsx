'use client';

import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type ToastType = 'success' | 'error' | 'info';

export type ToastItem = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
};

type ToastContextValue = {
  toast: (input: Omit<ToastItem, 'id'>) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function getToastClasses(type: ToastType) {
  if (type === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (type === 'error') {
    return 'border-red-200 bg-red-50 text-red-900';
  }
  return 'border-zinc-200 bg-white text-zinc-900';
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((input: Omit<ToastItem, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const item: ToastItem = { id, ...input };
    setItems((prev) => [item, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-4 z-[110] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={[
              'rounded-xl border p-4 shadow-sm',
              getToastClasses(t.type),
            ].join(' ')}
            role="status"
          >
            <div className="text-sm font-semibold">{t.title}</div>
            {t.description ? (
              <div className="mt-1 text-sm opacity-80">{t.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
