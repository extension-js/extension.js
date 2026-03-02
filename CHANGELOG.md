# Changelog

## Unreleased

- Improve version resolution during create step (de9b8143)
- Fix dependabot alerts (36fdec15)
- Add deterministic deep content-script reload validation. (191d77bf)
- Ignore dist output changes in hard reload watch detection (19e53727)
- Gate first-run canary reload regression (d641bcc8)
- Bump svelte from 5.51.5 to 5.53.5 (#413) (cd34d7b9)
- Experimental error overlay (fbbc302a)
- Harden Chromium CDP startup against short-circuit failures (a4f2056f)
- Fix warn-dev-mode spec logger mock typing (0df141e8)
- Harden CDP extension ownership during first-run startup (98da8b8e)
- Fix Chromium hard-reload test (6494abb1)
- Add more scripts to default creation projects (c7c70caf)
- Fix first-run Chromium extension disable regressions (c760bf8b)
- Fix hard-reload running on first runs and breaking UX (9766d301)
- Auto-scan top-level ./extensions (c9a435cd)
- Avoid Chromium extension hard reload on initial dev build (2bb934fd)
- chore(release): move changelog to v3.8.7 (1d6fee51)

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

