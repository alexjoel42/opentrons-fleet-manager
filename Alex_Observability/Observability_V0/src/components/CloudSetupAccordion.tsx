import { useId, useState } from 'react';

type Props = {
  title: string;
  /** Start expanded (`true` by default). Pass `false` to begin collapsed. */
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function CloudSetupAccordion({ title, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const panelId = useId();

  return (
    <div className="mb-6 rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        id={headingId}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-6 py-4 text-left font-display text-lg font-normal tracking-tight text-foreground transition-colors hover:bg-muted/40"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <svg
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headingId}
          className="border-t border-border px-6 pb-6 pt-4"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
