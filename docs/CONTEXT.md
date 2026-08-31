# QA Playwright Kit — Domain Glossary

> This file is a glossary of domain terms used in the project. It is NOT a spec or implementation guide.

## Roles

- **QA User** — A manual/UI/E2E tester who is _non-programmer but tech-comfortable_. They use VS Code, run terminal commands, write markdown requirements, and interact with AI agents (e.g. Codex), but they do **not** write TypeScript or build automation frameworks. They are distinct from _Framework Maintainers_ who maintain the MCP server, CI, and parsers.
- **Framework Maintainer** — The team member(s) who maintain the framework core: MCP server, CI workflows, parsers, base fixture seam, and env-loader module. They are the escalation point when the framework itself fails, but they are **not** in the critical path for daily test creation (see _Selector Discovery_).

## Toolchain

- **Primary Stack** — VS Code + Codex extension, Cursor, or Kiro. All documentation, configuration, and setup guides support multi-platform AI clients. MCP configuration can be auto-generated for each platform via `npm run mcp:config`.
- **MCP Servers** — Three servers (`playwright`, `playwright-test`, `qa-playwright-kit`) configured via root `.mcp.json` as project source-of-truth. Platform-specific configs (Claude, Cursor, Kiro) are auto-generated. `.vscode/mcp.json` is optional editor-compatibility config.

## Pipeline

- **Orchestration Model** — Supports both prompt-driven (`manual` mode — QA User invokes pipeline steps via prompts) and fully automated (`automatic` mode — AI agent executes all phases sequentially without pausing). Automatic mode includes pipeline state persistence and resume capability via `artifacts/reports/pipeline-state.json`. Multi-platform AI client support through the Universal Agent Integration Layer (`src/agents/integration/`).
- **Pipeline Phases** — Pre-flight → Validate → Plan → Generate → Execute → Heal → Report. Each phase maps to an _Agent Role_.
- **Agent Role** — One of five logical roles: _Orchestrator_, _Planner_, _Generator_, _Healer_, _Reporter_. These instruction sets are structured for multi-AI-client compatibility, with the root `AGENTS.md` defining the Orchestrator guidelines and instructing agents on how to read and delegate tasks to the specific sub-agent instructions located in `.github/agents/`.
- **Selector Discovery** — AI-first. The _Generator_ auto-discovers selectors for unknown pages via `browser_snapshot` without waiting for a _Framework Maintainer_ to pre-build a _Page Object_. Pre-built _Page Objects_ are optional optimizations, not prerequisites for test generation.

## Test Architecture

- **Page Object (POM)** — A TypeScript class wrapping selectors and actions for a specific page. Registered under `tests/pages/` or `tests/fixtures.ts`. Useful for selector reuse and stability, but **not required** for the _Generator_ to produce tests.
- **Requirement** — A markdown document in `requirements/` following `_TEMPLATE.md`. Written by the _QA User_ in natural language with structured scenarios. This is the _only_ input the QA User needs to provide.
- **Test Plan** — A markdown document in `specs/` produced by the _Planner_ from a _Requirement_. Not edited by the QA User.

## Scope

- **Scope (Path A — Template core)** — Write requirement → AI pipeline → generated specs in `tests/`. Recommended starting point.
- **Generator verification** — How the Generator confirms selectors before writing code: CLI attach (preferred) or MCP browser tools (fallback).
- **Framework Scope** — Generic, multi-project. The QA Playwright Kit is a reusable toolkit that works across different web applications. Application-specific code (auth flows, POMs, env configs) lives in each project's instance (fork).
- **Reference Adapter** — Not bundled. Forks can define their own adapter via `PLAYWRIGHT_ADAPTER_*` envs.
- **Deployment Model** — Template Fork. This repository acts as a core template. Each QA project forks or duplicates this repository into its own separate Git repository to maintain absolute isolation of tests, credentials, and custom page objects. Upstream updates (core logic, prompts, MCP config) are pulled and merged manually from the core template repository registered as a Git `upstream` remote.

## Configuration & Security

- **Credential Management** — Local-only. Target environment credentials (passwords, API keys, etc.) live in gitignored environment files (`config/environments/*.env`). QA Users manually retrieve these secrets from the team's secure vault (e.g. 1Password, Bitwarden) and populate their local env files. No real credentials are ever committed to version control.
- **Test Data Isolation** — Shared-environment safety. To prevent concurrent test runs from colliding, each QA member uses isolated credentials/accounts on shared environments. Test generation instructions enforce using dynamic, unique resource names (e.g. incorporating timestamps or random prefixes) to prevent duplicate record conflicts.

## Execution & Reporting

- **Test Execution** — Local and CI. QA Users execute and debug tests locally in VS Code using Codex and Playwright tools. Official test runs execute in CI (GitHub Actions) to ensure a clean, reproducible state.
- **Report Visibility** — CI-driven. Local test reports (`artifacts/reports/custom-dashboard.html`) are for immediate feedback during development. The single source of truth for stakeholders is the CI pipeline, which publishes reports (e.g., to GitHub Pages) or uploads them as workflow artifacts.
