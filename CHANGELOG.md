# Changelog

## Unreleased

- Bump Extension.js (c0febe63)
- Bump fast-uri to ^3.1.2 to clear Dependabot path-traversal + host-confusion advisories (5d12061a)
- Replay programmatic chrome.scripting.executeScript calls on /scripts/* edits (3a128b3a)
- Only warn for genuinely new files in pages/ and scripts/, not modifications (4c6bf8a6)
- Sweep orphan content-script roots and ignore current-build roots in cleanupKnownRoots (8c911cbf)
- Gate devtools overlay at content-script entry and harden launcher UX (ab6eb325)
- Gate devtools overlay at content-script entry and harden launcher UX (1a937fad)
- Auto-resolve workspace subpackage when extension dev is given the monorepo root (8e413f3f)
- Honor namespaced manifest_version in SetupBackgroundEntry default background entry (0f0774a7)
- Derive Chromium extension ID from load path when no manifest key + no runtime target (51527433)

## 3.8.2

- Harden optional dependency runtime resolution to reduce first-run failures.

## 3.8.1

- No user-facing changes beyond release packaging updates.

## 3.8.0

- Add support for canary releases.
- Add an experimental `install` command.
- Improve Windows test and runtime reliability across Chromium, Edge, and Firefox flows.
- Improve path handling and source output behavior for more consistent CLI runtime output.
- Stabilize remote zip/template handling and companion loading defaults.
- Improve extension developer feedback by making Extension ID output more reliable and less noisy.

