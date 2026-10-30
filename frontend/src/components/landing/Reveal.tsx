'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';

type RevealProps = {
  children: ReactNode;
  /** Animation direction. Defaults to "up". */
  variant?: 'up' | 'down' | 'left' | 'right' | 'fade' | 'zoom';
  /** Delay in ms before the element animates in (for staggering). */
  delay?: number;
  /** Animate only once (default) or every time it enters the viewport. */
  once?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Element tag to render. Defaults to "div". */
  as?: ElementType;
};

export function Reveal({
  children,
  variant = 'up',
  delay = 0,
  once = true,
  className,
  style,
  as: Tag = 'div',
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Respect users who prefer no motion: show immediately.
    if (reducedMotion) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [once, reducedMotion]);

  return (
    <Tag
      ref={ref}
      className={`sim-reveal sim-reveal--${variant}${visible || reducedMotion ? ' sim-reveal--in' : ''}${
        className ? ` ${className}` : ''
      }`}
      style={delay ? { ...style, transitionDelay: `${delay}ms` } : style}
    >
      {children}
    </Tag>
  );
}
