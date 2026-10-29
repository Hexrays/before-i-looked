# rig

Keeps a lane's lights on: a heartbeat every minute, a status board, and a morning digest.

Use Node 24 and pnpm 11.18.0. Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm dev               # http://localhost:8787; loads .env if present
```

For local development, copy `.env.example` to `.env` if needed, then edit it locally.
Never print or commit its values. Start agent work at [AGENTS.md](AGENTS.md).
Pi loads the native `.agents/skills/` directory automatically; no copies or configuration
are needed.

## Export the review preview locally

Save `/digest/2026-10-28` as one self-contained HTML file, with the lane banner:

```sh
env -u LANE_MARKER pnpm export:preview
```

The default output is `var/preview/index.html`. The command starts the Hono app on an
ephemeral loopback HTTP port, fetches the digest, writes the file, then closes the server,
including on failure. It has a ten-second request deadline and starts no heartbeat.

The exporter **does not load `.env`**. It uses the caller's environment. To include the local
marker, explicitly opt in:

```sh
node --env-file=.env --import tsx src/export-preview.ts
```

To replace that copy with a clean preview, even when `.env` exists:

```sh
env -u LANE_MARKER pnpm export:preview
```

The banner then reads `no marker set`. An optional output path must stay under ignored
`var/`, for example:

```sh
env -u LANE_MARKER pnpm export:preview var/preview-copy/index.html
```

Do not commit previews, attach them to issues or chat, or print their HTML in logs. They
can contain the marker. Only the sample digest HTML is intended for publication, not the
repository, run logs, local configuration, or heartbeat.

## Publication approval gates

The workflow file does not grant permission to publish. Repo pushes and issue work need
human approval; publication needs separate approval before settings, secrets, or deployment
are changed. Local export and tests do not publish anything.

After approval of repo work, an authorized operator can push and merge the code to `main`.
Merging does not publish: `.github/workflows/preview-pages.yml` has only
`workflow_dispatch`, no push trigger, and deploys only from `main`.

Before publication, a human must separately approve the public exposure of the sample
data and, for a marked preview, the marker. An authorized operator must configure GitHub Pages
to use GitHub Actions, review the `github-pages` environment protection rules, and set the
repository secret named `LANE_MARKER` through a secure channel if a marked preview is
approved. Do not put its value in source, command arguments, issues, or logs.

Only after those approvals, dispatch the marked preview:

```sh
gh workflow run preview-pages.yml --repo Hexrays/before-i-looked --ref main -f with_marker=true
gh run list --repo Hexrays/before-i-looked --workflow preview-pages.yml --limit 5
```

The boolean `with_marker` defaults to `false`. A marked run fails if the secret is missing
or blank. Only the export step receives the secret, and only when `with_marker=true`.
Tests and typecheck run before export. The workflow uploads only `var/preview/index.html`,
then deploys it to the replaceable GitHub Pages HTTPS URL.

**The uploaded Actions artifact can also expose the marker.** The workflow deletes that
artifact after a successful deployment, with one-day retention as a backup. Check that
deletion succeeded. If deployment or deletion fails, an authorized human must remove the
artifact promptly; retention is not immediate removal. Deleting an artifact does not
remove the live Pages copy, and public copies cannot be recalled.

After the run succeeds, get the live URL and this plan's issues:

```sh
gh api repos/Hexrays/before-i-looked/pages --jq .html_url
gh issue list --repo Hexrays/before-i-looked --label plan:morning-digest --state all --limit 100
```

Check the public HTTPS page and send its link plus issues #1–#8 to the reviewer. Do not
send the HTML or the marker itself. Issue #7 stays open until that submission is complete.
Only then use the exact closing-comment format in `AGENTS.md`, with the real worker,
commit, and completed result. Preparing this workflow does not meet that done condition.

## After review

Issue #8 owns marker removal and plan archival. After the required human approval for that
replacement deployment, publish a clean copy to the **same** URL:

```sh
gh workflow run preview-pages.yml --repo Hexrays/before-i-looked --ref main -f with_marker=false
```

That run unsets `LANE_MARKER` before export and does not load `.env`. Verify that the live
banner reads `no marker set`, check artifact deletion, then complete the remaining issue #8
steps. Do not archive the plan as part of issue #7.
