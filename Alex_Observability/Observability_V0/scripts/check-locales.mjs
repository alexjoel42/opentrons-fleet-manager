import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localeDir = path.join(projectRoot, 'public', 'locales');

async function readCatalog(name) {
  const file = path.join(localeDir, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return null;
  }
}

function flatten(value, prefix = '', out = new Map()) {
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${prefix || '<root>'} must be an object or string`);
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function interpolationTokens(value) {
  return [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort();
}

const english = await readCatalog('en');
const chinese = await readCatalog('zh-CN');

if (english && chinese) {
  try {
    const en = flatten(english);
    const zh = flatten(chinese);
    const errors = [];

    for (const key of en.keys()) {
      if (!zh.has(key)) errors.push(`zh-CN.json is missing key: ${key}`);
    }
    for (const key of zh.keys()) {
      if (!en.has(key)) errors.push(`zh-CN.json has extra key: ${key}`);
    }

    for (const [key, enValue] of en) {
      const zhValue = zh.get(key);
      if (enValue.trim() === '') errors.push(`en.json has a blank value: ${key}`);
      if (zhValue != null && zhValue.trim() === '') errors.push(`zh-CN.json has a blank value: ${key}`);
      if (zhValue != null) {
        const enTokens = interpolationTokens(enValue);
        const zhTokens = interpolationTokens(zhValue);
        if (enTokens.join('|') !== zhTokens.join('|')) {
          errors.push(
            `Interpolation tokens differ at ${key}: en=[${enTokens.join(', ')}], zh-CN=[${zhTokens.join(', ')}]`,
          );
        }
      }
    }

    if (errors.length > 0) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else {
      console.log(`Locale catalogs are valid (${en.size} keys).`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
