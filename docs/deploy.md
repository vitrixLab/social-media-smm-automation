# Vercel deployment root and package-manager runbook

## Incident record

- Failed deployment commit: `d3ed54b59162c12a71cdf4b885c98fae6060ec14`
- Vercel failure: `[NEXT_NO_VERSION]` during project detection, before `next build`.
- The root `package.json` delegates build to `nextjs-setup/nextjs-dashboard` but does not declare `next`.
- The dashboard package manifest declares `next: 16.3.6`, `react: 19.2.8`, and `react-dom: 19.2.8`; the React versions are compatible with the expected React 19 generation.
- The repository has a root `pnpm-lock.yaml` and root `pnpm-workspace.yaml` declaring `nextjs-setup/*`. The dashboard directory also contains a `package-lock.json` and a second `pnpm-workspace.yaml`. This is package-manager/workspace ambiguity that must be resolved deliberately, not inferred from the initial failure.

## Vercel project settings

Apply these settings to the existing Vercel project; this is an operations/configuration change, not a queue-code change:

1. Set **Root Directory** to `nextjs-setup/nextjs-dashboard`.
2. Enable **Include source files outside of the Root Directory in the Build Step** so the dashboard build can access files that remain at the repository root. Verify the exact label in the current Vercel UI.
3. Keep the framework preset set to **Next.js**; do not force `framework: null`.
4. Configure the install command to use the canonical root pnpm workspace if Vercel's project-root behavior does not reliably select it. Validate the working directory semantics before saving; the intended install is a frozen-lockfile install from the repository root (`pnpm install --frozen-lockfile`), not an npm install inside the nested dashboard.
5. Redeploy the same feature-branch commit first, so the settings change is isolated from code changes.

Do not add `next` to the repository-root manifest solely to suppress `NEXT_NO_VERSION`: the actual Next.js application owns that dependency in the dashboard manifest.

## Package-manager hygiene gate

The checked-in root pnpm workspace and lockfile are the current evidence for pnpm being canonical. The nested dashboard `package-lock.json` and nested `pnpm-workspace.yaml` are conflicting signals.

Before the next production/preview build, inspect whether either nested file is intentionally used by a documented standalone-dashboard workflow. If not, remove those stale artifacts in a separate, reviewed baseline/configuration change and regenerate/verify the root pnpm lockfile only if dependency manifests changed. Do not hand-edit lockfiles or regenerate them as part of PR 1's queue implementation. Keep a single authoritative package manager for CI and Vercel.

## Redeploy verification and decision tree

Capture the full Vercel build output and record the deployment URL, commit SHA, effective Root Directory, install command, and package manager.

- **Still `NEXT_NO_VERSION`:** confirm saved Root Directory, Next.js preset, and that the deployment uses the intended commit.
- **Lockfile/workspace or unresolved-package error:** inspect the effective install working directory and remove the conflicting nested package-manager files only after the hygiene gate above.
- **Peer dependency error:** re-check dashboard `next`, `react`, and `react-dom` declarations and the resolved lockfile versions.
- **Failure after `next build` begins:** classify the first real compiler/import/runtime error by file and compare the failing file with the PR diff before assigning it to PR 1 or baseline.
- **Build succeeds:** record the successful deployment and its commit SHA. This does not substitute for PR 1's real Redis integration suite, type-check, lint, or other required gates.

## Scope and safety

This runbook documents a Vercel project-settings/baseline issue. It does not modify `dev`, unlock live publishing, change `DRY_RUN`, or start PR 2. Keep deployment configuration repairs separate from the durable queue implementation unless evidence shows the queue PR changed the relevant configuration.
