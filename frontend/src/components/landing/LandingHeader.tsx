'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled((prev) => {
        if (prev) return y > 8;
        return y > 24;
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const navLinks = [
    { label: 'Home', href: '#' },
    { label: 'Benefícios', href: '#beneficios' },
    { label: 'Sobre', href: '#sobre' },
    { label: 'Contato', href: '#ajuda' },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        .lh-header {
          position: fixed;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          z-index: 50;
          font-family: 'Inter', sans-serif;
          transition:
            width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
            top 0.45s cubic-bezier(0.4, 0, 0.2, 1),
            border-radius 0.45s cubic-bezier(0.4, 0, 0.2, 1),
            background 0.35s ease,
            box-shadow 0.35s ease;
        }

        .lh-header.scrolled {
          top: 12px;
          width: min(860px, calc(100% - 32px));
          border-radius: 100px;
          background: rgba(10, 8, 30, 0.70);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.11);
          box-shadow: 0 8px 32px rgba(0,0,0,0.28);
        }

        .lh-inner {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 48px;
          height: 70px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
          transition:
            padding 0.45s cubic-bezier(0.4, 0, 0.2, 1),
            height 0.45s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .lh-header.scrolled .lh-inner {
          padding: 0 28px;
          height: 60px;
          max-width: 100%;
        }

        @media (max-width: 768px) {
          .lh-header.scrolled { width: calc(100% - 24px); }
          .lh-inner { padding: 0 20px; }
          .lh-header.scrolled .lh-inner { padding: 0 18px; }
          .lh-nav-links { display: none !important; }
        }

        /* LOGO */
        .lh-logo {
          display: flex;
          align-items: center;
          text-decoration: none;
          flex-shrink: 0;
        }

        .lh-logo-img {
          height: 2.75rem;
          width: auto;
          object-fit: contain;
          transition: opacity 0.2s, height 0.45s ease;
        }

        .lh-header.scrolled .lh-logo-img {
          height: 2rem;
        }

        .lh-logo:hover .lh-logo-img {
          opacity: 0.85;
        }

        /* NAV LINKS */
        .lh-nav-links {
          display: flex;
          align-items: center;
          gap: 32px;
        }

        .lh-nav-link {
          font-size: 14px;
          font-weight: 500;
          color: rgba(255,255,255,0.65);
          text-decoration: none;
          position: relative;
          padding-bottom: 3px;
          transition: color 0.2s;
        }

        .lh-nav-link:hover {
          color: #fff;
        }

        .lh-nav-link.active {
          color: #fff;
          font-weight: 600;
        }

        .lh-nav-link.active::after {
          content: '';
          position: absolute;
          bottom: -2px;
          left: 0;
          right: 0;
          height: 2px;
          background: #fff;
          border-radius: 1px;
        }



        /* ACTIONS */
        .lh-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .lh-btn-login {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 38px;
          padding: 0 20px;
          border-radius: 8px;
          border: 1.5px solid rgba(255,255,255,0.28);
          background: transparent;
          color: #fff;
          font-size: 13.5px;
          font-weight: 500;
          text-decoration: none;
          transition: background 0.2s, border-color 0.2s;
          white-space: nowrap;
          font-family: 'Inter', sans-serif;
        }

        .lh-btn-login:hover {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.5);
        }

        .lh-btn-signup {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 38px;
          padding: 0 20px;
          border-radius: 8px;
          border: none;
          background: #7c3aed;
          color: #fff;
          font-size: 13.5px;
          font-weight: 600;
          text-decoration: none;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 2px 12px rgba(124,58,237,0.4);
          white-space: nowrap;
          font-family: 'Inter', sans-serif;
        }

        .lh-btn-signup:hover {
          background: #6d28d9;
          transform: translateY(-1px);
          box-shadow: 0 4px 18px rgba(124,58,237,0.5);
        }

        .lh-hamburger {
          width: 36px;
          height: 36px;
          border-radius: 8px;
          border: 1.5px solid rgba(255,255,255,0.25);
          background: transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          cursor: pointer;
          transition: background 0.2s;
        }

        .lh-hamburger:hover {
          background: rgba(255,255,255,0.1);
        }
      `}</style>

      <header className={cn('lh-header', scrolled && 'scrolled')}>
        <div className="lh-inner">
          {/* Logo */}
          <Link
            href="/"
            className="lh-logo"
            onClick={(e) => {
              if (pathname === '/') {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          >
            <img
              src="/logo-simpay-branca.svg"
              alt="Simintpay"
              className="lh-logo-img"
            />
          </Link>

          {/* Nav links */}
          <nav className="lh-nav-links">
            {navLinks.map((link, i) => (
              <a
                key={link.label}
                href={link.href}
                className={cn('lh-nav-link', i === activeIndex && 'active')}
                onClick={() => setActiveIndex(i)}
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Actions */}
          <div className="lh-actions">
            <Link href="/login" className="lh-btn-login">
              Login
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
