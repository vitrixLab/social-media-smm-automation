# Vercel deployment root and package-manager runbook

## Incident record

- Failed deployment commit: `d3ed54b59162c12a71cdf4b885c98fae6060ec14`
- Vercel failure: `[NEXT_NO_VERSION]` during project detection, before `next build`.
- The root `package.json` delegates build to `nextjs-setup/nextjs-dashboard` but does not declare `next`.
- The dashboard package manifest declares `next: 16.3.6`, `react: 19.2.8`, and `react-dom: 19.2.8`.
- A Vercel bot report on PR #26 reported `rootDirectory: null`. This supports (but does not alone prove) the diagnosis that Vercel is detecting the repository root rather than the dashboard application.
- The repository has a root `pnpm-lock.yaml` and root `pnpm-workspace.yaml` declaring `nextjs-setup/*`. The dashboard also has a nested `package-lock.json` and a nested `pnpm-workspace.yaml`; the latter contains pnpm build-policy configuration. Do not delete either file without confirming its intended role.

## Vercel project settings

Apply these settings to the existing Vercel project; this is an operations/configuration change, not a queue-code change:

1. Set **Root Directory** to `nextjs-setup/nextjs-dashboard`.
2. Enable **Include source files outside of the Root Directory in the Build Step** if dashboard build imports require repository-root files. Verify the exact label in the current Vercel UI.
3. Keep the framework preset set to **Next.js**; do not force `framework: null`.
4. Select one authoritative install workflow before redeploy. The repository root has the canonical pnpm workspace and lockfile; if the Vercel install command is customized, verify its working-directory semantics so it runs a frozen-lockfile install against that root workspace.
5. Redeploy the same feature-branch commit after completing the package-manager hygiene gate below, so the deployment isolates configuration/baseline corrections from queue-code changes.

Do not add `next` to the repository-root manifest solely to suppress `NEXT_NO_VERSION`: the actual Next.js application owns that dependency in the dashboard manifest.

## Package-manager hygiene gate — complete before first redeploy

The checked-in root pnpm workspace and root lockfile are evidence that pnpm is the repository-level package manager. The nested dashboard `package-lock.json` is a competing npm lockfile; the nested `pnpm-workspace.yaml` contains configuration and must not be assumed stale just because it is nested.

Before redeploying:

1. Check repository history and scripts/docs for a supported standalone-dashboard npm workflow.
2. If no standalone npm workflow is intended, remove the nested `package-lock.json) in a separate reviewed baseline/configuration change. Do not regenerate or hand-edit lockfiles unless a dependency manifest actually changes.
3. Inspect the nested `pnpm-workspace.yaml` separately. Retain it if its `allowBuilds` policy is needed for standalone pnpm operations; otherwise consolidate its policy into the root workspace and remove it only in the same reviewed configuration change.
4. Verify the root `pnpm-lock.yaml` contains both the root and dashboard importers and that `pnpm install --frozen-lockfile` succeeds from the repository root.
5. Confirm Vercel's effective install command and working directory match that chosen workflow before starting the deployment.

Do not fold package-manager cleanup into PR 1's queue implementation.

## Redeploy verification and decision tree

Capture the full Vercel build output and record the deployment URL, commit SHA, effective Root Directory, install command, and package manager.

- **Still `NEXT_NO_VERSION`:** confirm saved Root Directory, Next.js preset, and that the deployment uses the intended commit.
- **Lockfile/workspace or unresolved-package error:** verify the actual install working directory and the hygiene-gate decisions above; do not reflexively delete lockfiles.
- **Peer dependency error:** re-check dashboard `next`, `react`, and `react-dom` declarations and the resolved lockfile versions.
- **Failure after `next build` begins:** classify the first real compiler/import/runtime error by file and compare the failing file with the PR diff before assigning it to PR 1 or baseline.
- **Build succeeds:** record the successful deployment and its commit SHA. This does not substitute for PR 1's real Redis integration suite, type-check, lint, or other required gates.

## Scope and safety

This runbook documents a Vercel project-settings/baseline issue. It does not modify `dev`, unlock live publishing, change `DRY_RUN`, or start PR 2. Keep deployment configuration repairs separate from the durable queue implementation unless evidence shows the queue PR changed the relevant configuration.
