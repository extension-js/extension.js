# Error and Warning Messaging Policy

This document defines a consistent, user-friendly messaging style across Extension.js features. Apply these rules for any feature that validates paths or reports missing files.

## Message structure

- Line 1: Context header
  - Icons (manifest fields):
    - `Check the <field> field in your manifest.json file.`
  - HTML assets:
    - `Missing <type> in <absolute-or-relative-html-path>.`
- Line 2: Actionable guidance sentence
  - Example: `The icon path must point to an existing file that will be packaged with the extension.`
  - HTML: `Update your <script>/<link> reference to point to a file that exists.`
- Optional hint (public-root)
  - Only include when the ORIGINAL authoring used an extension‑root absolute path (leading '/').
  - Text: `Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.`
- Blank line
- Final line: NOT FOUND + normalized path
  - `NOT FOUND <display-path>`

## When to show the public-root hint

Show the hint only if the author actually used an extension‑root path:

- Manifest/Icons: the manifest value for the failed path started with '/'.
- HTML: the original attribute value (src/href) started with '/'.
- Do NOT show the hint for:
  - Relative paths (e.g., `images/icon.png`)
  - OS‑absolute filesystem paths (e.g., `/Users/foo/app/icon.png`) that result from resolution

## Path displayed in NOT FOUND

- Extension‑root (leading '/'): print `outputRoot + strippedPath`
  - Example: `/icons/16.png` → `dist/chrome/icons/16.png`
- Otherwise, print the resolved absolute filesystem path (or `projectRoot + relative` when relevant)
- Always underline the path in the final renderer (handled by message functions)

## Severity policy

- Icons (Chromium behavior):
  - Top‑level `manifest.icons`: ERROR (prevents loader alerts/crashes)
  - Other icon families (`action.default_icon`, `browser_action.default_icon`, `page_action.default_icon`, `sidebar_action.default_icon`, `browser_action.theme_icons`): WARNING
- HTML:
  - Missing embedded assets (img, fonts, etc.) discovered from HTML: WARNING
  - Missing HTML entrypoints (declared via manifest): ERROR (raised by manifest feature checks)

## Manifest integration and ownership

- feature-icons owns all icon file existence reporting. feature-manifest must not also error on missing icon files to avoid duplication.
- feature-manifest continues to own HTML entrypoint presence/shape (e.g., `action.default_popup`).

## De‑duplication policy

- De‑duplicate by (file, message text). Before pushing to `compilation.errors`/`warnings`, check for an identical entry.
- Only one feature should report a given missing file scenario.

## Public/Resolution conventions

- Leading `/` means extension‑root (public root), relative to the directory containing `manifest.json`.
- Relative paths resolve from the directory containing `manifest.json` (for manifest resources) or the current HTML file (for embedded assets), as applicable.
- OS‑absolute filesystem paths are used as‑is.

## Implementation checklist (for new/updated features)

- [ ] Compute display path per the rules above
- [ ] Gate the public‑root hint strictly to original leading `/` authoring
- [ ] Set severity per policy
- [ ] Underline the NOT FOUND path; include a blank line before it
- [ ] Set `file` to `manifest.json` when erroring on manifest fields so the renderer prints `ERROR in manifest.json`
- [ ] De‑duplicate before push
- [ ] Ensure no other feature double‑reports the same scenario

## Examples

Icons (top‑level, error):

```
Check the icons field in your manifest.json file.
The icon path must point to an existing file that will be packaged with the extension.

NOT FOUND /abs/out/chrome/icons/16.png
```

Icons (non‑top‑level, warning) with root path:

```
Check the action.default_icon field in your manifest.json file.
The icon path must point to an existing file that will be packaged with the extension.
Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.

NOT FOUND /abs/out/chrome/action/16.png
```

HTML (missing static asset, warning), root path:

```
Missing asset in /abs/project/pages/main.html.
Update the *.png reference to point to a file that exists.
Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.

NOT FOUND /abs/out/chrome/img/logo.png
```

HTML (missing static asset, warning), relative path:

```
Missing asset in /abs/project/pages/main.html.
Update the *.png reference to point to a file that exists.

NOT FOUND /abs/project/pages/img/logo.png
```

---

Adhering to this policy keeps messages clear, consistent, and aligned with browser behavior across all features.
