# AGY-CLI SPRINT INSTRUCTIONS — P0 Remediation

**Repo:** `vitrixLab/social-media-smm-automation`  
**Branch:** `dev`  
**Scope:** Work ONLY through the tasks in this file. Do not add features. Do not refactor beyond what's listed.  
**Reference docs:**
- `docs/architecture/audit-2026-10-06.md` — the full audit
- `docs/architecture/sprint-2026-10-06.md` — the 3-day remediation plan
- This file — the execution order

**Time-box:** 3 working days. Stop and report after Day 1 tasks complete.

---

## 🚨 SAFETY RULES — NON-NEGOTIABLE

These rules protect the repo from the classes of accident that have previously destroyed work on this account.

1. **NEVER run `git clean -fdx` or `git clean -fd`** on any folder. These wipe untracked files including source code.
2. **NEVER run `git reset --hard`** without first creating a tag (`git tag safe-point-<date>`) and confirming the tag exists with `git tag -l`.
3. **NEVER run `git checkout .` or `git restore .`** on a folder with uncommitted work.
4. **NEVER commit `.env`, `.env.local`, or any file containing API keys, tokens, or database URLs.** Check `git status` before every commit.
5. **NEVER delete `.git/`** on any folder without explicit written confirmation from the user.
6. **NEVER push to `main`** — work only on `dev` or feature branches.
7. **Before any destructive command** — stop, print the exact command, wait for confirmation.
8. **After every task:** run `git status`, verify the working tree matches expectations, then commit.

If a command fails in a way that could affect other work (deletes files, rewrites history, force pushes) — **STOP and ask the user.**

---

## 📖 Context — Read These First

Before making any change, read in order:

1. `docs/architecture/audit-2026-10-06.md` — the diagnosis (what's broken and why)
2. `docs/architecture/sprint-2026-10-06.md` — the remediation sequence
3. `nextjs-setup/nextjs-dashboard/package.json` — see the actual dependencies
4. `nextjs-setup/nextjs-dashboard/prisma/schema.prisma` — see the actual data model
5. `nextjs-setup/nextjs-dashboard/src/lib/prisma.ts` — see the fake stub
6. `.github/workflows/ci.yml` — see the current CI scope

Report back with:
- One-paragraph confirmation of your understanding
- The exact commit SHA you're starting from (`git log -1 --format=%H`)
- Any blockers that prevent you from starting

**Wait for approval before Task 1.**

---

## 🎯 DAY 1 — Make It Build, Make It Real

### Task 1.1 — Pin Prisma CLI to Stable

**Problem:** `devDependencies` includes `prisma@8.0.0-rc.17` (a pre-release with no `generate` command). `@prisma/client` and `@prisma/adapter-neon` are correctly at `7.10.0`.

**Action:**
```bash
cd nextjs-setup/nextjs-dashboard
pnpm remove prisma
pnpm add -D prisma@7.10.0