# Editing the Simplified Chinese translation

The app's Simplified Chinese wording is in:

```text
public/locales/zh-CN.json
```

The English source is `public/locales/en.json`. The current Chinese file is a best-effort draft and should be reviewed by a fluent Mandarin speaker who knows the team's robot terminology.

## What to edit

Edit only the Chinese text on the right side of each `:` in `zh-CN.json`.

```json
{
  "signIn": "签入",
  "statusAria": "状态：{{status}}"
}
```

- Keep every key on the left unchanged, such as `"signIn"` and `"statusAria"`.
- Keep placeholders inside double braces unchanged, such as `{{status}}`, `{{count}}`, `{{date}}`, `{{ip}}`, and `{{version}}`. You may move a placeholder to a more natural place in the Chinese sentence.
- Keep product names and technical identifiers unchanged where appropriate: Opentrons, Jira, JSON, API, IP, IPv4, IPv6, `localhost`, `IPs.json`, `startedAt`, and `completedAt`.
- Keep JSON punctuation valid. Every key and value needs double quotes, and entries need commas except for the last entry in an object.
- Do not add comments to a JSON file.

Do not translate robot-provided content: protocol filenames, run IDs, IP addresses, logs, raw robot errors, JSON payloads, or notes written by users.

## Terminology to review carefully

Please use the terms your China team already uses. These draft choices need particular review:

- Fleet / robot fleet: `机器人队列`
- Dashboard: `仪表板`
- Sign in / sign out of a robot: `签入` / `签出` (this is reserving a shared robot, not logging into a website)
- Need attention: `需要处理`
- Awaiting recovery: `等待恢复`
- Unreachable: `无法连接`
- Pipette: `移液器`
- Module: `模块`
- Run: `运行`
- Run archive: `运行归档`
- Troubleshooting zip: `故障排查压缩包`
- Stalled run: `停滞`

Consistency is more important than preserving these draft choices. Replace them wherever your team uses a better term.

## Check the file

From the `Observability_V0` directory:

```bash
npm run locales:check
```

The check verifies that:

- the JSON is valid;
- English and Chinese contain the same keys;
- no translation is blank;
- placeholders such as `{{count}}` are preserved.

Fix every reported error before returning the file.

## Preview the translation

1. Run `npm install` once if dependencies are not installed.
2. Run `npm run dev`.
3. Open the URL printed by Vite.
4. Choose `中文（简体）` from the language selector in the header.
5. Review Setup, Dashboard, a robot card, robot details, run details, notifications, empty states, and error states.
6. Reload the page and confirm that Chinese remains selected.

The app falls back to English if a Chinese entry cannot be loaded. English remains the default for people who have not selected Chinese.

## Return the translation

Send back the complete `zh-CN.json` file, not copied text from a document or chat. Running `npm run locales:check` before sending it prevents accidental missing keys or broken placeholders.

When English UI wording changes later, add or update the English key first, copy the same key into `zh-CN.json`, get the Chinese value reviewed, and run the check again.
