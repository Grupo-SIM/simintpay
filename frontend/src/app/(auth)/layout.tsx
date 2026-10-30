'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="auth-root">
      <div className="auth-grid">
        {/* ─── LEFT PANEL ─── */}
        <div className="auth-left-panel">
          {/* top bar */}
          <div className="auth-left-topbar">
            <Link href="/">
              <img
                src="/logo-simpay-branca.svg"
                alt="Simintpay"
                className="auth-logo-img"
              />
            </Link>
          </div>

          {/* background image */}
          <Image
            src="/images/login-bg.png"
            alt="Background"
            fill
            className="auth-bg-image"
            priority
          />

          {/* overlay */}
          <div className="auth-left-overlay" />

          {/* bottom tagline */}
          <div className="auth-left-bottom">
            <p className="auth-tagline">
              Gerenciamento inteligente,
              <br />
              resultados reais.
            </p>
            <div className="auth-dots">
              <span className="auth-dot" />
              <span className="auth-dot" />
              <span className="auth-dot auth-dot-active" />
            </div>
          </div>
        </div>

        {/* ─── RIGHT PANEL ─── */}
        <div className="auth-right-panel">
          {/* ambient blobs */}
          <div className="auth-blob auth-blob-1" />
          <div className="auth-blob auth-blob-2" />

          <div className="auth-form-wrapper">{children}</div>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        .auth-root {
          min-height: 100vh;
          background: var(--auth-root-bg);
          font-family: 'Inter', sans-serif;
          background-image: radial-gradient(circle at 100% 0%, var(--auth-root-grad-1) 0%, transparent 40%),
                            radial-gradient(circle at 0% 100%, var(--auth-root-grad-2) 0%, transparent 40%);
        }

        .auth-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
          padding: 12px;
          gap: 12px;
        }

        @media (max-width: 900px) {
          .auth-grid {
            grid-template-columns: 1fr;
            padding: 0;
            gap: 0;
          }
          .auth-left-panel {
            display: none !important;
          }
        }

        /* ─── LEFT (Image) ─── */
        .auth-left-panel {
          position: relative;
          overflow: hidden;
          border-radius: 24px;
          background: var(--auth-left-panel-bg);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: var(--auth-left-panel-shadow);
        }

        .auth-bg-image {
          object-fit: cover;
          z-index: 0;
          opacity: 1; /* Viva */
        }

        .auth-left-overlay {
          position: absolute;
          inset: 0;
          background: var(--auth-left-overlay);
          z-index: 1;
        }

        .auth-left-topbar {
          position: relative;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 32px 32px;
        }

        .auth-logo-img {
          height: 3rem;
          width: auto;
          object-fit: contain;
          filter: drop-shadow(0 2px 12px rgba(0,0,0,0.4));
          transition: opacity 0.2s;
        }

        .auth-logo-img:hover {
          opacity: 0.85;
        }

        .auth-left-bottom {
          position: relative;
          z-index: 2;
          padding: 40px;
        }

        .auth-tagline {
          font-size: 26px;
          font-weight: 700;
          color: var(--auth-tagline-color);
          line-height: 1.3;
          margin: 0 0 24px 0;
          letter-spacing: -0.5px;
          text-shadow: var(--auth-tagline-shadow);
        }

        .auth-dots {
          display: flex;
          gap: 7px;
        }

        .auth-dot {
          width: 20px;
          height: 5px;
          border-radius: 10px;
          background: var(--auth-dot);
        }

        .auth-dot-active {
          background: var(--auth-dot-active);
          width: 32px;
          box-shadow: var(--auth-dot-active-shadow);
        }

        /* ─── RIGHT (Inputs) ─── */
        .auth-right-panel {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 48px 32px;
          background: var(--auth-right-panel-bg);
          background-image: var(--auth-right-panel-grad);
          overflow: hidden;
          border-radius: 24px;
          box-shadow: var(--auth-right-panel-shadow);
        }

        /* slightly more visible grid overlay */
        .auth-right-panel::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: var(--auth-right-grid);
          background-size: 24px 24px;
          pointer-events: none;
          z-index: 0;
        }

        .auth-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          pointer-events: none;
          z-index: 0;
        }

        .auth-blob-1 {
          width: 400px;
          height: 400px;
          background: var(--auth-blob-1);
          top: -120px;
          right: -120px;
        }

        .auth-blob-2 {
          width: 350px;
          height: 350px;
          background: var(--auth-blob-2);
          bottom: -80px;
          left: -120px;
        }

        .auth-form-wrapper {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 400px;
        }
      `}</style>
    </div>
  );
}
