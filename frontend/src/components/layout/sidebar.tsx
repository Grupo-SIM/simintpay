'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type CSSProperties, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  CreditCard,
  ArrowDownToLine,
  FileText,
  Users,
  Package,
  Link2,
  BarChart2,
  Settings,
  Sun,
  Moon,
  Smartphone,
  UserPlus,
  Percent,
  UsersRound,
  Receipt,
} from 'lucide-react';
import { useTheme } from '@/components/theme/ThemeProvider';
import {
  createApiClient,
  getDefaultApiBaseUrl,
} from '@/services/api/api.client';
import { endpoints } from '@/services/api/endpoints';
import { useCurrentUser } from '@/hooks/use-current-user';

const MENU_ITEMS = [
  { href: '/painel', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/transacoes', icon: CreditCard, label: 'Transações' },
  { href: '/saques', icon: ArrowDownToLine, label: 'Saques' },
  { href: '/assinantes', icon: Users, label: 'Assinantes' },
  { href: '/cobrancas', icon: Receipt, label: 'Cobranças' },
  { href: '/relatorio', icon: BarChart2, label: 'Relatórios' },
];

const RENOVADA_ITEMS = [
  { href: '/maquinetas', icon: Smartphone, label: 'Maquinetas' },
];

const MANAGE_ITEMS = [
  { href: '/configuracoes/perfil', icon: Settings, label: 'Configurações' },
];

const ADMIN_ITEMS = [
  { href: '/admin/contas', icon: UsersRound, label: 'Contas' },
  { href: '/admin/taxas', icon: Percent, label: 'Taxas' },
  { href: '/admin/saques', icon: ArrowDownToLine, label: 'Saques' },
];

const W_OPEN = 200;
const W_CLOSED = 62;

function setDashboardSidebarWidthPx(px: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty(
    '--dashboard-sidebar-width',
    `${px}px`,
  );
}

function NavLink({
  href,
  icon: Icon,
  label,
  badge,
  open,
  pathname,
  labelStyle,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: number;
  open: boolean;
  pathname: string;
  labelStyle: CSSProperties;
}) {
  const active =
    href !== '#' &&
    ((href === '/admin/contas' && pathname.startsWith('/comunidades/')) ||
      pathname === href ||
      pathname.startsWith(href + '/'));
  return (
    <Link
      href={href}
      className="dashboard-nav-link"
      data-active={active ? 'true' : 'false'}
      title={badge && badge > 0 ? `${badge} pendente(s)` : undefined}
      style={{
        position: 'relative',
        justifyContent: open ? 'flex-start' : 'center',
        gap: open ? 9 : 0,
        padding: open ? '7px 10px' : '8px 0',
      }}
    >
      <Icon
        size={16}
        strokeWidth={active ? 2.2 : 1.7}
        style={{ flexShrink: 0 }}
      />
      <span style={labelStyle}>{label}</span>
      {/* Bolinha de pendência (some quando a cobrança é paga) */}
      {!!badge && badge > 0 && (
        <span
          style={{
            position: 'absolute',
            top: 6,
            right: open ? 10 : 8,
            width: 8,
            height: 8,
            borderRadius: 9999,
            background: '#ef4444',
            boxShadow: '0 0 0 2px rgba(239,68,68,0.25)',
          }}
        />
      )}
    </Link>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    return () => setDashboardSidebarWidthPx(W_CLOSED);
  }, []);
  const { theme, setTheme } = useTheme();
  const { user } = useCurrentUser();

  // Bolinha no item "Cobranças": quantidade de cobranças PENDENTES do cliente.
  // Persiste até ele pagar (re-checa a cada 60s e ao trocar de rota).
  const [cobrancasPendentes, setCobrancasPendentes] = useState(0);
  useEffect(() => {
    if (!user || user.isAdmin) return;
    let ativo = true;
    const buscar = () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      });
      api
        .get<{ data: { status: string }[] }>(endpoints.admin.cobrancas.minhas)
        .then((res) => {
          if (ativo)
            setCobrancasPendentes(
              (res.data ?? []).filter((c) => c.status === 'PENDING').length,
            );
        })
        .catch(() => {});
    };
    buscar();
    const t = setInterval(buscar, 60_000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [user, pathname]);

  // Bolinha no item "Solicitações" (admin): leads PENDENTES aguardando aprovação.
  const [solicitacoesPendentes, setSolicitacoesPendentes] = useState(0);
  useEffect(() => {
    if (!user?.isAdmin) return;
    let ativo = true;
    const buscar = () => {
      const api = createApiClient({
        baseUrl: getDefaultApiBaseUrl(),
        getToken: () => localStorage.getItem('access_token'),
      });
      api
        .get<{ total?: number; data?: unknown[] }>(endpoints.admin.leads.list, {
          query: { page: 1, pageSize: 1, status: 'PENDING' },
        })
        .then((res) => {
          if (ativo)
            setSolicitacoesPendentes(res.total ?? res.data?.length ?? 0);
        })
        .catch(() => {});
    };
    buscar();
    const t = setInterval(buscar, 60_000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, [user, pathname]);

  const labelStyle: CSSProperties = {
    opacity: open ? 1 : 0,
    maxWidth: open ? 160 : 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    transition: 'opacity 0.2s, max-width 0.25s cubic-bezier(0.4,0,0.2,1)',
    fontSize: 13,
    fontWeight: 'inherit',
  };

  const sectionLabelStyle: CSSProperties = {
    opacity: open ? 1 : 0,
    maxHeight: open ? 28 : 0,
    overflow: 'hidden',
    transition: 'opacity 0.15s, max-height 0.25s cubic-bezier(0.4,0,0.2,1)',
    fontSize: 10.5,
    fontWeight: 600,
    color: 'var(--dash-section-label)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: open ? '6px 6px 8px' : '0 6px',
    whiteSpace: 'nowrap',
  };

  const isRenovada =
    user?.tenantModule?.slug?.toLowerCase().includes('renovada') ||
    user?.modulo?.slug?.toLowerCase().includes('renovada') ||
    user?.email?.toLowerCase().includes('renovada') ||
    user?.name?.toLowerCase().includes('renovada');

  return (
    <aside
      onMouseEnter={() => {
        setOpen(true);
        setDashboardSidebarWidthPx(W_OPEN);
      }}
      onMouseLeave={() => {
        setOpen(false);
        setDashboardSidebarWidthPx(W_CLOSED);
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: open ? W_OPEN : W_CLOSED,
        background: 'var(--dashboard-sidebar-bg)',
        borderRight: '1px solid var(--dashboard-sidebar-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        fontFamily: "'Inter', sans-serif",
        transition: `width 0.3s cubic-bezier(0.4,0,0.2,1)`,
        overflow: 'hidden',
        boxShadow: open ? 'var(--dashboard-sidebar-shadow-open)' : 'none',
      }}
    >
      {/* Logo: altura de layout = header (borda alinhada); imagem pode ultrapassar sem mudar a linha */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          boxSizing: 'border-box',
          height: 'var(--dashboard-header-height, 80px)',
          flexShrink: 0,
          borderBottom: '1px solid var(--dash-sidebar-divider)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: open ? 'flex-start' : 'center',
          paddingLeft: open ? 14 : 0,
          paddingRight: 8,
          transition:
            'padding 0.25s cubic-bezier(0.4,0,0.2,1), justify-content 0s',
          overflow: 'visible',
        }}
      >
        <Link
          href="/painel"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: open ? 'flex-start' : 'center',
            gap: 10,
            textDecoration: 'none',
            flexShrink: 0,
            width: '100%',
            height: '100%',
          }}
        >
          <span
            className={open ? 'dashboard-sidebar-logo-full' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'all 0.25s ease',
            }}
          >
            {open ? (
              <img
                src="/logo-simpay-branca.svg"
                alt="Simintpay"
                style={{
                  height: 44,
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            ) : (
              <img
                src="/3.svg"
                alt="S"
                style={{
                  height: 36,
                  width: 'auto',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            )}
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav
        style={{
          flex: 1,
          padding: '10px 8px 6px',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/painel"
          icon={LayoutDashboard}
          label="Dashboard"
        />
        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/transacoes"
          icon={CreditCard}
          label="Transações"
        />
        {!user?.isAdmin && (
          <NavLink
            open={open}
            pathname={pathname}
            labelStyle={labelStyle}
            href="/saques"
            icon={ArrowDownToLine}
            label="Saques"
          />
        )}
        {!user?.isAdmin && (
          <>
            {/* Cobranças geradas pelo master para este cliente — a bolinha indica pendência */}
            <NavLink
              open={open}
              pathname={pathname}
              labelStyle={labelStyle}
              href="/cobrancas"
              icon={Receipt}
              label="Cobranças"
              badge={cobrancasPendentes}
            />
          </>
        )}

        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/relatorio"
          icon={BarChart2}
          label="Relatórios"
        />
        {user?.isAdmin && (
          <>
            <NavLink
              open={open}
              pathname={pathname}
              labelStyle={labelStyle}
              href="/assinantes"
              icon={Users}
              label="Assinantes"
            />
          </>
        )}

        {isRenovada &&
          user?.isAdmin &&
          RENOVADA_ITEMS.map((item) => (
            <NavLink
              open={open}
              pathname={pathname}
              labelStyle={labelStyle}
              key={item.href}
              {...item}
            />
          ))}

        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/ofertas"
          icon={Link2}
          label="Ofertas"
        />

        {user?.isAffiliate && (
          <NavLink
            open={open}
            pathname={pathname}
            labelStyle={labelStyle}
            href="/afiliados"
            icon={UserPlus}
            label="Afiliados"
          />
        )}

        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/plataformas"
          icon={Package}
          label="Plataformas"
        />
        <NavLink
          open={open}
          pathname={pathname}
          labelStyle={labelStyle}
          href="/configuracoes/perfil"
          icon={Settings}
          label="Configurações"
        />

        {user?.isAdmin && (
          <>
            <p style={{ ...sectionLabelStyle, paddingTop: open ? 14 : 0 }}>
              Admin
            </p>
            {ADMIN_ITEMS.map((item) => (
              <NavLink
                open={open}
                pathname={pathname}
                labelStyle={labelStyle}
                key={item.href}
                {...item}
                badge={
                  item.href === '/admin/contas'
                    ? solicitacoesPendentes
                    : undefined
                }
              />
            ))}
          </>
        )}
      </nav>

      {/* Theme Toggle */}
      <div
        style={{
          padding: '10px 8px 16px',
          borderTop: '1px solid var(--dash-sidebar-divider)',
          overflow: 'hidden',
        }}
      >
        {open ? (
          <div
            style={{
              display: 'flex',
              background: 'var(--dash-theme-rail-bg)',
              borderRadius: 10,
              padding: 3,
              gap: 2,
            }}
          >
            {(['light', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '6px 0',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11.5,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  background:
                    theme === t
                      ? t === 'dark'
                        ? 'var(--dash-theme-btn-active-dark-bg)'
                        : 'var(--dash-theme-btn-active-light-bg)'
                      : 'transparent',
                  color:
                    theme === t
                      ? t === 'dark'
                        ? 'var(--dash-theme-btn-active-dark-fg)'
                        : 'var(--dash-theme-btn-active-light-fg)'
                      : 'var(--dash-theme-btn-muted-fg)',
                  whiteSpace: 'nowrap',
                }}
              >
                {t === 'light' ? <Sun size={12} /> : <Moon size={12} />}
                {t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '7px 0',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              background: 'var(--dash-theme-collapsed-btn-bg)',
              color: 'var(--dash-theme-collapsed-btn-fg)',
              fontFamily: 'inherit',
              transition: 'background 0.2s',
            }}
          >
            {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        )}
      </div>
    </aside>
  );
}
