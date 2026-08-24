# QA Playwright Kit Versioned Machine Contracts

This directory documents the versioned, canonical contracts used by the QA Playwright Kit harness and AI agent orchestration.

## Active Contract Versions

| Contract              | Schema Version           | Purpose                                                                          |
| --------------------- | ------------------------ | -------------------------------------------------------------------------------- |
| Requirement Contract  | `qa.requirement/v1`      | Compiled, structured requirement state derived from Markdown authoring           |
| Test Plan Contract    | `qa.test-plan/v1`        | Verified plan produced by Planner with assertion provenance and coverage mapping |
| Traceability Contract | `qa.traceability/v1`     | End-to-end trace graph from Requirement/AC down to test runs and evidence        |
| MCP Result Envelope   | `qa.mcp-result/v1`       | Deterministic MCP tool return format with typed diagnostics and provenance       |
| Selector Catalog      | `qa.selector-catalog/v1` | Persistent accessibility snapshots and semantic locator indexes                  |

## Related Documentation

- [`DIAGNOSTICS.md`](DIAGNOSTICS.md) — Comprehensive catalog of diagnostic error, warning, and info codes.
- [`src/contracts/requirement-contract.ts`](../../src/contracts/requirement-contract.ts) — Source of truth untuk field `RequirementContractV1` (file `REQUIREMENT-CONTRACT.md` terpisah belum dibuat).
- [`TEST-PLAN-CONTRACT.md`](TEST-PLAN-CONTRACT.md) — Detailed fields of `TestPlanContractV1`.
- [`TRACEABILITY-CONTRACT.md`](TRACEABILITY-CONTRACT.md) — Detailed structure of `TraceabilityContractV1`.
- [`TRACEABILITY-MODEL.md`](TRACEABILITY-MODEL.md) — Konsep closed-loop traceability + coverage 4-dimensi (merge `docs/TRACEABILITY.md` + `COVERAGE-MODEL.md`).
