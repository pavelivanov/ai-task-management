#!/bin/sh

set -eu

if [ "$#" -ne 6 ]; then
  echo "usage: $0 <pr> <worktree> <primary> <branch> <base> <remote>" >&2
  exit 2
fi

pr_url=$1
worktree_root=$2
primary_root=$3
branch=$4
base_branch=$5
remote=$6
poll_seconds=${CREATE_PR_POLL_SECONDS:-30}
watcher_path=$0

cleanup_watcher() {
  rm -f "$watcher_path"
}
trap cleanup_watcher EXIT HUP INT TERM

timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
  echo "$(timestamp) $*"
}

command -v gh >/dev/null 2>&1 || {
  log "GitHub CLI (gh) is unavailable; cleanup not started"
  exit 1
}

log "Watching $pr_url for merge"
while :; do
  pr_state=$(gh pr view "$pr_url" --json state,mergedAt --jq 'if .mergedAt then "MERGED" else .state end' 2>/dev/null || true)
  case "$pr_state" in
    MERGED)
      break
      ;;
    CLOSED)
      log "PR closed without merge; preserving worktree and branch"
      exit 0
      ;;
    *)
      sleep "$poll_seconds"
      ;;
  esac
done

log "PR merged; validating cleanup preconditions"
pr_head=$(gh pr view "$pr_url" --json headRefName --jq .headRefName)
pr_base=$(gh pr view "$pr_url" --json baseRefName --jq .baseRefName)
[ "$pr_head" = "$branch" ] || {
  log "PR head changed: expected $branch, got $pr_head"
  exit 1
}
[ "$pr_base" = "$base_branch" ] || {
  log "PR base changed: expected $base_branch, got $pr_base"
  exit 1
}
[ -d "$primary_root" ] || {
  log "Primary checkout is missing: $primary_root"
  exit 1
}
[ -d "$worktree_root" ] || {
  log "Task worktree is already absent: $worktree_root"
  exit 1
}
[ -z "$(git -C "$worktree_root" status --porcelain)" ] || {
  log "Task worktree has uncommitted changes; refusing cleanup"
  exit 1
}
[ -z "$(git -C "$primary_root" status --porcelain)" ] || {
  log "Primary checkout has uncommitted changes; refusing cleanup"
  exit 1
}

current_primary_branch=$(git -C "$primary_root" symbolic-ref --quiet --short HEAD || true)
if [ "$current_primary_branch" != "$base_branch" ]; then
  log "Switching primary checkout from ${current_primary_branch:-detached HEAD} to $base_branch"
  git -C "$primary_root" switch "$base_branch"
fi

log "Fast-forwarding $base_branch from $remote"
git -C "$primary_root" fetch "$remote" "$base_branch" --prune
git -C "$primary_root" merge --ff-only "$remote/$base_branch"

log "Removing task worktree $worktree_root"
git -C "$primary_root" worktree remove "$worktree_root"

if git -C "$primary_root" show-ref --verify --quiet "refs/heads/$branch"; then
  log "Deleting local branch $branch"
  git -C "$primary_root" branch -D "$branch"
fi

if git -C "$primary_root" ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  log "Deleting remote branch $remote/$branch"
  git -C "$primary_root" push "$remote" --delete "$branch"
fi

git -C "$primary_root" fetch "$remote" --prune
git -C "$primary_root" worktree prune
log "Cleanup complete; primary checkout is ready on $base_branch"
