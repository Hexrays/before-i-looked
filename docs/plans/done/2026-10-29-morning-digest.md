---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
closed: 2026-10-29
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Completion

Review is complete. The reviewer was confirmed to have seen the page, and issue #7 is
closed. A human separately approved replacement of the public preview with a clean copy.

The clean replacement succeeded in [workflow run 40988262319](https://github.com/Hexrays/before-i-looked/actions/runs/40988262319).
The same public URL, https://hexrays.github.io/before-i-looked/, was verified: the banner
reads "no marker set" and the lane marker is absent. The workflow has no retained artifacts.

The ignored local copy at `var/preview/index.html` was regenerated with
`env -u LANE_MARKER pnpm export:preview`. Its banner reads "no marker set"; comparison with
the local configuration confirmed that the lane marker is absent. No preview or local
configuration is included in this archive.

## Issues

| # | Issue | Blocked by |
|---|-------|------------|
| [#1](https://github.com/Hexrays/before-i-looked/issues/1) | Digest types | — |
| [#2](https://github.com/Hexrays/before-i-looked/issues/2) | Run log reader | #1 |
| [#3](https://github.com/Hexrays/before-i-looked/issues/3) | Digest page | #1, #2 |
| [#4](https://github.com/Hexrays/before-i-looked/issues/4) | Digest JSON | #1, #2, #3 |
| [#5](https://github.com/Hexrays/before-i-looked/issues/5) | Board links | #1, #2, #3 |
| [#6](https://github.com/Hexrays/before-i-looked/issues/6) | Route tests | #1, #3, #4 |
| [#7](https://github.com/Hexrays/before-i-looked/issues/7) | Review preview | #2, #3, #4, #5, #6 |
| [#8](https://github.com/Hexrays/before-i-looked/issues/8) | Remove marker and archive plan | #7 |
