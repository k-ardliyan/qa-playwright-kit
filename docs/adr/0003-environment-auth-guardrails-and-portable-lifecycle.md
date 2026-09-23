# Visual Environment Management, Balanced Guardrails, and Report Lifecycle

We integrate visual environment/auth control with interactive headed recovery into Web Studio, enforce a balanced safety boundary on Express specs, and decouple portable report generation between local on-demand export and automated CI publishing.

## Context

Operational boundaries were needed to finalize the dual-track architecture:
1. Non-coding QA required a way to switch target environments and resolve expired sessions or OTP/CAPTCHA challenges without terminal commands.
2. SDETs needed clarity on which rules still apply to hand-written Playwright specs without crippling custom POM design.
3. Heavy inline PNG or JPEG bundling had to be scheduled appropriately so local feedback loops remain near-instantaneous.

## Decision

1. **Visual Env & Headed Auth Fallback**:
   - Web Studio UI exposes environment switching (`APP_ENV`) and live auth status chips per role. Clicking "Refresh Auth" executes headless login; ticking the "Buka browser" checkbox runs it headed (`npm run auth:setup:headed`) so non-coders can complete an OTP/CAPTCHA challenge interactively. There is no automatic fallback: the challenge must be anticipated before starting the refresh.
2. **Balanced Guardrails for Express Specs**:
   - Static validation on manual/SDET specs (`validate_generated_tests`, rules in `tools/mcp/src/tools/rules/auth-rules.ts`) checks for:
     - No ephemeral locator leakage (`tw-XXXX` or transient ref IDs).
     - No inline login: specs must not fill login forms or navigate to the login page to obtain a session; sessions come from the setup project via `test.use({ storageState: authStatePath('<role>') })`.
   - Requirement/plan catalog linkage remains optional via Playwright test annotations (`@req`), allowing freeform Page Object Model (POM) development.
3. **Decoupled Report Lifecycle**:
   - Local runs produce the lightweight native dashboard immediately. An "Export Portable HTML" action compiles the standalone inline PNG or JPEG single-file report on demand.
   - CI workflows automatically generate and archive the standalone portable HTML as a persistent build artifact.

## Consequences

- Non-technical QA can independently operate in multi-environment, challenge-protected staging setups.
- SDETs retain idiomatic Playwright coding freedom while codebase-wide auth conventions and selector stability are protected.
- Local test execution speed is preserved without redundant image compression overhead.
