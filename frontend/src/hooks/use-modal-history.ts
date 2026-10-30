import { useCallback, useId, useLayoutEffect, useRef } from 'react';

const MODAL_HISTORY_STATE = '__simintpayModal';
const MODAL_QUERY_KEY = 'modal';
const MODAL_STATE_QUERY_KEY = 'modalState';

interface ModalHistoryState {
  id: string;
  key: string;
}

interface ModalHistoryEntry {
  afterClose?: () => void;
  id: string;
  onClose: () => void;
  scrollX: number;
  scrollY: number;
}

interface UseModalHistoryOptions {
  historyMode?: 'none' | 'push' | 'replace';
  isOpen: boolean;
  onClose: () => void;
  urlKey: string;
  urlState?: string;
}

const entries: ModalHistoryEntry[] = [];
let listening = false;

function currentModalState(): ModalHistoryState | undefined {
  return window.history.state?.[MODAL_HISTORY_STATE] as
    ModalHistoryState | undefined;
}

function modalUrl(key: string, state?: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(MODAL_QUERY_KEY, key);
  if (state) url.searchParams.set(MODAL_STATE_QUERY_KEY, state);
  else url.searchParams.delete(MODAL_STATE_QUERY_KEY);
  return `${url.pathname}${url.search}${url.hash}`;
}

function restoreScroll(entry: ModalHistoryEntry) {
  window.requestAnimationFrame(() =>
    window.scrollTo({
      behavior: 'instant',
      left: entry.scrollX,
      top: entry.scrollY,
    }),
  );
}

function handlePopState() {
  const currentId = currentModalState()?.id;
  while (entries.length > 0 && entries.at(-1)?.id !== currentId) {
    const entry = entries.pop();
    if (!entry) return;
    restoreScroll(entry);
    entry.onClose();
    entry.afterClose?.();
  }
}

function ensurePopStateListener() {
  if (listening) return;
  window.addEventListener('popstate', handlePopState);
  listening = true;
}

function openModalHistory(
  entry: ModalHistoryEntry,
  key: string,
  state: string | undefined,
  mode: 'push' | 'replace',
) {
  ensurePopStateListener();
  entries.push(entry);
  const historyState = {
    ...window.history.state,
    [MODAL_HISTORY_STATE]: { id: entry.id, key } satisfies ModalHistoryState,
  };
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    historyState,
    '',
    modalUrl(key, state),
  );
  restoreScroll(entry);
}

function replaceModalState(id: string, key: string, state?: string) {
  if (entries.at(-1)?.id !== id) return;
  window.history.replaceState(
    {
      ...window.history.state,
      [MODAL_HISTORY_STATE]: { id, key } satisfies ModalHistoryState,
    },
    '',
    modalUrl(key, state),
  );
}

function closeModalHistory(id: string) {
  if (entries.at(-1)?.id !== id) return;
  window.history.back();
}

export function closeActiveModalHistory(afterClose?: () => void) {
  const entry = entries.at(-1);
  if (!entry) {
    afterClose?.();
    return;
  }
  entry.afterClose = afterClose;
  window.history.back();
}

export function useModalHistory({
  historyMode = 'push',
  isOpen,
  onClose,
  urlKey,
  urlState,
}: UseModalHistoryOptions) {
  const reactId = useId();
  const id = `modal-${reactId.replaceAll(':', '')}`;
  const active = useRef(false);
  const mounted = useRef(false);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current && active.current) closeModalHistory(id);
      });
    };
  }, [id]);

  useLayoutEffect(() => {
    if (historyMode === 'none') return;

    if (isOpen && !active.current) {
      active.current = true;
      openModalHistory(
        {
          id,
          onClose: () => {
            active.current = false;
            onCloseRef.current();
          },
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        },
        urlKey,
        urlState,
        historyMode,
      );
      return;
    }

    if (!isOpen && active.current) closeModalHistory(id);
  }, [historyMode, id, isOpen, urlKey, urlState]);

  useLayoutEffect(() => {
    if (historyMode === 'none') return;
    if (active.current) replaceModalState(id, urlKey, urlState);
  }, [historyMode, id, urlKey, urlState]);

  return useCallback(() => {
    if (historyMode === 'none') {
      onCloseRef.current();
      return;
    }
    if (active.current) closeModalHistory(id);
    else onCloseRef.current();
  }, [historyMode, id]);
}
