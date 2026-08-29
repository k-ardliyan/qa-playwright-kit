# Lessons Learned — Agent Failure Log

> **Format:** `DATE | FILE | ERROR | ROOT CAUSE | FIX APPLIED`
> **Aturan:** Append segera setelah agent generate code yang salah. Setelah append, update TL;DR di sub-agent file yang relevan.
> **Tujuan:** Mencegah repeat mistake di sesi berikutnya.

<!-- APPEND BELOW — jangan edit baris yang sudah ada -->

## 2026-07-28 | requirements/auth/sample-login-empty-fields.md | Missing Layer annotation for SC-04 | Advisory validation rule | Add `- **Layer terdampak:** FE` to all scenarios

## 2026-07-28 | `tests/sample-login-empty-fields.spec.ts` | Playwright "No tests found" | File discovery timing after creation / wrong working directory | Ensure file exists before run; run from repo root

## 2026-08-26 | src/contracts vs tools/mcp/src/contracts | semantic drift CoverageStateBreakdown | MCP copy edited independently | SoT src/ + sync:mcp-generated --check

## 2026-08-26 | @kitajs/html dashboard TSX | assumed `{false}` serializes as text `"false"` | README table is stale; v4.2.13 `contentsToString` skips booleans and serializes numbers | `{cond && <el/>}` OK when cond is boolean; `{count && <el/>}` leaks `0`; lock with `src/__tests__/unit/kitajs-jsx-contract.test.ts`. Do not mass-replace `&&`. onclick must not interpolate ids into JS strings — KitaJS attrs only escape `"`.
