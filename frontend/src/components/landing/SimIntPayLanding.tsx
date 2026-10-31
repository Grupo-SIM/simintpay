import Link from 'next/link';
import { Reveal } from './Reveal';
import { SimBrandMarquee } from './SimBrandMarquee';
import { SimLandingHeader } from './SimLandingHeader';
import { SimPartnersOrbit } from './SimPartnersOrbit';
import { SimReviewsCarousel } from './SimReviewsCarousel';
import { SimpaySupportChatCard } from './SimpaySupportChatCard';
import {
  featureCards,
  services,
  steps,
  supportList,
} from './simintpay-landing-data';
import './simintpay-landing.css';

const rootStyle = {
  '--accent': '#761FE3',
  '--accent-light': '#D093E8',
  '--bg': '#141414',
  width: '100%',
  background: '#141414',
  fontFamily:
    "var(--font-landing-inter), Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: '#fff',
  overflowX: 'hidden' as const,
};

type FeatureCard = (typeof featureCards)[number];

function renderFeatureCard(
  f: FeatureCard,
  prominentTitle = false,
  reveal?: {
    variant?: 'up' | 'down' | 'left' | 'right' | 'fade' | 'zoom';
    delay?: number;
  },
) {
  const header = (
    <>
      <span className="sim-feature-card-badge">{f.badge}</span>
      <h3
        className={`sim-feature-card-title${prominentTitle ? ' sim-feature-card-title--prominent' : ''}`}
      >
        {f.title}
      </h3>
      <p className="sim-feature-card-subtitle">{f.subtitle}</p>
    </>
  );

  return (
    <Reveal
      key={f.badge}
      variant={reveal?.variant ?? 'up'}
      delay={reveal?.delay ?? 0}
      className="sim-feature-card"
    >
      {prominentTitle ? (
        <div className="sim-feature-card-header">{header}</div>
      ) : (
        header
      )}
      <div className="sim-feature-card-grid">
        {f.tiles.map((t) => (
          <div key={t.label} className="sim-feature-card-tile">
            <span className="sim-feature-card-tile-icon">
              <i className={`fa-solid ${t.icon}`} />
            </span>
            <div className="sim-feature-card-tile-label">{t.label}</div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

export function SimIntPayLanding() {
  return (
    <div id="sim-root" className="sim-landing" style={rootStyle}>
      <section
        className="sim-hero-section"
        style={{
          position: 'relative',
          width: '100%',
          overflow: 'hidden',
          background:
            'radial-gradient(700px 500px at 90% 0%, rgba(118,31,227,.16), transparent 55%), radial-gradient(900px 520px at 20% 62%, rgba(118,31,227,.28), transparent 60%), #141414',
        }}
      >
        <SimLandingHeader />

        <div className="sim-hero-dots" aria-hidden="true" />
        <div
          className="sim-hero-inner"
          style={{
            position: 'relative',
            maxWidth: 1320,
            margin: '0 auto',
            padding: '48px 40px 110px',
            display: 'flex',
            alignItems: 'center',
            gap: 56,
            flexWrap: 'wrap',
          }}
        >
          <Reveal variant="right" style={{ flex: '1 1 520px', minWidth: 340 }}>
            <div
              style={{
                display: 'inline-block',
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: '0.2px',
                color: '#BA83FF',
                padding: '10px 18px',
                borderRadius: 10,
                background: '#1F1630',
                marginBottom: 26,
              }}
            >
              Tecnologia de ponta &nbsp;•&nbsp; Transparência &nbsp;•&nbsp;
              Segurança
            </div>
            <h1
              className="sim-hero-title"
              style={{
                fontSize: 50,
                lineHeight: 1.13,
                fontWeight: 600,
                letterSpacing: '-1px',
                marginBottom: 24,
              }}
            >
              Plataforma completa para receber pagamentos e acelerar seus{' '}
              <span
                style={{
                  fontFamily: 'var(--font-landing-lora), Lora, serif',
                  fontStyle: 'italic',
                  fontWeight: 600,
                  borderBottom: '4px solid var(--accent)',
                  paddingBottom: 2,
                }}
              >
                resutados.
              </span>
            </h1>
            <p
              className="sim-hero-subtitle"
              style={{
                fontSize: 19,
                lineHeight: 1.6,
                color: '#a3a3a3',
                maxWidth: 520,
                marginBottom: 36,
              }}
            >
              Pagamentos, links de cobrança e maquininhas com experiência
              moderna para você e seus clientes crescerem juntos.
            </p>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              <Link
                href="/cadastro"
                className="sim-btn sim-btn--solid"
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: '#fff',
                  padding: '18px 34px',
                  borderRadius: 11,
                  background: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                Começar agora{' '}
                <i
                  className="fa-solid fa-arrow-right"
                  style={{ fontSize: 14 }}
                />
              </Link>
              <a
                href="#beneficios"
                className="sim-btn sim-btn--ghost"
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--accent-light)',
                  padding: '18px 34px',
                  borderRadius: 11,
                  border: '1px solid rgba(118,31,227,.5)',
                }}
              >
                Saiba mais
              </a>
            </div>
          </Reveal>

          <Reveal
            variant="left"
            delay={120}
            className="sim-hero-visual"
            style={{
              flex: '1 1 600px',
              minWidth: 340,
            }}
          >
            <div className="sim-hero-artwork">
              <img
                src="/images/group-27.png"
                alt="Pagamentos seguros SimIntPay"
              />
              <div
                className="sim-hero-approval-card"
                aria-label="Mais de 90 por cento de aprovação"
              >
                <strong>↑ +90%</strong>
                <span>De aprovação</span>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="sim-hero-wave" aria-hidden="true">
          <svg
            viewBox="0 0 1440 120"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
          >
            <path
              d="M0,60 C360,120 1080,0 1440,60 L1440,120 L0,120 Z"
              fill="#141414"
            />
          </svg>
        </div>
      </section>

      <section
        id="beneficios"
        style={{ width: '100%', background: '#141414', padding: '96px 0' }}
      >
        <div
          className="sim-section-inner"
          style={{ maxWidth: 1320, margin: '0 auto', padding: '0 40px' }}
        >
          <Reveal
            className="sim-benefits-heading"
            style={{ textAlign: 'center', margin: '0 auto 56px' }}
          >
            <h2 className="sim-benefits-title">
              <span className="sim-benefits-title-line">
                Tudo o que sua empresa precisa para
              </span>
              <span className="sim-benefits-title-line">
                ganhar mais e{' '}
                <span className="sim-benefits-underline">
                  gerenciar melhor.
                </span>
              </span>
            </h2>
            <p className="sim-benefits-subtitle">
              <span className="sim-benefits-subtitle-line">
                Soluções completas para simplificar pagamentos, aumentar a
              </span>
              <span className="sim-benefits-subtitle-line">
                eficiência e impulsionar o crescimento do seu negócio.
              </span>
            </p>
          </Reveal>
          <div className="sim-services-grid">
            {services.map((s, i) => (
              <Reveal
                key={s.num}
                variant="up"
                delay={i * 90}
                className="sim-service-card"
                style={{
                  borderRadius: 12,
                  padding: 30,
                  minHeight: 300,
                  background:
                    'linear-gradient(180deg, #2f2f2f 0%, #1c1c1c 100%)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div className="sim-service-card-shadow" aria-hidden="true" />
                <div
                  className="sim-service-card-content sim-service-icon"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 26,
                    background:
                      'linear-gradient(135deg,rgba(118,31,227,.55),rgba(208,147,232,.45))',
                  }}
                >
                  {s.iconSrc ? (
                    <img
                      src={s.iconSrc}
                      alt=""
                      style={{ width: 28, height: 'auto', display: 'block' }}
                    />
                  ) : (
                    <i
                      className={`fa-solid ${s.icon}`}
                      style={{ fontSize: 24, color: '#fff' }}
                    />
                  )}
                </div>
                <h3
                  className="sim-service-card-content"
                  style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}
                >
                  {s.title}
                </h3>
                <p
                  className="sim-service-card-content"
                  style={{
                    fontSize: 16,
                    lineHeight: 1.65,
                    color: '#a3a3a3',
                    flex: 1,
                  }}
                >
                  {s.body}
                </p>
                <span className="sim-service-card-num">{s.num}</span>
              </Reveal>
            ))}
            <Reveal
              variant="up"
              delay={services.length * 90}
              className="sim-service-card-cta"
              style={{
                borderRadius: 12,
                padding: 30,
                minHeight: 300,
                background:
                  'linear-gradient(180deg, #761FE3 0%, rgba(118, 31, 227, 0) 100%)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div className="sim-service-card-shadow" aria-hidden="true" />
              <div
                className="sim-service-card-content"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 64,
                  marginBottom: 26,
                }}
              >
                <img
                  src="/simintpay-branca.svg"
                  alt="SimIntPay"
                  style={{ width: 38, height: 'auto', display: 'block' }}
                />
              </div>
              <h3
                className="sim-service-card-content"
                style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}
              >
                Pronto para crescer?
              </h3>
              <p
                className="sim-service-card-content"
                style={{
                  fontSize: 16,
                  lineHeight: 1.65,
                  color: 'rgba(255,255,255,.82)',
                  flex: 1,
                }}
              >
                Você com a gente vende muito mais.
              </p>
              <Link
                href="/cadastro"
                className="sim-service-card-action sim-btn sim-btn--solid"
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 22,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                  background: '#761FE3',
                  padding: '14px 26px',
                  borderRadius: 10,
                }}
              >
                Começar agora
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      <section
        id="como-funciona"
        style={{ width: '100%', background: '#141414', padding: '30px 0 96px' }}
      >
        <div
          className="sim-section-inner"
          style={{ maxWidth: 1320, margin: '0 auto', padding: '0 40px' }}
        >
          <Reveal
            variant="zoom"
            className="sim-steps-box"
            style={{
              borderRadius: 14,
              background: 'var(--accent)',
              padding: '52px 64px',
              width: 'calc(100% + 80px)',
              marginLeft: -40,
              marginRight: -40,
              backgroundImage:
                'radial-gradient(600px 300px at 80% 0%,rgba(255,255,255,.12),transparent)',
            }}
          >
            <h2
              className="sim-steps-title"
              style={{
                textAlign: 'center',
                fontSize: 46,
                fontWeight: 600,
                letterSpacing: '-.5px',
                marginBottom: 32,
              }}
            >
              Do cadastro à primeira venda!
            </h2>
            <div className="sim-steps-grid">
              {steps.map((st, i) => (
                <Reveal
                  key={st.n}
                  variant="up"
                  delay={150 + i * 100}
                  style={{
                    borderRadius: 10,
                    background: 'rgba(255,255,255,.1)',
                    padding: '34px 28px',
                    minHeight: 190,
                  }}
                >
                  <div
                    style={{
                      fontSize: 44,
                      fontWeight: 700,
                      color: '#fff',
                      marginBottom: 18,
                    }}
                  >
                    {st.n}
                  </div>
                  <h3
                    style={{ fontSize: 22, fontWeight: 600, marginBottom: 12 }}
                  >
                    {st.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 16,
                      lineHeight: 1.6,
                      color: 'rgba(255,255,255,.78)',
                    }}
                  >
                    {st.body}
                  </p>
                </Reveal>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section
        style={{ width: '100%', background: '#141414', padding: '60px 0 96px' }}
      >
        <div
          className="sim-section-inner"
          style={{
            maxWidth: 1320,
            margin: '0 auto',
            padding: '0 40px',
            display: 'flex',
            alignItems: 'center',
            gap: 64,
            flexWrap: 'wrap',
          }}
        >
          <Reveal variant="right" style={{ flex: '1 1 440px', minWidth: 320 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '3px',
                color: 'var(--accent-light)',
                marginBottom: 18,
              }}
            >
              SUPORTE
            </div>
            <h2
              style={{
                fontSize: 48,
                lineHeight: 1.16,
                fontWeight: 600,
                letterSpacing: '-.6px',
                marginBottom: 30,
              }}
            >
              Atendimento que realmente{' '}
              <span
                style={{
                  fontFamily: 'var(--font-landing-lora), Lora, serif',
                  fontStyle: 'italic',
                  fontWeight: 600,
                  borderBottom: '4px solid var(--accent)',
                }}
              >
                resolve
              </span>
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                marginBottom: 36,
              }}
            >
              {supportList.map((li) => (
                <div
                  key={li}
                  className="sim-support-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <span
                    className="sim-support-check"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: 'rgba(118,31,227,.2)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <i
                      className="fa-solid fa-check"
                      style={{ fontSize: 12, color: 'var(--accent-light)' }}
                    />
                  </span>
                  <span style={{ fontSize: 17, color: '#d6d6d6' }}>{li}</span>
                </div>
              ))}
            </div>
            <Link
              href="/cadastro"
              className="sim-btn sim-btn--solid"
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: '#fff',
                padding: '18px 34px',
                borderRadius: 11,
                background: 'var(--accent)',
                display: 'inline-block',
              }}
            >
              Começar agora
            </Link>
          </Reveal>
          <Reveal
            variant="left"
            delay={120}
            style={{
              flex: '1 1 440px',
              minWidth: 320,
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <SimpaySupportChatCard />
          </Reveal>
        </div>
      </section>

      <section
        id="recursos"
        style={{
          position: 'relative',
          width: '100%',
          background: '#141414',
          padding: '60px 0 96px',
          overflow: 'visible',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '8%',
            top: '46%',
            width: 420,
            height: 300,
            background:
              'radial-gradient(circle,rgba(118,31,227,.18),transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <div className="sim-section-inner sim-features-layout">
          <div className="sim-features-left">
            <Reveal variant="right" className="sim-features-intro">
              <div className="sim-features-eyebrow">NOSSOS RECURSOS</div>
              <h2 className="sim-features-title">
                Tudo o que você precisa para{' '}
                <span className="sim-features-title-accent">vender mais!</span>
              </h2>
              <Link href="/cadastro" className="sim-features-cta sim-btn">
                Começar agora
              </Link>
            </Reveal>
            <div className="sim-features-left-card">
              {renderFeatureCard(featureCards[1], false, {
                variant: 'up',
                delay: 120,
              })}
            </div>
          </div>
          <div className="sim-features-right">
            {renderFeatureCard(featureCards[0], true, {
              variant: 'left',
              delay: 80,
            })}
            {renderFeatureCard(featureCards[2], false, {
              variant: 'left',
              delay: 200,
            })}
          </div>
        </div>
      </section>

      <SimBrandMarquee />

      <section
        style={{ width: '100%', background: '#141414', padding: '80px 0 96px' }}
      >
        <Reveal
          className="sim-section-inner"
          style={{
            maxWidth: 1000,
            margin: '0 auto',
            padding: '0 40px',
            textAlign: 'center',
          }}
        >
          <h2
            style={{
              fontSize: 46,
              lineHeight: 1.22,
              fontWeight: 600,
              letterSpacing: '-.6px',
              marginBottom: 28,
            }}
          >
            O futuro dos pagamentos não é apenas receber.{' '}
            <span
              style={{
                fontFamily: 'var(--font-landing-lora), Lora, serif',
                fontStyle: 'italic',
                fontWeight: 600,
                color: 'var(--accent-light)',
              }}
            >
              É vender mais, fidelizar mais e crescer mais.
            </span>
          </h2>
          <p
            style={{
              fontSize: 20,
              lineHeight: 1.72,
              color: '#a3a3a3',
              maxWidth: 820,
              margin: '0 auto 40px',
            }}
          >
            Acreditamos que receber pagamentos deve ser simples, seguro e
            estratégico. Por isso, criamos a Sim Int Pay: uma estrutura que
            combina tecnologia de ponta, gestão eficiente e benefícios
            exclusivos para ajudar empresas a vender mais e construir
            relacionamentos duradouros com seus clientes.
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 24,
              flexWrap: 'wrap',
            }}
          >
            <Link
              href="/cadastro"
              className="sim-btn sim-btn--solid"
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: '#fff',
                padding: '20px 38px',
                borderRadius: 11,
                background: 'var(--accent)',
                display: 'inline-block',
              }}
            >
              Começar agora
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 30, fontWeight: 700 }}>4.9</span>
              <div style={{ textAlign: 'left' }}>
                <div
                  style={{
                    color: '#FCCA18',
                    fontSize: 16,
                    letterSpacing: '2px',
                  }}
                >
                  <i className="fa-solid fa-star" />
                  <i className="fa-solid fa-star" />
                  <i className="fa-solid fa-star" />
                  <i className="fa-solid fa-star" />
                  <i className="fa-solid fa-star" />
                </div>
                <div style={{ fontSize: 15, color: '#a3a3a3' }}>Avaliações</div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      <section id="avaliacoes" className="sim-reviews-section">
        <div className="sim-reviews-wrap">
          <div className="sim-reviews-panel">
            <Reveal className="sim-reviews-header">
              <div className="sim-reviews-eyebrow">DEPOIMENTOS</div>
              <h2 className="sim-reviews-title">
                Construindo{' '}
                <span
                  style={{
                    borderBottom: '4px solid var(--accent)',
                    paddingBottom: 2,
                  }}
                >
                  confiança
                </span>{' '}
                em cada transação
              </h2>
            </Reveal>
            <SimReviewsCarousel />
          </div>
        </div>
      </section>

      <section
        id="parceiros"
        style={{
          position: 'relative',
          width: '100%',
          background: '#141414',
          padding: '70px 0 100px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '55%',
            transform: 'translate(-50%,-50%)',
            width: 760,
            height: 520,
            background: 'url(/assets/partners-bg.png) center/contain no-repeat',
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        />
        <div
          className="sim-section-inner"
          style={{
            position: 'relative',
            maxWidth: 1320,
            margin: '0 auto',
            padding: '0 40px',
            textAlign: 'center',
          }}
        >
          <Reveal>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '3px',
                color: 'var(--accent-light)',
                marginBottom: 16,
              }}
            >
              NOSSOS PARCEIROS
            </div>
            <h2
              style={{
                fontSize: 44,
                lineHeight: 1.2,
                fontWeight: 600,
                letterSpacing: '-.5px',
                marginBottom: 50,
              }}
            >
              Construindo resutados
              <br />
              ao lado de{' '}
              <span
                style={{
                  fontFamily: 'var(--font-landing-lora), Lora, serif',
                  fontStyle: 'italic',
                  fontWeight: 600,
                  borderBottom: '4px solid var(--accent)',
                }}
              >
                grandes marcas
              </span>
            </h2>
          </Reveal>
          <SimPartnersOrbit />
        </div>
      </section>

      <section
        className="sim-cta-section"
        style={{ width: '100%', background: '#141414', padding: '0 0 90px' }}
      >
        <div
          className="sim-section-inner"
          style={{ maxWidth: 1320, margin: '0 auto', padding: '0 40px' }}
        >
          <Reveal variant="zoom" className="sim-cta-wrap">
            <div className="sim-cta-svg-wrap">
              <div className="sim-cta-content">
                <h2 className="sim-cta-title">
                  Leve sua operação
                  <br />
                  para o <span>próximo nível</span>
                </h2>
                <Link href="/cadastro" className="sim-cta-button">
                  Começar agora
                </Link>
              </div>
            </div>
            <img
              src="/images/cta-person.png"
              alt=""
              aria-hidden="true"
              className="sim-cta-person"
            />
          </Reveal>
        </div>
      </section>

      <footer className="sim-footer">
        <div className="sim-footer-inner">
          <Link href="/" className="sim-footer-logo">
            <img src="/assets/logo.svg" alt="SimIntPay" />
          </Link>
          <p className="sim-footer-legal">
            Todos os direitos reservados{' '}
            <span className="sim-footer-legal-accent">SIM Intermediações</span>.
            CNPJ: 38.486.051/0001-48.
          </p>
        </div>
      </footer>
    </div>
  );
}
