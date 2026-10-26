import { getAtlasProductType } from './atlas-product-description.util';

describe('getAtlasProductType', () => {
  it.each([
    ['DOMAIN teron.app', 'DOMAIN'],
    ['hosting VPS-10-1784846 [TENANT:ATLAS]', 'HOSTING'],
    ['atlas teron.app', null],
    [null, null],
  ])('reads %p as %p', (description, expected) => {
    expect(getAtlasProductType(description)).toBe(expected);
  });
});
