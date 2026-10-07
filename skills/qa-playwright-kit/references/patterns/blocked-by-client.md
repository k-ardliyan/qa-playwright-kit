# Resolving `net::ERR_BLOCKED_BY_CLIENT` & Browser Discovery Checklist

Use this reference when the AI agent hits `net::ERR_BLOCKED_BY_CLIENT` or a browser navigation failure during UI exploration.

---

## 1. Facts & Diagnosis (Anti-Hallucination)

Do not assume that:
- The target website is down or unreachable.
- The web page permanently blocks bots / IPs.
- Live UI exploration cannot be done — a failed exploration is unfinished work (Coverage Gap / `@not-implemented`), never `test.skip` and never a reason to downgrade the scenario to `@manual`.

### Real Cause

The `net::ERR_BLOCKED_BY_CLIENT` error on the `@playwright/mcp` tool (`browser_navigate`) is **NOT** caused by the target web server's firewall or any block from the destination site. It is raised locally by Chromium because of the `--allowed-origins` security flag:
- The `--allowed-origins=<url>` flag is initialized by the MCP wrapper at launch.
- If the target URL redirects, loads resources from another domain, or its origin differs even slightly from the registered list, local Chromium rejects the request with status `net::ERR_BLOCKED_BY_CLIENT`.
- The Windows dialog `"Get an app to open this 'chrome' link"` appears when an external tool tries to open a `chrome://` scheme URI on a Windows system with no default handler for that protocol.

---

## 2. Solutions & Priority Path (Resolution Ladder)

When you hit `ERR_BLOCKED_BY_CLIENT` or a `browser_navigate` failure:

### Path 1 (primary & proven): `qa-playwright-kit:snapshot_page`

Use the kit's internal MCP tool first:

```json
{
  "featureName": "auth",
  "pageName": "login",
  "url": "<BASE_URL>/login",
  "force": true
}
```

*(Replace the target URL with your active app `BASE_URL`.)*

**Advantages:**
- This tool uses an internal Playwright instance without the rigid origin restriction of `@playwright/mcp`.
- It extracts the semantic catalog and ARIA snapshot directly into `artifacts/selector-catalog/<feature>/<page>.json`.
- It always extracts semantic locators (`getByRole`, `getByLabel`, etc.) without being disturbed by the client-blocker error.

### Path 2: CLI Smoke Test / Direct Verification

When you need a quick navigation check without the browser MCP:

```bash
npx tsx -e "
import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const res = await page.goto(process.env.BASE_URL || 'https://staging.example.com/login', { waitUntil: 'domcontentloaded' });
  console.log('STATUS:', res?.status(), 'TITLE:', await page.title());
  await browser.close();
})();"
```

### Path 3: Adjusting `allowed-origins` on `@playwright/mcp` (maintainer required)

To use the live interactive `@playwright/mcp`:
1. Make sure `BASE_URL` in the environment is configured correctly (your active staging/dev URL).
2. Do not use custom protocols such as `chrome://` on Windows; use a standard browser instance.
3. Separate sub-domains or API origins must be added to `extraOrigins` in `src/shared/mcp/origin-resolver.ts` — that is a **maintainer zone**: report it via the template in [qa-vs-maintainer.md](../qa-vs-maintainer.md), do not edit it yourself. `src/**` = no writes for QA.

---

## 3. Checklist Before Concluding "The Browser Cannot Be Opened"

1. [ ] Run `curl -I -L <URL>` in the terminal. If it returns `200 OK`, the server is alive.
2. [ ] Call `snapshot_page` from the `qa-playwright-kit` server.
3. [ ] Check the contents of `artifacts/selector-catalog/<feature>/<page>.json` to see the DOM extraction result.
4. [ ] Do not convert a scenario to `@manual` merely because of an `ERR_BLOCKED_BY_CLIENT` issue on the MCP client.
