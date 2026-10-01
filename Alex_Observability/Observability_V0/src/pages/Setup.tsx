import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { addRobotIp } from '../api/robotApi';
import { ImportRobotIps } from '../components/ImportRobotIps';
import { isValidRobotAddress } from '../utils/robotAddress';

export function Setup() {
  const { t } = useTranslation();
  const [ip, setIp] = useState('');
  const navigate = useNavigate();

  const addMutation = useMutation({
    mutationFn: (addr: string) => addRobotIp(addr),
    onSuccess: () => setIp(''),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = ip.trim();
    if (!trimmed) return;
    if (!isValidRobotAddress(trimmed)) {
      addMutation.reset();
      return;
    }
    addMutation.mutate(trimmed);
  };

  const ipValid = ip.trim() !== '' && isValidRobotAddress(ip);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-12 text-center">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-8 text-left shadow-lg">
        <div className="section-label mb-4">
          <span className="section-label-dot" aria-hidden />
          <span>{t('nav.setup')}</span>
        </div>
        <h1 className="font-display text-2xl font-normal tracking-tight text-foreground md:text-3xl">
          {t('setup.titleBefore')} <span className="gradient-text">{t('setup.titleAccent')}</span>
        </h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          {t('setup.description')}
        </p>

        <form onSubmit={handleSubmit} className="mt-6" aria-label={t('setup.addRobotAria')}>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder={t('setup.ipPlaceholder')}
              aria-label={t('setup.ipAria')}
              className="h-12 min-w-[140px] flex-1 rounded-xl border border-border bg-transparent px-4 text-foreground placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            />
            <button
              type="submit"
              disabled={!ipValid || addMutation.isPending}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-accent to-accent-secondary px-6 font-medium text-accent-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_14px_rgba(0,82,255,0.25)] active:scale-[0.98] disabled:opacity-60"
            >
              {addMutation.isPending ? t('common.adding') : t('setup.addRobot')}
            </button>
          </div>
        </form>

        {addMutation.isError && (
          <p className="mt-3 text-sm text-error" role="alert">
            {addMutation.error instanceof Error ? addMutation.error.message : t('common.addFailed')}
          </p>
        )}
        {addMutation.isSuccess && (
          <p className="mt-3 text-sm text-success" role="status">
            {t('setup.added')}
          </p>
        )}
        {ip.trim() && !isValidRobotAddress(ip) && (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            {t('setup.invalidIp')}
          </p>
        )}

        <div className="mt-8">
          <ImportRobotIps variant="setup" />
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          {t('setup.backendHelpBefore')}{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            make run-backend
          </code>{' '}
          {t('setup.backendHelpAfter')}
        </p>

        <div className="mt-6 border-t border-border pt-6">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-accent to-accent-secondary px-6 font-medium text-accent-foreground shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_14px_rgba(0,82,255,0.25)] active:scale-[0.98]"
          >
            {t('setup.viewFleet')}
          </button>
        </div>
      </div>
    </div>
  );
}
