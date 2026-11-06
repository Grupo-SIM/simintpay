/** Logo SimIntPay (SVG 470x135, o mesmo usado no frontend). */
export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-simpay-branca.svg"
      alt="SimIntPay"
      className="shrink-0"
      style={{ width: 'auto', height: size === 'lg' ? 48 : 40 }}
    />
  );
}
