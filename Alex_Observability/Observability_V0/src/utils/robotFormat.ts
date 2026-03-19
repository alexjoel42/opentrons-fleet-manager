/**
 * Shared formatters for robot data: pipettes and modules with name · serial.
 */

/** Display value or "—" when null/undefined/empty. */
export function orDash(value: unknown): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s === '' || s.toLowerCase() === 'null' ? '—' : s;
}

function pipetteLabel(p: Record<string, unknown>, prefix: string): string {
  const name = p.model ?? p.name ?? '—';
  const serial = p.serial_number ?? p.serialNumber ?? p.id;
  return serial ? `${prefix}: ${name} · ${serial}` : `${prefix}: ${name}`;
}

export function formatPipettes(pipettes: unknown): string[] {
  if (pipettes == null) return [];
  const lines: string[] = [];
  const o = pipettes as Record<string, unknown>;
  if (o.left && typeof o.left === 'object') {
    lines.push(pipetteLabel(o.left as Record<string, unknown>, 'Left'));
  }
  if (o.right && typeof o.right === 'object') {
    lines.push(pipetteLabel(o.right as Record<string, unknown>, 'Right'));
  }
  const data = o.data as Record<string, unknown> | undefined;
  if (data?.left && typeof data.left === 'object') {
    lines.push(pipetteLabel(data.left as Record<string, unknown>, 'Left'));
  }
  if (data?.right && typeof data.right === 'object') {
    lines.push(pipetteLabel(data.right as Record<string, unknown>, 'Right'));
  }
  if (Array.isArray(pipettes)) {
    (pipettes as Array<Record<string, unknown>>).forEach((p, i) => {
      const mount = p.mount ?? p.id ?? `#${i + 1}`;
      lines.push(pipetteLabel(p, String(mount)));
    });
  }
  if (lines.length === 0 && typeof o === 'object') {
    const name = o.model ?? o.name;
    const serial = o.serial_number ?? o.serialNumber;
    if (name) lines.push(serial ? `${name} · ${serial}` : String(name));
  }
  return lines;
}

/** Humanize Opentrons moduleType (e.g. heaterShakerModuleType → Heater-Shaker). */
function humanizeModuleType(type: string): string {
  const s = String(type);
  if (s.endsWith('ModuleType')) {
    const base = s.slice(0, -10);
    return base.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim().replace(/\s+/g, '-');
  }
  return s;
}

export function formatModules(modules: Array<Record<string, unknown>>): string[] {
  return modules.map((m) => {
    const rawType = m.moduleType ?? m.name ?? 'module';
    const type = typeof rawType === 'string' ? humanizeModuleType(rawType) : String(rawType);
    const serial = m.serialNumber ?? m.serial_number ?? m.name;
    return serial ? `${type} · ${serial}` : type;
  });
}
