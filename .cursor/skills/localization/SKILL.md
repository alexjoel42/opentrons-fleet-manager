---
name: localization
description: Maintains English and Simplified Chinese UI translations for the Opentrons fleet manager. Use when adding or changing user-visible copy, locale files, language controls, date formatting, status labels, placeholders, accessibility text, or translation documentation.
---

# Fleet manager localization

## Scope

The localized app is `Alex_Observability/Observability_V0`.

- English source: `public/locales/en.json`
- Simplified Chinese draft: `public/locales/zh-CN.json`
- Runtime setup: `src/i18n.ts`
- Translator guide: [docs/localization/README.md](../../../Alex_Observability/Observability_V0/docs/localization/README.md)

English is the fallback. Chinese copy is a draft until a fluent Mandarin speaker familiar with the robots reviews it.

## Updating UI copy

1. Replace app-owned visible text with `t('section.key')`; include labels, buttons, placeholders, titles, aria text, empty states, local errors, and notifications.
2. Add the same key to both locale files. Write clear canonical English and a best-effort Simplified Chinese value.
3. Use interpolation for dynamic values, for example `t('card.notesAria', { ip })` with `{{ip}}` in both catalogs.
4. Use i18next plural keys for counts (`key_one`, `key_other`) and call the base key with `count`.
5. Preserve every interpolation token exactly in both languages. Chinese may reorder tokens.
6. Use stable translation keys for status/config metadata; never use translated display text as a programmatic status value.

Do not translate robot-provided protocol filenames, raw errors, logs, IDs, IP addresses, raw JSON, or user-authored notes. Keep product names and code identifiers such as Opentrons, Jira, API, JSON, `startedAt`, and `completedAt` where appropriate.

## Dates and typography

Format human-facing dates with the active i18next language, not the browser default. Preserve raw timestamps when the screen intentionally shows raw API data.

Keep Chinese font fallbacks in `src/index.css`: Noto Sans SC, PingFang SC, and Microsoft YaHei.

## Validation

From `Alex_Observability/Observability_V0`, run:

```bash
npm run locales:check
npm run typecheck
npm run lint
npm run build
```

Then switch between English and `中文（简体）` in the app. Check persistence after reload, interpolation and counts, status labels, accessibility text, and English fallback behavior.

If Chinese wording changes materially, remind the user that it needs fluent human review and update the translator guide's terminology list when the preferred domain term changes.
