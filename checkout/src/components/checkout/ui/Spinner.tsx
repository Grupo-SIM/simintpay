/** Spinner cônico do design (16px no "aguardando", 96px nas telas de processamento). */
export function Spinner({
  size = 16,
  width = 3,
}: {
  size?: number;
  width?: number;
}) {
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${width}px), #000 calc(100% - ${width - 1}px))`;
  return (
    <span
      aria-hidden
      className="sp2-spinner"
      style={{ width: size, height: size, WebkitMask: mask, mask }}
    />
  );
}
