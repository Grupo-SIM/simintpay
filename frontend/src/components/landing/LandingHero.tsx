import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export function LandingHero() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        .hero-section {
          position: relative;
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 45%, #4c1d95 100%);
          overflow: hidden;
          padding-bottom: 130px;
          font-family: 'Inter', sans-serif;
        }

        /* subtle dot grid overlay */
        .hero-dot-grid {
          position: absolute;
          inset: 0;
          z-index: 0;
          opacity: 0.18;
          background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.6) 1px, transparent 0);
          background-size: 28px 28px;
          pointer-events: none;
        }

        /* soft radial glows */
        .hero-glow-1 {
          position: absolute;
          top: -120px;
          right: 100px;
          width: 500px;
          height: 500px;
          border-radius: 50%;
          background: rgba(167,139,250,0.18);
          filter: blur(80px);
          z-index: 0;
          pointer-events: none;
        }

        .hero-glow-2 {
          position: absolute;
          bottom: 0;
          left: -80px;
          width: 400px;
          height: 400px;
          border-radius: 50%;
          background: rgba(109,40,217,0.25);
          filter: blur(80px);
          z-index: 0;
          pointer-events: none;
        }

        /* main content */
        .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: 60px;
          max-width: 1600px;
          width: 100%;
          margin: 0 auto;
          padding: 140px 60px 80px;
        }

        .hero-left {
          flex: 1;
          max-width: 620px;
          width: 100%;
        }

        .hero-right {
          flex: 1.2;
          max-width: 780px;
          display: flex;
          justify-content: flex-end;
          align-items: center;
        }

        @media (min-width: 1920px) {
          .hero-content {
            max-width: 1800px;
            padding: 160px 100px 100px;
            gap: 120px;
          }
          .hero-left {
            max-width: 700px;
          }
          .hero-right {
            max-width: 900px;
          }
        }


        @media (max-width: 1280px) {
          .hero-content {
            padding: 120px 48px 80px;
            gap: 40px;
          }
          .hero-left { max-width: 500px; }
          .hero-right { max-width: 580px; }
        }

        @media (max-width: 1024px) {
          .hero-content {
            padding: 110px 40px 80px;
            gap: 30px;
          }
          .hero-left { max-width: 450px; }
          .hero-right { max-width: 480px; }
        }

        @media (max-width: 768px) {
          .hero-content {
            flex-direction: column;
            align-items: center;
            text-align: center;
            padding: 110px 24px 80px;
            gap: 60px;
          }
          .hero-left { 
            max-width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .hero-right { 
            width: 100%;
            max-width: 500px;
            justify-content: center;
          }
          .hero-desc {
            margin-left: auto;
            margin-right: auto;
          }
          .hero-cta-row {
            justify-content: center;
          }
          .hero-stats {
            justify-content: center;
            text-align: left;
          }
        }

        /* LEFT */
        .hero-eyebrow {
          display: inline-block;
          font-size: 13px;
          font-weight: 600;
          color: rgba(233,213,255,0.9);
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 18px;
        }

        .hero-title {
          font-size: clamp(38px, 5.5vw, 64px);
          font-weight: 800;
          color: #fff;
          line-height: 1.08;
          letter-spacing: -1.5px;
          margin: 0 0 22px 0;
        }

        .hero-title span {
          color: #e9d5ff;
        }

        .hero-desc {
          font-size: 16px;
          color: rgba(255,255,255,0.68);
          line-height: 1.8;
          max-width: 420px;
          margin: 0 0 38px 0;
        }

        /* CTA buttons */
        .hero-cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
        }

        .hero-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          height: 50px;
          padding: 0 30px;
          border-radius: 10px;
          background: #fff;
          color: #6d28d9;
          font-size: 15px;
          font-weight: 700;
          text-decoration: none;
          font-family: 'Inter', sans-serif;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 6px 28px rgba(0,0,0,0.20);
        }

        .hero-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 36px rgba(0,0,0,0.28);
          background: #f5f3ff;
        }

        .hero-btn-primary-icon {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(109,40,217,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          flex-shrink: 0;
        }

        .hero-btn-secondary {
          display: inline-flex;
          align-items: center;
          height: 50px;
          padding: 0 28px;
          border-radius: 10px;
          border: 1.5px solid rgba(255,255,255,0.3);
          background: rgba(255,255,255,0.07);
          color: #fff;
          font-size: 15px;
          font-weight: 500;
          text-decoration: none;
          font-family: 'Inter', sans-serif;
          backdrop-filter: blur(6px);
          transition: background 0.2s, border-color 0.2s;
        }

        .hero-btn-secondary:hover {
          background: rgba(255,255,255,0.13);
          border-color: rgba(255,255,255,0.5);
        }

        /* stats row */
        .hero-stats {
          display: flex;
          gap: 36px;
          margin-top: 48px;
          padding-top: 36px;
          border-top: 1px solid rgba(255,255,255,0.12);
        }

        .hero-stat-value {
          font-size: 22px;
          font-weight: 700;
          color: #fff;
          letter-spacing: -0.5px;
        }

        .hero-stat-label {
          font-size: 13px;
          color: rgba(255,255,255,0.55);
          margin-top: 4px;
        }

        /* RIGHT — image/lottie area */
        .hero-right {
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .hero-media-wrapper {
          position: relative;
          width: 100%;
          max-width: 680px;
        }

        /* glow behind lottie */
        .hero-media-glow {
          position: absolute;
          inset: -30px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(167,139,250,0.25) 0%, transparent 70%);
          pointer-events: none;
          z-index: 0;
        }

        .hero-lottie-box {
          position: relative;
          z-index: 1;
          aspect-ratio: 343 / 260;
          width: 100%;
        }


        /* pagination dots */
        .hero-pagination {
          position: absolute;
          right: 20px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 3;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .hero-page-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: rgba(255,255,255,0.3);
          cursor: pointer;
          transition: background 0.2s, transform 0.2s;
        }

        .hero-page-dot.active {
          background: #fff;
          transform: scale(1.3);
        }

        /* wave divider */
        .hero-wave {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          overflow: hidden;
          line-height: 0;
          z-index: 1;
        }

        .hero-wave svg {
          display: block;
          width: 100%;
        }
      `}</style>

      <section className="hero-section">
        {/* background effects */}
        <div className="hero-dot-grid" />
        <div className="hero-glow-1" />
        <div className="hero-glow-2" />

        {/* main grid */}
        <div className="hero-content">
          {/* LEFT */}
          <div className="hero-left">
            <span className="hero-eyebrow">
              Tecnologia de ponta • Transparência • Segurança
            </span>
            <h1 className="hero-title">
              Gestão de <span>Pagamentos</span>
              <br />
              Simplificada
            </h1>
            <p className="hero-desc">
              Pagamentos, links de cobrança e maquininhas com experiência
              moderna para você e seus clientes crescerem juntos.
            </p>

            <div className="hero-cta-row">
              <Link href="/cadastro" className="hero-btn-primary">
                <span className="hero-btn-primary-icon">✓</span>
                Começar agora
              </Link>
              <a href="#beneficios" className="hero-btn-secondary">
                Saiba mais
              </a>
            </div>

            <div className="hero-stats">
              <div>
                <div className="hero-stat-value">Taxas competitivas</div>
                <div className="hero-stat-label">Para você vender mais.</div>
              </div>
              <div>
                <div className="hero-stat-value">Saque ágil</div>
                <div className="hero-stat-label">Dinheiro no prazo.</div>
              </div>
              <div>
                <div className="hero-stat-value">Alta aprovação</div>
                <div className="hero-stat-label">Mais conversão.</div>
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="hero-right">
            <div className="hero-media-wrapper">
              <div className="hero-media-glow" />
              <div className="hero-lottie-box">
                <Image
                  src="/shopping2-nobg.svg"
                  alt="Ilustração de pagamentos"
                  width={680}
                  height={520}
                  style={{ width: '100%', height: 'auto' }}
                  priority
                />
              </div>
            </div>
          </div>
        </div>

        {/* wave */}
        <div className="hero-wave">
          <svg
            viewBox="0 0 1440 120"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
          >
            <path
              d="M0,60 C360,120 1080,0 1440,60 L1440,120 L0,120 Z"
              fill="#070712"
            />
          </svg>
        </div>
      </section>
    </>
  );
}
