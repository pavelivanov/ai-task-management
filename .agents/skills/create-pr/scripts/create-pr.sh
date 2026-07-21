#!/bin/sh

set -eu

usage() {
  echo "usage: $0 --title <title> --body-file <path> [--ready]" >&2
  exit 2
}

title=
body_file=
draft_flag=--draft

while [ "$#" -gt 0 ]; do
  case "$1" in
    --title)
      [ "$#" -ge 2 ] || usage
      title=$2
      shift 2
      ;;
    --body-file)
      [ "$#" -ge 2 ] || usage
      body_file=$2
      shift 2
      ;;
    --ready)
      draft_flag=
      shift
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$title" ] || usage
[ -n "$body_file" ] || usage
[ -f "$body_file" ] || {
  echo "PR body file does not exist: $body_file" >&2
  exit 1
}
command -v git >/dev/null 2>&1 || {
  echo "git is required" >&2
  exit 1
}
command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required" >&2
  exit 1
}

worktree_root=$(git rev-parse --show-toplevel)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
primary_root=$(dirname "$common_dir")
branch=$(git symbolic-ref --quiet --short HEAD || true)
base_branch=${CREATE_PR_BASE_BRANCH:-main}
remote=${CREATE_PR_REMOTE:-origin}

[ "$worktree_root" != "$primary_root" ] || {
  echo "Refusing to publish from the primary checkout: $primary_root" >&2
  exit 1
}
[ -n "$branch" ] || {
  echo "Attach the worktree to a codex/<task-slug> branch first" >&2
  exit 1
}
case "$branch" in
  codex/*) ;;
  *)
    echo "Task branch must match codex/*, got: $branch" >&2
    exit 1
    ;;
esac
[ -z "$(git status --porcelain)" ] || {
  echo "Commit or remove all worktree changes before creating a PR" >&2
  exit 1
}
git show-ref --verify --quiet "refs/heads/$base_branch" || {
  echo "Local base branch does not exist: $base_branch" >&2
  exit 1
}
[ "$(git rev-list --count "$base_branch..HEAD")" -gt 0 ] || {
  echo "Task branch has no commits beyond $base_branch" >&2
  exit 1
}

git push --set-upstream "$remote" "$branch"

if pr_url=$(gh pr view "$branch" --json url --jq .url 2>/dev/null); then
  echo "Using existing pull request: $pr_url"
else
  if [ -n "$draft_flag" ]; then
    pr_url=$(gh pr create --base "$base_branch" --head "$branch" --title "$title" --body-file "$body_file" "$draft_flag")
  else
    pr_url=$(gh pr create --base "$base_branch" --head "$branch" --title "$title" --body-file "$body_file")
  fi
fi

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
watcher_copy=$(mktemp "${TMPDIR:-/tmp}/create-pr-watch.XXXXXX")
cp "$script_dir/watch-pr-merge.sh" "$watcher_copy"
chmod 700 "$watcher_copy"
log_key=$(printf '%s' "$branch" | tr '/ ' '--')
log_file="${TMPDIR:-/tmp}/create-pr-${log_key}.log"

(
  cd "$primary_root"
  nohup "$watcher_copy" "$pr_url" "$worktree_root" "$primary_root" "$branch" "$base_branch" "$remote" >"$log_file" 2>&1 &
)

echo "Pull request: $pr_url"
echo "Merge watcher log: $log_file"
