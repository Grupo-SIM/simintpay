/** Logo SimPay (PNG quadrado 2000px, recortado como no design). */
export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: lg ? 164 : 132, height: lg ? 39 : 31 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-simpay-branca.png"
        alt="SimPay"
        className="absolute max-w-none"
        style={
          lg
            ? { width: 192, height: 192, left: -17, top: -73 }
            : { width: 154, height: 154, left: -14, top: -58 }
        }
      />
    </div>
  );
}
