# Web Studio Implementation, SSE Streaming, and Annotation-Driven Linking

We implement Web Studio streaming using native Server-Sent Events (SSE), author requirements via a structured visual form builder with live Markdown preview, enable Express Mode via Playwright test annotations, and package portable reports with inline Base64 PNG or JPEG screenshots.

## Context

Following ADR 0001, we needed technical specifications for:
1. Streaming test execution to the browser for non-coding QA without adding heavyweight WebSocket dependencies.
2. Preventing syntax corruption in requirement files authored by non-coders.
3. Enabling SDETs to bind native Playwright specs into traceability metrics without creating Markdown test plans.
4. Keeping portable HTML reports lightweight while retaining visual proof.

## Decision

1. **SSE Streaming for Live Runs**:
   - `dashboard-server` spawns Playwright / workflow child processes and pipes stdout/stderr directly into the existing Node.js native SSE stream (`/events`, event names `run-log` and `run-done`), avoiding extra packages like `ws`.
2. **Visual Form Builder with Live Markdown Preview**:
   - Web Studio renders structured inputs (Metadata, Roles, Scenarios, Steps, Expected Results) and dynamically renders the compliant Markdown output. Submissions pass through `validate_requirement` before writing to `requirements/<feature>.md`.
3. **Annotation-Driven Linking for Express Track**:
   - SDET specs register requirement linkages directly in test code via standard Playwright annotations (`annotation: { type: 'requirement', description: 'REQ-ID' }`). The report parser reads these annotations and binds results directly into traceability without requiring an intermediate `specs/*-test-plan.md`.
4. **Inline screenshot bundling**:
   - The portable HTML generator embeds failure screenshots and acceptance verification images as PNG and JPEG data URIs within the single HTML file. Files over 400KB are omitted. Deep Playwright traces (`trace.zip`) remain referenced as external links for SDET inspection.

## Consequences

- Zero new runtime networking dependencies are introduced.
- Non-coders are shielded from Markdown formatting syntax errors.
- SDETs can write idiomatic Playwright tests that seamlessly integrate into executive reporting.
- Reports can be distributed as single attachments without broken local image links.
