# Prompt Studio — Integration Boundary Specification (v1.0)

> **Document Status:** Authoritative Integration Contract  
> **Target Milestone:** Prompt Studio v1 (Post Core Freeze v1)  
> **Reference:** `docs/architecture/DECISIONS.md` D-13 (Core Freeze v1) — dokumen persiapan `qa-playwright-kit-CORE-FREEZE-RC-PROMPT-STUDIO-PREP.md` tidak ada di repo (artefak perencanaan yang tidak di-commit).

---

## 1. Architectural Boundary (PS-PREP-01)

Prompt Studio is the authoring and visual drafting interface for requirements within QA Playwright Kit. It is strictly a **presentation and authoring client** built on top of the frozen framework core.

### 1.1 What Prompt Studio Consumes

- **Human Authoring Format:** Canonical Requirement Markdown (`requirements/*.md`).
- **Core Compiler:** MCP tool `compile_requirement` / `compileRequirementFromText`.
- **Machine Contract:** `RequirementContractV1` (`qa.requirement/v1`).
- **Typed Diagnostics:** `Diagnostic[]` emitted by the compiler (e.g. `REQ_MISSING_MODULE`, `REQ_DUPLICATE_AC_ID`, `REQ_UNKNOWN_AC_REFERENCE`, `REQ_NO_OBSERVABLE_RESULT`).
- **Workspace Resolution:** `mcpWorkspace` paths (`config/qa-kit.workspace.json`).

### 1.2 What Prompt Studio Does NOT Own

- ❌ Requirement parsing rules (owned by `compile-requirement.ts`).
- ❌ Validation and linting logic (owned by `validate-requirement.ts`).
- ❌ AC coverage rules (owned by `validate-plan.ts` and `trace-requirement.ts`).
- ❌ Role/access validation semantics (owned by `qa.requirement/v1` compiler).
- ❌ Test generation / code execution (owned by Planner/Generator/Playwright).

```
┌─────────────────────────────────────────────────────────────┐
│                      Prompt Studio v1                       │
│  (Composer UI, Live Diagnostics, Markdown & Contract View)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                      compiles & validates
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Frozen Framework Core (v1)                  │
│   compile_requirement  │  RequirementContractV1  │  qa:run  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Feature Boundary for v1 (PS-PREP-02)

Prompt Studio v1 implements **only** these 8 core capabilities:

1. **Requirement Composer:** Structured form editor for metadata, access matrix, acceptance criteria, and scenarios.
2. **Live Diagnostics:** Real-time inline validation feedback driven by `compile_requirement`.
3. **Markdown Preview:** Synchronized two-way or rendered Markdown representation.
4. **Contract Preview:** Live JSON inspector for compiled `RequirementContractV1`.
5. **AI Assist:** Guided prompt generator for refining acceptance criteria and scenarios.
6. **Pipeline Preview:** Visual overview of scenario structure, actors, and layer coverage.
7. **Save Requirement:** Atomic write to `requirements/` adhering to canonical template format.
8. **Start QA Pipeline Handoff:** Trigger `qa:run` or clipboard/CLI handoff to start AI agent orchestration.

---

## 3. UI Data Model (PS-PREP-03)

The internal UI state maps 1:1 to `RequirementContractV1`:

```ts
export interface PromptStudioRequirementState {
  requirementId: string;
  title: string;
  module: string;
  feature: string;
  priority: 'high' | 'medium' | 'low';
  risk?: 'high' | 'medium' | 'low';
  tags: string[];
  auth: {
    state: 'authenticated' | 'unauthenticated';
    defaultRole?: string;
  };
  startPage?: string;
  roles: string[];
  accessMatrix: Array<{
    role: string;
    access: 'allow' | 'deny';
    expectation: string;
  }>;
  acceptanceCriteria: Array<{
    id: string; // e.g. "AC-01"
    description: string;
  }>;
  scenarios: Array<{
    id: string; // e.g. "SC-01"
    testId?: string; // e.g. "TC-INV-001"
    title: string;
    type: 'success' | 'failure' | 'access-restriction' | 'manual';
    actor?: string;
    authContext?: string;
    covers: string[];
    affectedLayers?: Array<'FE' | 'BE' | 'DB' | 'API'>;
    steps: string[];
    expectations: string[];
  }>;
}
```

No UI-only requirement semantics or custom schemas are allowed.

---

## 4. Storage & Persistence Path (PS-PREP-04)

- Saved files are written exclusively into the canonical `requirements/` directory.
- Path resolution uses `mcpWorkspace.requirementsDir` (default: `<repoRoot>/requirements`).
- Naming convention: `requirements/<module>/<feature>.md` or `requirements/<feature>.md`.

---

## 5. Validation Loop (PS-PREP-05)

Every edit follows a deterministic single-direction validation loop:

```text
Edit Form / Markdown
        ↓
Render Markdown Text
        ↓
compile_requirement({ requirementsText })
        ↓
Receive McpResult<RequirementContractV1> + Diagnostic[]
        ↓
Render Inline Form Feedback & Diagnostic Badges
```

- If `diagnostics` contains errors, save indicates warning/confirmation.
- Formatting conforms strictly to `requirements/_TEMPLATE.md` and `tools/scripts/format-markdown-tables.ts`.

---

## 6. AI Assist Invariant (PS-PREP-06)

When QA requests AI Assist (e.g., "Suggest negative scenarios" or "Refine AC description"):

```text
User AI Request
        ↓
LLM Suggestion (JSON / Markdown Draft)
        ↓
Apply Draft to PromptStudio State
        ↓
compile_requirement()
        ↓
Validation Check
```

**Rule:** AI suggestions **never** bypass `compile_requirement`. If AI output is malformed, diagnostics capture the violation and highlight it to the user.

---

## 7. Pipeline Handoff (PS-PREP-07)

Prompt Studio does not execute Playwright tests or implement the Planner/Generator engines.

Upon clicking **"Start Pipeline"**:
1. Saves requirement to `requirements/<path>.md`.
2. Generates canonical command:
   ```bash
   npm run qa:run
   ```
3. Provides one-click launch or copy-to-clipboard for the orchestrator agent.

---

## 8. Frozen Non-Goals for v1 (PS-PREP-08)

The following items are **explicitly excluded** from Prompt Studio v1:

- 🚫 Dashboard redesign or custom reporter modification
- 🚫 Run-history analytics or trend charts
- 🚫 Report comparison UI
- 🚫 In-browser test code editor
- 🚫 Direct Playwright browser execution engine
- 🚫 MCP server administration UI
- 🚫 Contract schema definition editor

---

## 9. Ready Gate Verification

- ✅ Core Freeze v1 active
- ✅ `compile_requirement` stable & typed
- ✅ Requirement Template v2 validated
- ✅ Typed diagnostics operational
- ✅ `qa:run` harness operational
