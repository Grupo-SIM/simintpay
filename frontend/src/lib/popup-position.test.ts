import { describe, expect, test } from 'bun:test';
import { getPopupPosition } from './popup-position';

const viewport = { width: 320, height: 240 };
describe('popup viewport containment', () => {
  test('flips above a trigger near the bottom', () => {
    const popup = getPopupPosition(
      { left: 20, right: 220, top: 200, bottom: 230, width: 200 },
      viewport,
      200,
      150,
    );
    expect(popup.top).toBe(44);
    expect(popup.maxHeight).toBe(186);
  });
  test('clamps oversized menus at both horizontal edges and limits height', () => {
    for (const left of [-100, 280]) {
      const popup = getPopupPosition(
        { left, right: left + 200, top: 100, bottom: 130, width: 200 },
        viewport,
        500,
        600,
      );
      expect(popup.left).toBeGreaterThanOrEqual(8);
      expect(popup.left + popup.width).toBeLessThanOrEqual(312);
      expect(popup.top).toBeGreaterThanOrEqual(8);
      expect(popup.top + popup.maxHeight).toBeLessThanOrEqual(232);
    }
  });
  test('falls back below when upward preference has insufficient space', () => {
    const popup = getPopupPosition(
      { left: 8, right: 208, top: 10, bottom: 40, width: 200 },
      viewport,
      200,
      100,
      'up',
    );
    expect(popup.top).toBe(46);
  });
});
