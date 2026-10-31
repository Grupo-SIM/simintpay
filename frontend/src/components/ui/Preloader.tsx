'use client';

import { useEffect, useState } from 'react';
import styles from './Preloader.module.css';

type PreloaderProps = {
  /** Texto exibido letra a letra (padrão: LOADING). Máx. 8 letras p/ os delays. */
  text?: string;
  /** Se definido, o preloader some após N ms. Se omitido, some no evento `load` da página. */
  duration?: number;
};

export default function Preloader({
  text = 'LOADING',
  duration,
}: PreloaderProps) {
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const hide = () => {
      setLeaving(true);
      // espera o fade-out (0.3s do CSS) antes de remover do DOM
      window.setTimeout(() => setGone(true), 300);
    };

    if (typeof duration === 'number') {
      const t = window.setTimeout(hide, duration);
      return () => window.clearTimeout(t);
    }

    if (document.readyState === 'complete') {
      hide();
      return;
    }
    window.addEventListener('load', hide);
    return () => window.removeEventListener('load', hide);
  }, [duration]);

  if (gone) return null;

  return (
    <div className={styles.loaderWrap}>
      <div className={styles.preloader}>
        <div
          className={`${styles.handlePreloader} ${leaving ? styles.loaded : ''}`}
        >
          <div className={styles.animationPreloader}>
            <div className={styles.txtLoading}>
              {text.split('').map((letter, i) => (
                <span
                  key={i}
                  data-text-preloader={letter}
                  className={styles.lettersLoading}
                >
                  {letter}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
