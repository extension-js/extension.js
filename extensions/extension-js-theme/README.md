# @extension-js/theme

The built-in Extension.js browser theme used during development.

## Theme notes

- Updated background tab text colors to meet WCAG AA contrast against the dark frame.
- Inactive window background tab text remains slightly dimmer to preserve hierarchy. This dimming is Chromium only, Firefox has no inactive-window text key and keeps the brighter gray (still WCAG AA).
- Background tab surfaces are darker than the active tab (frame vs toolbar).
- Toolbar text and icon colors are pinned explicitly (`toolbar_text`, Chromium `toolbar_button_icon`, Firefox `icons`) instead of relying on each browser's auto-derivation against the dark toolbar.
- The URL bar is pinned inside the dark palette on both engines: Chromium `omnibox_background`/`omnibox_text`, Firefox `toolbar_field`/`toolbar_field_text` plus the `_focus` variants. Firefox also pins `toolbar_field_border` (3.3:1 vs toolbar) and a brighter `toolbar_field_border_focus` so the field boundary stays visible (WCAG 1.4.11). On Chromium `omnibox_background` styles the results dropdown, the steady-state field is derived by the browser from `toolbar` with its own min-contrast blend.
- `button_background` is a Chromium-only key. Firefox falls back to its defaults there by design.
