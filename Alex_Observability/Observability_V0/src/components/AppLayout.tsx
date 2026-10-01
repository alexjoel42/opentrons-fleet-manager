import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FleetStatusLegendBar } from './FleetStatusLegendBar';

const OPENTRONS_LOGO_PATH = '/opentrons-logo.svg';

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const [logoError, setLogoError] = useState(false);
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header
        className="sticky top-0 z-10 border-border border-b bg-card px-6 py-3 shadow-sm"
        role="banner"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
            <Link
              to="/"
              className="flex shrink-0 items-center gap-2 text-foreground no-underline transition-opacity hover:opacity-90"
              aria-label={t('nav.ariaHome')}
            >
              {logoError ? (
                <span className="font-display text-xl font-normal tracking-tight text-foreground">
                  Opentrons
                </span>
              ) : (
                <img
                  src={OPENTRONS_LOGO_PATH}
                  alt=""
                  className="h-7 w-auto"
                  onError={() => setLogoError(true)}
                />
              )}
              <span className="font-sans text-base font-semibold text-muted-foreground">{t('dashboard.fleet')}</span>
            </Link>
            <FleetStatusLegendBar className="max-w-full lg:max-w-[min(100%,42rem)]" />
          </div>
          <nav className="flex shrink-0 flex-wrap items-center gap-1" aria-label={t('nav.ariaMain')}>
            <Link
              to="/"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                location.pathname === '/'
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t('nav.setup')}
            </Link>
            <Link
              to="/dashboard"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                location.pathname === '/dashboard'
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t('nav.dashboard')}
            </Link>
            <label className="ml-1">
              <span className="sr-only">{t('nav.language')}</span>
              <select
                value={i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'}
                onChange={(event) => void i18n.changeLanguage(event.target.value)}
                aria-label={t('nav.language')}
                className="rounded-lg border border-border bg-card px-2 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="en">English</option>
                <option value="zh-CN">中文（简体）</option>
              </select>
            </label>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 bg-surface px-6 py-8 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
