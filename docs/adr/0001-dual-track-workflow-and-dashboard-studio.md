# Dual-Track Workflow, Dashboard Web Studio, and Hybrid Portable Reporting

To accommodate both non-coding QA and code-centric SDETs without compromising traceability or velocity, we adopt a bimodal execution architecture: a visual Web Studio on top of the dashboard for non-coders, and an Express mode for SDETs alongside the existing Strict AI pipeline. Reporting is unified into a single portable self-contained HTML artifact supporting dual executive and engineering perspectives.

## Context

The framework previously enforced a single strict path: natural-language Markdown requirement (`requirements/`) → Markdown test plan (`specs/`) → generated Playwright spec (`tests/`) → validation gates. While robust for AI-driven automation, this created high friction for manual/non-coding QA who struggle with CLI terminals, and slowed down SDETs needing to author native Playwright specs rapidly. Furthermore, local reports required a running Node.js server, complicating artifact sharing with non-technical stakeholders.

## Decision

1. **Dual-Track Execution**:
   - **Strict Mode (AI-Governed)**: Preserves the end-to-end AST validation and traceability gates (`requirements/` → `specs/` → `tests/`).
   - **Express Mode (SDET Code-First)**: Allows direct creation of `tests/<feature>.spec.ts` using native Playwright APIs with lightweight requirement annotations (`test('...', { annotation: { type: 'requirement', description: 'REQ-01' } })`) so results seamlessly feed the traceability matrix without mandatory test plan markdown files.
2. **Dashboard Web Studio**:
   - Extend `src/cli/dashboard-server.ts` with browser-based requirement authoring, scenario management, and a one-click test execution trigger with live log streaming (SSE/WebSocket), removing terminal dependency for manual QA.
3. **Hybrid Portable Reporting**:
   - Generate a single self-contained HTML report bundling all screenshots, traces, and metadata. Provide an Executive View (acceptance criteria pass rate, AI insights in plain language) and an Engineering View (step timelines, network payloads, console logs).

## Considered Options

- **Option 1: Strict Single-Track Only (Rejected)**: Kept non-coders intimidated by CLI/git and frustrated SDETs due to rigid intermediate plan generation.
- **Option 2: Standalone Desktop GUI App (Electron/Tauri) (Rejected)**: Added massive maintenance overhead and cross-platform installation friction compared to extending the existing web dashboard.

## Consequences

- Non-coding QA can author and execute tests independently via browser UI without touching the terminal.
- SDETs regain full Playwright native capability and fast turnaround loops while maintaining test traceability.
- The dashboard server must now host execution endpoints and process management safely on localhost.
