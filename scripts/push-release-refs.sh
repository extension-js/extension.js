#!/usr/bin/env bash
# Push release refs to GitHub over SSH with the release deploy key.
#
# main only takes pull requests with a green CI passed check. The GitHub
# Actions app cannot be a ruleset bypass actor on this repository, so the
# release job pushes its version and changelog commits with this deploy key,
# which is. The workflow hands the key to this script in the env of a step
# that runs nothing else, and the key sits on disk only for the length of the
# push, so no install, build, hook or script in the tree runs beside it. The
# guarantee holds only while the workflow keeps the key out of every other
# step's env.
set -euo pipefail

: "${RELEASE_DEPLOY_KEY:?RELEASE_DEPLOY_KEY is not set, add it to this release environment}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"

if [ "$#" -eq 0 ]; then
  echo "usage: push-release-refs.sh <refspec>..." >&2
  exit 2
fi

key_file="$(mktemp "${RUNNER_TEMP:-/tmp}/release-key.XXXXXX")"
known_hosts="$(mktemp "${RUNNER_TEMP:-/tmp}/release-known-hosts.XXXXXX")"
trap 'rm -f "$key_file" "$known_hosts"' EXIT
chmod 600 "$key_file"
printf '%s\n' "$RELEASE_DEPLOY_KEY" > "$key_file"

# GitHub's published ed25519 host key (https://api.github.com/meta), pinned so
# the push never trusts whatever answers on port 22.
printf 'github.com %s\n' "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$known_hosts"

export GIT_SSH_COMMAND="ssh -i $key_file -o IdentitiesOnly=yes -o UserKnownHostsFile=$known_hosts -o StrictHostKeyChecking=yes"
git push "git@github.com:${GITHUB_REPOSITORY}.git" "$@"
