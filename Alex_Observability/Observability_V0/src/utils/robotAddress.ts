/**
 * Validation and parsing for robot host addresses (IPv4, IPv6, localhost)
 * and bulk import from ABR-style JSON or plain comma-separated text.
 */

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const LOCALHOST = 'localhost';

export function isValidRobotAddress(ip: string): boolean {
  const s = ip.trim();
  return (
    s.length > 0 &&
    (IPV4_REGEX.test(s) || IPV6_REGEX.test(s) || s.toLowerCase() === LOCALHOST)
  );
}

/**
 * Opentrons HTTP API on the LAN is plain HTTP (port 31950). Use http for private /
 * loopback / link-local addresses so bulk-import and defaults match real robots.
 */
export function defaultSchemeForRobotAddress(host: string): 'http' | 'https' {
  const s = host.trim();
  const lower = s.toLowerCase();
  if (lower === LOCALHOST || lower === '127.0.0.1' || lower === '::1') return 'http';
  if (IPV4_REGEX.test(s)) {
    const parts = s.split('.').map((x) => parseInt(x, 10));
    const [a, b] = parts;
    if (a === 10) return 'http';
    if (a === 172 && b >= 16 && b <= 31) return 'http';
    if (a === 192 && b === 168) return 'http';
    if (a === 127) return 'http';
    if (a === 169 && b === 254) return 'http';
    return 'https';
  }
  if (IPV6_REGEX.test(s)) {
    const first = lower.split(':').find(Boolean) ?? '';
    if (first === 'fe80' || first.startsWith('fc') || first.startsWith('fd')) return 'http';
    return 'https';
  }
  if (lower.endsWith('.local')) return 'http';
  return 'https';
}

function dedupeValid(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const t = c.trim();
    if (!isValidRobotAddress(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function splitPlainText(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractIpsFromJson(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (typeof v === 'string') {
    return isValidRobotAddress(v) ? [v.trim()] : [];
  }
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object' && 'ip' in item && typeof (item as { ip: unknown }).ip === 'string') {
        out.push((item as { ip: string }).ip);
      }
    }
    return out;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.ip_address_list && typeof o.ip_address_list === 'object' && !Array.isArray(o.ip_address_list)) {
      return Object.keys(o.ip_address_list as Record<string, unknown>);
    }
    if (Array.isArray(o.ips)) {
      return (o.ips as unknown[]).filter((x): x is string => typeof x === 'string');
    }
  }
  return [];
}

function isStructuredRobotJson(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== 'object') return Array.isArray(parsed);
  if (Array.isArray(parsed)) return true;
  const o = parsed as Record<string, unknown>;
  return 'ip_address_list' in o || 'ips' in o;
}

/**
 * Parse robot addresses from:
 * - ABR-style `{ "ip_address_list": { "10.0.0.1": [...], ... } }`
 * - `{ "ips": ["10.0.0.1"] }` or a JSON array of strings / `{ "ip": "..." }` objects
 * - Plain text: commas, semicolons, or whitespace-separated addresses
 */
export function parseRobotIpsFromText(raw: string): { addresses: string[]; mode: 'json' | 'text' } {
  const text = raw.trim();
  if (!text) return { addresses: [], mode: 'text' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { addresses: dedupeValid(splitPlainText(text)), mode: 'text' };
  }

  const extracted = extractIpsFromJson(parsed);

  if (isStructuredRobotJson(parsed)) {
    return { addresses: dedupeValid(extracted), mode: 'json' };
  }

  if (extracted.length > 0) {
    return { addresses: dedupeValid(extracted), mode: 'json' };
  }

  return { addresses: dedupeValid(splitPlainText(text)), mode: 'text' };
}
