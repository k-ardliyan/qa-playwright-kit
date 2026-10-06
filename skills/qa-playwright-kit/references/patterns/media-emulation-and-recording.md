# Media emulation, token-efficient search & flow recording (Playwright MCP 0.0.82+)

`@playwright/mcp` tools used during **Explore** — not inside a spec.

## 0. `browser_find` — find elements without a full snapshot (0.0.83+)

Returns **only matching snapshot nodes** plus a few lines of surrounding context (like a search snippet), each under its path from the tree root — far cheaper in tokens than `browser_snapshot` when you only need to locate an element and its `ref`.

- `text` — case-insensitive substring, OR `regex` (pick one, never both).
- `filename` (0.0.83+) — write the result to a file instead of returning it in the response. Relative paths resolve against the workspace root. Use it when the result set is large.

Token-efficient flow: `browser_find({ text: 'Save' })` → take the `ref` from the result → `browser_click`. Only escalate to `browser_snapshot` when `browser_find` finds nothing.

> **0.0.83 note:** snapshots now quote accessible names that look like regex, e.g. `"/home/"`. Spec assertions using that string verbatim can miss — use `getByRole('link', { name: '/home/' })` (Playwright handles escaping), not the raw snapshot string.

## 1. `browser_emulate_media` — verify theme / print without relaunching

Flip media features in a running session; omitted parameters stay as-is, `null` clears the override.

| Parameter       | Values              | When to use                                           |
| --------------- | ------------------- | ----------------------------------------------------- |
| `colorScheme`   | `light` \| `dark`   | "Dark mode" requirement, text contrast, status badges |
| `reducedMotion` | `reduce`            | Accessibility / animation requirement                 |
| `forcedColors`  | `active`            | Windows high-contrast mode                            |
| `contrast`      | `more` \| `less`    | Extra contrast                                        |
| `media`         | `screen` \| `print` | Print layout (invoice, label, berita acara)           |

Flow: navigate → `browser_emulate_media({ colorScheme: 'dark' })` → `browser_snapshot` / `browser_take_screenshot` → assert visually → `browser_emulate_media({ colorScheme: null })` to revert.

**Its limit:** the tool changes CSS preferences (`prefers-color-scheme`). If the app stores the theme in `localStorage` / cookies / user profile, the CSS override alone does **not** change the theme — set the app state first, then emulate.

**What must NOT be done:** never use `browser_emulate_media` as a replacement for assertions inside a spec. Specs keep using the Playwright API `page.emulateMedia({ colorScheme: 'dark' })` — the MCP tool is only for exploration and live proof.

## 2. `browser_start_recording` / `browser_stop_recording` — draft a spec from a walkthrough

QA demonstrates the manual flow; the server returns the actions as Playwright code.

1. `browser_start_recording`
2. QA runs the flow in the browser (or the agent executes its steps)
3. `browser_stop_recording` → get the code snippet

The result is **raw material**, not a ready spec: no `test.step()`, `setTestMetadata()`, `captureActualResult()`, and the locators may be raw CSS. It must be processed through [generator-step-titles.md](../generator-step-titles.md) before it lands in `tests/`.

## 3. Tools that do NOT exist over MCP (never call them)

`browser_reload`, `browser_check`, `browser_uncheck`, `browser_keydown`, `browser_keyup`, `browser_press_sequentially`, `browser_navigate_forward`, `browser_console_clear`, `browser_network_clear`, `browser_webmcp_list` exist in the server bundle but are **`skillOnly`** — never exposed over MCP. Calling them returns `unknown tool`. Use `browser_navigate` to reload, `browser_press_key` for Enter, and `browser_tabs` for cross-tab navigation.

> Verified: `tools/list` probe per `--caps` set against `@playwright/mcp` 0.0.83 (72 tools exposed with the full capability set — same as 0.0.82). The exposed count varies with the `--caps` set the launcher passes per intent profile — other probes (e.g. `hermes mcp test playwright`) report 48, which is expected, not a failure.
