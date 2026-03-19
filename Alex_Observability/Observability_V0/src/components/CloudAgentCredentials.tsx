import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createLab,
  createLabAgentToken,
  fetchLabs,
  getCloudApiBaseUrl,
} from '../api/cloudApi';

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export function CloudAgentCredentials({ token }: { token: string }) {
  const qc = useQueryClient();
  const { data: labs, isLoading } = useQuery({
    queryKey: ['cloud', 'labs', token],
    queryFn: () => fetchLabs(token),
    enabled: !!token,
  });
  const [labId, setLabId] = useState('');
  const [tokenLabel, setTokenLabel] = useState('');
  const [newAgentToken, setNewAgentToken] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);

  /** Resolves immediately when labs load (avoids empty Lab ID before useEffect ran). */
  const effectiveLabId = labId || labs?.[0]?.id || '';

  const backendUrl = getCloudApiBaseUrl();

  const createLabMut = useMutation({
    mutationFn: () => createLab(token, 'My lab'),
    onSuccess: (lab) => {
      setLabId(lab.id);
      void qc.invalidateQueries({ queryKey: ['cloud', 'labs', token] });
    },
  });

  const generateTokenMut = useMutation({
    mutationFn: () => createLabAgentToken(token, effectiveLabId, { label: tokenLabel || undefined }),
    onSuccess: (data) => {
      setNewAgentToken(data.token);
      setTokenLabel('');
    },
  });

  const configSnippet =
    newAgentToken && backendUrl
      ? JSON.stringify(
          {
            lab_id: effectiveLabId,
            agent_token: newAgentToken,
            backend_url: backendUrl,
            robot_poll_interval_seconds: 5,
          },
          null,
          2,
        )
      : null;

  const flash = (key: string) => {
    setCopyFlash(key);
    window.setTimeout(() => setCopyFlash(null), 2000);
  };

  if (isLoading) {
    return (
      <section
        className="mb-10 rounded-xl border border-border bg-card p-6 shadow-sm"
        aria-label="Relay agent credentials"
      >
        <p className="text-sm text-muted-foreground">Loading labs…</p>
      </section>
    );
  }

  if (!labs?.length) {
    return (
      <section
        className="mb-10 rounded-xl border border-border bg-card p-6 shadow-sm"
        aria-label="Relay agent credentials"
      >
        <h2 className="font-display text-lg font-normal tracking-tight text-foreground">
          Relay agent credentials
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a lab first, then you can generate an agent token and copy values for{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">agent_config.json</code>.
        </p>
        <button
          type="button"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={createLabMut.isPending}
          onClick={() => createLabMut.mutate()}
        >
          {createLabMut.isPending ? 'Creating…' : 'Create lab'}
        </button>
        {createLabMut.isError && (
          <p className="mt-2 text-sm text-destructive">{(createLabMut.error as Error).message}</p>
        )}
      </section>
    );
  }

  return (
    <section
      className="mb-10 rounded-xl border border-border bg-card p-6 shadow-sm"
      aria-label="Relay agent credentials"
    >
      <h2 className="font-display text-lg font-normal tracking-tight text-foreground">
        Relay agent credentials
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Your sign-in <strong className="text-foreground">access token</strong> is not the same as the{' '}
        <strong className="text-foreground">agent token</strong> below — the relay uses{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">LAB_ID</code>,{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">AGENT_TOKEN</code>, and{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">BACKEND_URL</code>. The agent token is only
        shown once when generated — copy it now. You can generate at most{' '}
        <strong className="text-foreground">4 new tokens per lab per day</strong> (UTC).
      </p>

      <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
        <p className="text-sm font-medium text-foreground">Lab ID</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use this value for the <code className="rounded bg-muted px-1 py-0.5">LAB_ID</code> environment variable
          when running the relay agent (it is not your login password or access token).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="max-w-full break-all rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
            {effectiveLabId || '—'}
          </code>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            disabled={!effectiveLabId}
            onClick={() => {
              void copyText(effectiveLabId).then(() => flash('lab'));
            }}
          >
            {copyFlash === 'lab' ? 'Copied' : 'Copy Lab ID'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="cred-lab">
          Lab
        </label>
        <select
          id="cred-lab"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={effectiveLabId}
          onChange={(e) => {
            setLabId(e.target.value);
            setNewAgentToken(null);
          }}
        >
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Backend URL
          </span>
          {backendUrl ? (
            <>
              <code className="max-w-full break-all rounded-md bg-muted/80 px-2 py-1 font-mono text-sm">
                {backendUrl}
              </code>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                onClick={() => {
                  void copyText(backendUrl).then(() => flash('url'));
                }}
              >
                {copyFlash === 'url' ? 'Copied' : 'Copy'}
              </button>
            </>
          ) : (
            <span className="text-sm text-amber-600 dark:text-amber-400">
              Set <code className="rounded bg-muted px-1">VITE_API_URL</code> at build time so the app knows
              your API URL.
            </span>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        <label className="text-xs text-muted-foreground" htmlFor="token-label">
          Token label (optional)
        </label>
        <input
          id="token-label"
          className="mt-1 max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="e.g. Lab PC 1"
          value={tokenLabel}
          onChange={(e) => setTokenLabel(e.target.value)}
        />
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            disabled={!effectiveLabId || generateTokenMut.isPending}
            onClick={() => generateTokenMut.mutate()}
          >
            {generateTokenMut.isPending ? 'Generating…' : 'Generate new agent token'}
          </button>
        </div>
        {generateTokenMut.isError && (
          <p className="mt-2 text-sm text-destructive">{(generateTokenMut.error as Error).message}</p>
        )}
      </div>

      {newAgentToken && (
        <div
          className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 dark:bg-amber-500/5"
          role="status"
        >
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            New agent token (copy now — it won’t be shown again)
          </p>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <code className="max-w-full flex-1 break-all rounded-md bg-background/80 px-2 py-2 font-mono text-xs">
              {newAgentToken}
            </code>
            <button
              type="button"
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
              onClick={() => {
                void copyText(newAgentToken).then(() => flash('agent'));
              }}
            >
              {copyFlash === 'agent' ? 'Copied' : 'Copy token'}
            </button>
          </div>
          {configSnippet && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Example agent_config.json</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
                {configSnippet}
              </pre>
              <button
                type="button"
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                onClick={() => {
                  void copyText(configSnippet).then(() => flash('json'));
                }}
              >
                {copyFlash === 'json' ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
