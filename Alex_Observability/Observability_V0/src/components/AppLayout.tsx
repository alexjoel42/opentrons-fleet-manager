import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/authContext';
import { FleetStatusLegendBar } from './FleetStatusLegendBar';

const OPENTRONS_LOGO_PATH = '/opentrons-logo.svg';

export function AppLayout() {
  const [logoError, setLogoError] = useState(false);
  const location = useLocation();
  const { isCloudMode, token, logout } = useAuth();

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
              aria-label="Opentrons Fleet home"
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
              <span className="font-sans text-base font-semibold text-muted-foreground">Fleet</span>
            </Link>
            {!isCloudMode && (
              <FleetStatusLegendBar className="max-w-full lg:max-w-[min(100%,42rem)]" />
            )}
          </div>
          <nav className="flex shrink-0 flex-wrap items-center gap-1" aria-label="Main">
          {!isCloudMode && (
            <Link
              to="/"
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
                location.pathname === '/'
                  ? 'bg-accent/10 text-accent'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Setup
            </Link>
          )}
          <Link
            to="/dashboard"
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${
              location.pathname === '/dashboard'
                ? 'bg-accent/10 text-accent'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            Dashboard
          </Link>
          {isCloudMode && token && (
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Sign out
            </button>
          )}
        </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 bg-surface px-6 py-8 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
