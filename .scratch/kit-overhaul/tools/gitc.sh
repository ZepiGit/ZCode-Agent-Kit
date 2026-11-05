#!/usr/bin/env bash
# git wrapper for this run: commit identity without touching any git config.
export GIT_AUTHOR_NAME="ZepiGit" GIT_AUTHOR_EMAIL="292425648+ZepiGit@users.noreply.github.com"
export GIT_COMMITTER_NAME="ZepiGit" GIT_COMMITTER_EMAIL="292425648+ZepiGit@users.noreply.github.com"
exec git "$@"
