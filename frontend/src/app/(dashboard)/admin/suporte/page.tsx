'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import styles from './suporte-festa.module.css';

const WHATSAPP_MESSAGE = 'Preciso de ajuda rei julian, por favor me salve';

const REI_JULIAN_1 = {
  label: 'Rei Julian 1',
  waDigits: '5583987690902',
};

const REI_JULIAN_2 = {
  label: 'Rei Julian 2',
  waDigits: '5513996790272',
};

function whatsappHref(digits: string) {
  const text = encodeURIComponent(WHATSAPP_MESSAGE);
  return `https://wa.me/${digits}?text=${text}`;
}

/** Valores fixos por índice — evita mismatch de hidratação. */
function buildConfetti(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    leftPct: (i * 37 + (i % 9) * 7) % 100,
    delayS: Number((((i * 0.19) % 2.6) + 0.05).toFixed(2)),
    durationS: Number((3.1 + (i % 7) * 0.32).toFixed(2)),
    hue: (i * 47) % 360,
    w: 5 + (i % 5),
    h: 7 + (i % 6),
    round: i % 4 === 0,
  }));
}

const SPARKLE_POS = [
  { top: '10%', left: '6%', delay: '0s' },
  { top: '18%', left: '92%', delay: '0.35s' },
  { top: '42%', left: '3%', delay: '0.7s' },
  { top: '38%', left: '94%', delay: '1.1s' },
  { top: '72%', left: '8%', delay: '0.2s' },
  { top: '68%', left: '90%', delay: '0.9s' },
];

const RIBBONS: {
  emoji: string;
  top: string;
  left?: string;
  right?: string;
  delay: string;
  centerX?: boolean;
}[] = [
  { emoji: '🎊', top: '4%', left: '5%', delay: '0s' },
  { emoji: '🎈', top: '8%', right: '6%', delay: '0.4s' },
  { emoji: '🎉', top: '3%', left: '50%', delay: '0.8s', centerX: true },
];

export default function AdminSuportePage() {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
  const confetti = useMemo(() => buildConfetti(30), []);

  useEffect(() => {
    if (!loading && !user?.isAdmin) {
      router.replace('/painel');
    }
  }, [loading, user?.isAdmin, router]);

  if (!loading && !user?.isAdmin) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-zinc-500 dark:text-zinc-400">
        Carregando…
      </div>
    );
  }

  return (
    <div
      className={`mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden rounded-2xl border border-fuchsia-500/25 bg-gradient-to-b from-violet-950/30 via-transparent to-emerald-950/20 px-4 py-2 shadow-[0_0_40px_-10px_rgba(168,85,247,0.35)] ${styles.wrap}`}
    >
      <div className={styles.bgParty} aria-hidden />

      {confetti.map((c, i) => (
        <span
          key={i}
          className={styles.confetti}
          style={{
            left: `${c.leftPct}%`,
            animationDelay: `${c.delayS}s`,
            animationDuration: `${c.durationS}s`,
            width: c.w,
            height: c.h,
            backgroundColor: `hsl(${c.hue} 82% 62%)`,
            borderRadius: c.round ? '50%' : '2px',
          }}
        />
      ))}

      {SPARKLE_POS.map((s, i) => (
        <span
          key={`sp-${i}`}
          className={styles.sparkle}
          style={{
            top: s.top,
            left: s.left,
            animationDelay: s.delay,
          }}
          aria-hidden
        >
          ✨
        </span>
      ))}

      {RIBBONS.map((r, i) => (
        <span
          key={`rb-${i}`}
          className={`${styles.ribbon}${r.centerX ? ` ${styles.ribbonCenter}` : ''}`}
          style={{
            top: r.top,
            left: r.left,
            right: r.right,
            animationDelay: r.delay,
          }}
          aria-hidden
        >
          {r.emoji}
        </span>
      ))}

      <div
        className={`relative z-[3] flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden ${styles.content}`}
      >
        <div className="shrink-0 text-center">
          <h1
            className={`text-xl font-extrabold tracking-tight sm:text-2xl ${styles.title}`}
          >
            Suporte 🎉
          </h1>
          <p
            className={`mt-1 text-xs text-zinc-600 dark:text-zinc-300 sm:text-sm ${styles.subtitle}`}
          >
            Chame o Rei Julian no WhatsApp — escolha um dos contatos abaixo.
          </p>
        </div>

        <div className="flex min-h-0 w-full max-w-4xl flex-1 items-center justify-center">
          <img
            src="/big-reis.png"
            alt="Rei Julian"
            className={`max-h-[min(58dvh,580px)] w-auto max-w-full object-contain object-center sm:max-h-[min(62dvh,680px)] ${styles.imgFloat}`}
          />
        </div>

        <div className="flex w-full max-w-md shrink-0 flex-col gap-2 pb-1 sm:flex-row sm:justify-center sm:gap-3">
          <a
            href={whatsappHref(REI_JULIAN_1.waDigits)}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#20bd5a] active:scale-[0.98] ${styles.btnParty}`}
          >
            <MessageCircle className="relative z-[1] h-5 w-5" strokeWidth={2} />
            <span className="relative z-[1]">{REI_JULIAN_1.label}</span>
          </a>
          <a
            href={whatsappHref(REI_JULIAN_2.waDigits)}
            target="_blank"
            rel="noopener noreferrer"
            className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#20bd5a] active:scale-[0.98] ${styles.btnParty}`}
          >
            <MessageCircle className="relative z-[1] h-5 w-5" strokeWidth={2} />
            <span className="relative z-[1]">{REI_JULIAN_2.label}</span>
          </a>
        </div>
      </div>
    </div>
  );
}
