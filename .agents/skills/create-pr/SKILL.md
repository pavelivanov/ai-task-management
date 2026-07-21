---
name: create-pr
description: Publish a completed repository worktree as a GitHub pull request and monitor it for safe automatic cleanup after merge. Use only when the user explicitly asks to create, open, or publish a PR, invokes $create-pr, or selects create-pr through /skills; do not use automatically at implementation completion.
---

# Create PR

Publish only a verified, committed task worktree. Keep the primary checkout on
`main`, and leave it ready for the next task after the PR merges.

## Workflow

1. Confirm the user explicitly requested PR creation in the current turn.
2. Run `git status --short --branch` and `git worktree list --porcelain`.
3. Refuse to continue when any of these conditions is true:
   - the current checkout is the primary worktree;
   - `HEAD` is detached or the branch is `main`;
   - the branch does not match `codex/*`;
   - tracked or untracked changes remain;
   - the task branch has no commit beyond `main`.
4. Confirm `npm run verify` passed after the final change. Run it now if the
   current task has no trustworthy result in context.
5. Audit the committed diff against `main`. Derive a concise PR title and body
   describing the outcome and verification. Write the body to a temporary file.
6. Run:

   ```bash
   .agents/skills/create-pr/scripts/create-pr.sh \
     --title "<title>" \
     --body-file "<absolute-body-file>"
   ```

   Add `--ready` only when the user explicitly asks for a ready-for-review PR;
   draft is the default.

7. Report the PR URL and merge-watcher log path. Do not wait synchronously for
   the merge.

The script pushes without force, creates or reuses the PR, and starts a detached
watcher. After GitHub reports the PR merged, the watcher checks both worktrees
are clean, switches the primary checkout to `main` if needed, fast-forwards it
to `origin/main`, removes the task worktree, and deletes task branch refs. Any
unsafe condition stops cleanup and is recorded in the watcher log.
