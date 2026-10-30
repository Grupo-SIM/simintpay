'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { navLinks } from './simintpay-landing-data';

export function SimLandingHeader() {
  const [open, setOpen] = useState(false);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sim-header">
      <div className="sim-header-inner">
        <Link href="/" className="sim-header-logo" onClick={close}>
          <img
            src="/assets/logo.svg"
            alt="SimIntPay"
            className="sim-header-logo-img"
          />
        </Link>

        <nav className="sim-header-nav">
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} className="sim-header-nav-link">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="sim-header-actions">
          <Link href="/login" className="sim-header-btn-login">
            Login
          </Link>
          <Link href="/cadastro" className="sim-header-btn-signup sim-btn">
            Começar agora
          </Link>
        </div>

        <button
          type="button"
          className="sim-header-burger"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`fa-solid ${open ? 'fa-xmark' : 'fa-bars'}`} />
        </button>
      </div>

      {/* Mobile menu */}
      <div className={`sim-header-mobile${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className="sim-header-mobile-backdrop"
          aria-label="Fechar menu"
          tabIndex={open ? 0 : -1}
          onClick={close}
        />
        <div
          className="sim-header-mobile-panel"
          role="dialog"
          aria-modal="true"
        >
          <nav className="sim-header-mobile-nav">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="sim-header-mobile-link"
                onClick={close}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="sim-header-mobile-actions">
            <Link
              href="/login"
              className="sim-header-btn-login"
              onClick={close}
            >
              Login
            </Link>
            <Link
              href="/cadastro"
              className="sim-header-btn-signup sim-btn"
              onClick={close}
            >
              Começar agora
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
