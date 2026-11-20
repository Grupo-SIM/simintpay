'use client';

import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/use-current-user';
import { useReportApi } from '@/hooks/use-report-api';
import type {
  ReportPage,
  ReportPlatform,
} from '@/app/(dashboard)/relatorio/components/report-types';

const PAGE_SIZE = 10;

/** Backend-searched, infinitely scrolled platform catalog shared by every platform select. */
export function usePlatformSearch({
  search,
  enabled,
  selectedTag,
}: {
  search: string;
  enabled: boolean;
  /** Tag whose display name must be resolved even when it is outside the loaded pages. */
  selectedTag?: string;
}) {
  const { user } = useCurrentUser();
  const api = useReportApi();
  const scope = [user?.id, user?.isAdmin ? 'admin' : 'owner'];
  const query = useInfiniteQuery({
    queryKey: ['platform-select', ...scope, search],
    enabled: !!user && enabled,
    initialPageParam: 1,
    queryFn: ({ signal, pageParam }) =>
      api.get<ReportPage<ReportPlatform>>('/relatorios/plataformas', {
        query: { search, page: pageParam, pageSize: PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const platforms = query.data?.pages.flatMap((page) => page.data) ?? [];
  const known = selectedTag
    ? platforms.find(
        (row) => row.tag.toUpperCase() === selectedTag.toUpperCase(),
      )
    : undefined;
  const lookup = useQuery({
    queryKey: ['platform-select', ...scope, 'selected', selectedTag],
    enabled: !!user && !!selectedTag && !known,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const page = await api.get<ReportPage<ReportPlatform>>(
        '/relatorios/plataformas',
        {
          query: { search: selectedTag, page: 1, pageSize: PAGE_SIZE },
          signal,
        },
      );
      return (
        page.data.find(
          (row) => row.tag.toUpperCase() === selectedTag!.toUpperCase(),
        ) ?? null
      );
    },
  });
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage)
        void fetchNextPage();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, platforms.length]);
  return {
    query,
    platforms,
    sentinel,
    selected: known ?? lookup.data ?? undefined,
  };
}
