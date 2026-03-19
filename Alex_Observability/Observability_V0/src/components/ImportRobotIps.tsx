import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { importRobotIpsBulk } from '../api/robotApi';
import { parseRobotIpsFromText } from '../utils/robotAddress';

type Props = {
  /** Slightly different layout for the setup landing page vs fleet dashboard */
  variant?: 'setup' | 'dashboard';
};

export function ImportRobotIps({ variant = 'dashboard' }: Props) {
  const queryClient = useQueryClient();
  const id = useId();
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: (ips: string[]) => importRobotIpsBulk(ips),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['robots', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['fleet', 'snapshot'] });
      setLocalError(null);
    },
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setText(await f.text());
    setLocalError(null);
    importMutation.reset();
    e.target.value = '';
  };

  const handleImport = () => {
    setLocalError(null);
    const { addresses } = parseRobotIpsFromText(text);
    if (addresses.length === 0) {
      setLocalError(
        'No valid addresses found. Paste ABR IPs.json (ip_address_list), a JSON list of IPs, or comma-separated IPv4 / IPv6 / localhost.'
      );
      return;
    }
    importMutation.mutate(addresses);
  };

  const previewCount = text.trim() ? parseRobotIpsFromText(text).addresses.length : 0;

  const isSetup = variant === 'setup';
  const boxClass = isSetup
    ? 'rounded-xl border border-border bg-muted/30 p-4'
    : 'rounded-lg border-2 border-accent/20 bg-card p-5 ring-1 ring-accent/10';

  return (
    <div className={boxClass}>
      <h2 className={`font-medium text-foreground ${isSetup ? 'text-sm' : 'text-base'}`}>
        Import IP addresses
      </h2>
      <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
        Paste{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">IPs.json</code> (keys under{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">ip_address_list</code>
        ), or a comma-separated list. Choose a file or paste below, then import.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor={`${id}-file`}
          className="inline-flex cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/80"
        >
          Choose file
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          className="sr-only"
          onChange={handleFile}
        />
        {text.trim() !== '' && (
          <span className="text-sm text-muted-foreground">
            {previewCount} valid address{previewCount !== 1 ? 'es' : ''} detected
          </span>
        )}
      </div>

      <textarea
        id={`${id}-paste`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setLocalError(null);
          importMutation.reset();
        }}
        placeholder='Paste IPs.json (ip_address_list) or comma-separated IPs, e.g. 192.0.2.10, 192.0.2.11'
        rows={isSetup ? 5 : 6}
        className={`mt-3 w-full rounded-lg border px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring ${
          isSetup
            ? 'border-border bg-transparent'
            : 'border-2 border-accent/20 bg-white focus:border-accent focus:ring-accent/30'
        }`}
        aria-label="Paste IPs.json or comma-separated robot addresses"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleImport}
          disabled={importMutation.isPending || text.trim() === ''}
          className={
            isSetup
              ? 'inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted/80 disabled:opacity-50'
              : 'inline-flex h-10 items-center justify-center rounded-[200px] border-2 border-accent/40 bg-background px-5 text-sm font-semibold text-foreground hover:bg-accent/5 disabled:opacity-50'
          }
        >
          {importMutation.isPending ? 'Importing…' : 'Import'}
        </button>
        {(localError || importMutation.isError) && (
          <p className="text-sm text-error" role="alert">
            {localError ??
              (importMutation.error instanceof Error
                ? importMutation.error.message
                : 'Import failed')}
          </p>
        )}
        {importMutation.isSuccess && importMutation.data && (
          <p className="text-sm text-success" role="status">
            Added {importMutation.data.added} new robot{importMutation.data.added !== 1 ? 's' : ''}. Fleet
            has {importMutation.data.ips.length} total.
          </p>
        )}
      </div>
    </div>
  );
}
