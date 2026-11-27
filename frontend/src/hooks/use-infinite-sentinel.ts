'use client';

import { useEffect, useRef } from 'react';

/** Ref for an element below the list; scrolling it into view loads the next page. */
export function useInfiniteSentinel(
  hasNextPage: boolean,
  isFetching: boolean,
  fetchNextPage: () => unknown,
) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetching) void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);
  return ref;
}
