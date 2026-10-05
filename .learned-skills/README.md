# Learned Skills (QA-owned)

Self-learned agent skills live **here**, never inside [`../skills/`](../skills/).

A dot-dir on purpose — it matches the repo's other agent-local state
(`.hermes/`, `.agents/`, `.claude/`) and adds nothing to the visible root listing.

## Why not `skills/`

`skills/` is a `FRAMEWORK_PATHS` entry in `tools/scripts/framework-upgrade.ts`, so
`npm run upgrade` **overwrites everything inside it** — a self-learned skill kept
there is silently replaced by the stock framework pack on the next upgrade, and
the lesson is lost. Files in this directory are not in the framework zone and are
never a target of an upgrade.

## Naming rule (enforced by `npm run setup`)

Every skill directory here **must end with `-learned`**, and must not reuse a
framework skill name:

```
.learned-skills/
  qa-playwright-kit-learned/   ← OK
  <feature>-learned/           ← OK
  qa-playwright-kit/           ← REFUSED (collides with the framework pack)
  my-notes/                    ← REFUSED (missing -learned suffix)
```

`npm run setup` mirrors `.learned-skills/*-learned/` into the same agent targets as
the framework pack (`.agents/skills/`, `.claude/skills/` when Claude is installed,
and the active Hermes profile skills dir). A refused name is reported as a skill
warning and skipped; the framework copy always wins.

## How to add one

1. Create the skill directory here with the `-learned` suffix (any editor, or the
   agent's own skill tooling pointed at this path).
2. Run `npm run setup` — it mirrors the skill into the agent dirs.
3. `npm run upgrade` later refreshes the framework pack underneath it and leaves
   this directory untouched.

Contents of this directory are gitignored (`.learned-skills/*`), so each QA machine
keeps its own lessons without committing them upstream.
