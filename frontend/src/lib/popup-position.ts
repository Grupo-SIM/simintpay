/** Keep anchored menus inside the viewport, preferring the requested side. */
export function getPopupPosition(
  anchor: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
  },
  viewport: { width: number; height: number },
  width: number,
  height: number,
  direction: 'up' | 'down' = 'down',
  align: 'start' | 'end' = 'start',
) {
  const margin = 8;
  const gap = 6;
  const availableWidth = Math.max(0, viewport.width - margin * 2);
  const popupWidth = Math.min(width, availableWidth);
  const below = Math.max(
    0,
    viewport.height - Math.max(margin, anchor.bottom + gap) - margin,
  );
  const above = Math.max(
    0,
    Math.min(viewport.height - margin, anchor.top - gap) - margin,
  );
  const openUp =
    direction === 'up'
      ? above >= height || above >= below
      : below < height && above > below;
  const maxHeight = openUp ? above : below;
  const popupHeight = Math.min(height, maxHeight);
  return {
    position: 'fixed' as const,
    left: Math.max(
      margin,
      Math.min(
        align === 'end' ? anchor.right - popupWidth : anchor.left,
        viewport.width - margin - popupWidth,
      ),
    ),
    top: Math.max(
      margin,
      Math.min(
        openUp ? anchor.top - gap - popupHeight : anchor.bottom + gap,
        viewport.height - margin - popupHeight,
      ),
    ),
    width: popupWidth,
    maxHeight,
    zIndex: 9999,
  };
}
