import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fetchLabs,
  fetchRobotPollTargets,
  type RobotPollTarget,
  saveRobotPollTargets,
} from '../api/cloudApi';
import { defaultSchemeForRobotAddress, parseRobotIpsFromText } from '../utils/robotAddress';

const emptyPollTargetRow = (): RobotPollTarget => ({ ip: '', scheme: 'http', port: 31950 });

function PollTargetsFrame({
  embedded,
  children,
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  if (embedded) return <div>{children}</div>;
  return (
    <section
      className="mb-10 rounded-xl border border-border bg-card p-6 shadow-sm"
      aria-label="Robot addresses for relay agent"
    >
      {children}
    </section>
  );
}

function PollTargetsTitle({ embedded }: { embedded: boolean }) {
  if (embedded) return null;
  return (
    <h2 className="font-display text-lg font-normal tracking-tight text-foreground">
      Robot addresses (relay agent)
    </h2>
  );
}

export function CloudRobotPollTargets({
  token,
  embedded = false,
}: {
  token: string;
  /** Omit card chrome and title when wrapped in `CloudSetupAccordion` on the dashboard. */
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const { data: labs } = useQuery({
    queryKey: ['cloud', 'labs', token],
    queryFn: () => fetchLabs(token),
    enabled: !!token,
  });
  const [labId, setLabId] = useState<string>('');

  /** Matches CloudAgentCredentials: no empty id before useEffect runs. */
  const effectiveLabId = labId || labs?.[0]?.id || '';

  const { data: targets, isLoading } = useQuery({
    queryKey: ['cloud', 'robot-poll-targets', token, effectiveLabId],
    queryFn: () => fetchRobotPollTargets(token, effectiveLabId),
    enabled: !!token && !!effectiveLabId,
    /** Avoid refetch resetting local rows while editing (see dirty + hydrate below). */
    refetchOnWindowFocus: false,
  });

  const [rows, setRows] = useState<RobotPollTarget[]>([]);
  const [importText, setImportText] = useState('');
  /** When true, server refetches must not overwrite `rows` (user is editing or removed rows). */
  const [dirty, setDirty] = useState(false);
  const lastHydratedLabRef = useRef<string>('');

  useEffect(() => {
    if (effectiveLabId === lastHydratedLabRef.current) return;
    const prevLab = lastHydratedLabRef.current;
    lastHydratedLabRef.current = effectiveLabId;
    setDirty(false);
    if (prevLab !== '') setRows([]);
  }, [effectiveLabId]);

  useEffect(() => {
    if (dirty || targets === undefined) return;
    setRows(targets.length > 0 ? [...targets] : [emptyPollTargetRow()]);
  }, [effectiveLabId, targets, dirty]);

  const saveMut = useMutation({
    mutationFn: () => saveRobotPollTargets(token, effectiveLabId, rows.filter((r) => r.ip.trim())),
    onSuccess: (saved) => {
      qc.setQueryData(['cloud', 'robot-poll-targets', token, effectiveLabId], saved);
      setRows(saved.length > 0 ? [...saved] : [emptyPollTargetRow()]);
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['cloud', 'robots', token] });
    },
  });

  if (!labs?.length) return null;

  return (
    <PollTargetsFrame embedded={embedded}>
      <PollTargetsTitle embedded={embedded} />
      <p className={`text-sm text-muted-foreground ${embedded ? 'mt-0' : 'mt-2'}`}>
        The lab relay agent loads this list from the cloud — it does not store robot IPs locally in production.
        Set your Opentrons robot IPs or hostnames here; the agent polls them and sends telemetry to the backend.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground" htmlFor="poll-lab">
          Lab
        </label>
        <select
          id="poll-lab"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={effectiveLabId}
          onChange={(e) => setLabId(e.target.value)}
        >
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1">
                <label className="text-xs text-muted-foreground">Address</label>
                <input
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={row.ip}
                  placeholder="e.g. 192.168.1.10"
                  onChange={(e) => {
                    setDirty(true);
                    const next = [...rows];
                    next[i] = { ...next[i], ip: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Scheme</label>
                <select
                  className="mt-1 block rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={row.scheme}
                  onChange={(e) => {
                    setDirty(true);
                    const next = [...rows];
                    next[i] = { ...next[i], scheme: e.target.value as 'http' | 'https' };
                    setRows(next);
                  }}
                >
                  <option value="http">http</option>
                  <option value="https">https</option>
                </select>
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground">Port</label>
                <input
                  type="number"
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={row.port}
                  min={1}
                  max={65535}
                  onChange={(e) => {
                    setDirty(true);
                    const next = [...rows];
                    next[i] = { ...next[i], port: Number(e.target.value) || 31950 };
                    setRows(next);
                  }}
                />
              </div>
              <button
                type="button"
                className="rounded-md border border-destructive/50 px-2 py-2 text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDirty(true);
                  setRows(rows.filter((_, j) => j !== i));
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => {
              setDirty(true);
              setRows([...rows, emptyPollTargetRow()]);
            }}
          >
            + Add row
          </button>
        </div>
      )}

      <div className="mt-6">
        <label className="text-xs text-muted-foreground" htmlFor="bulk-import">
          Bulk import (paste IPs or JSON; merges into rows above)
        </label>
        <textarea
          id="bulk-import"
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
          rows={3}
          placeholder="10.0.0.1, 10.0.0.2 or JSON from your network list"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm hover:bg-muted"
          onClick={() => {
            setDirty(true);
            const { addresses } = parseRobotIpsFromText(importText);
            const added = addresses.map((ip) => ({
              ip,
              scheme: defaultSchemeForRobotAddress(ip),
              port: 31950,
            }));
            setRows((prev) => [...prev.filter((r) => r.ip.trim()), ...added]);
            setImportText('');
          }}
        >
          Merge imported addresses
        </button>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={saveMut.isPending || !effectiveLabId}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? 'Saving…' : 'Save to cloud'}
        </button>
        {saveMut.isError && (
          <span className="text-sm text-destructive">{(saveMut.error as Error).message}</span>
        )}
        {saveMut.isSuccess && <span className="text-sm text-muted-foreground">Saved.</span>}
      </div>
    </PollTargetsFrame>
  );
}
