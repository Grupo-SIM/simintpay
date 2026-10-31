'use client';

import { useEffect, useRef, useState } from 'react';

/** Keep typing local, and flush on blur so clicking Save includes the last keystroke. */
export function useDebouncedInput(
  value: string,
  onChange: (value: string) => void,
  delay = 300,
) {
  const [local, setLocal] = useState(value);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setLocal(value);
  }

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current !== null) {
      callback.current(pending.current);
      pending.current = null;
    }
  };
  const update = (next: string) => {
    setLocal(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return [local, update, flush] as const;
}
