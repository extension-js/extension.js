# Store metadata

Starter file generated from this template's manifest. STORE.md is what
`extension_submit sync-listing` reads to fill the Chrome Web Store, Firefox
Add-ons, Edge Add-ons and Mac App Store listings, and what the store
preflights check. Every store asks for this material at submission time, so
keep it current as the code changes instead of rewriting it at the end. A
line marked TODO is a fact only the owner can supply: the file shows what is
missing and never invents listing copy, and a value that still starts with
TODO is skipped, not sent. Items a store takes only on its own dashboard
(Chrome promo tiles and data-use answers, Edge logo, tiles and properties,
Apple's App Privacy and age rating) stay by hand and are listed under each
store below. The HTML comments carry each field's format and limits, and the
readers ignore them.

Last updated: 2026-10-24

## Listing

- Name: JavaScript Sidebar Example
  <!-- The store title, 100 characters at most on every store. -->
- Summary: Adds a sidebar panel to the browser.
  <!-- Chrome's summary, 132 characters at most. It doubles as the Safari
  subtitle only when it fits 30. -->
- Subtitle: TODO a 30 character App Store subtitle
  <!-- App Store subtitle, 30 characters at most. Without it the Safari push
  leaves the field empty. -->
- Description:

  TODO two or three short paragraphs of user benefits. Describe what the
  user sees and gains, not how the code works. Keep every paragraph indented
  like this one so the readers take them as one field.

- Category: TODO one per store, for example Productivity (Chrome Web Store,
  Firefox Add-ons, Edge Add-ons), Utilities (App Store)
  <!-- One category per store, the store names in parentheses stay out of
  the value. One of them must be an App Store category (Productivity or
  Utilities): Apple refuses an upload without a primary category. -->
- Language: en
- License: MIT
  <!-- A bare SPDX identifier with no trailing period: "MIT." once reached
  AMO as the license. -->
- Support email: TODO the address users and reviewers write to
- Homepage: TODO the project or company site URL
- Search terms: TODO up to seven terms, comma separated
  <!-- Comma list. Edge takes at most 7 terms and 21 words in all, and
  Safari keywords are 100 characters in all. -->
- Screenshots:
  1. TODO screenshots/01.png
  <!-- One PNG path per numbered line, relative to the project. Chrome takes
  1280x800 or 640x400, Edge 1280x800 or 640x480, the App Store exactly
  1280x800, 1440x900, 2560x1600 or 2880x1800 in RGB without alpha and
  showing the extension in real Safari (a 2880x1800 capture of a Safari
  window is the simplest way). Chrome and Edge also show 440x280 and
  1400x560 promo tiles. -->

## Privacy and data use

- Privacy policy URL: TODO (Apple requires one on every app, Chrome and Edge
  once any data is handled)
  <!-- The only place this URL lives. The readers take the first http or
  https address on this line, so leave no sample address here. -->
- Data collected: none
  <!-- Every kind of data the extension collects, stores or sends, or none.
  Chrome, Edge and Apple each ask it again on their dashboards. -->
- Firefox data collection: none
  <!-- Mirrors browser_specific_settings.gecko.data_collection_permissions
  in the manifest. AMO reads the manifest, so the two must agree. -->

Per store answer sheets, filled from the two lines above:

- Chrome Web Store: the data-usage checkboxes and the three certifications
  on the Privacy practices tab, answered by hand on the developer dashboard.
- Firefox Add-ons: the manifest's data_collection_permissions is the
  declaration, and AMO reads it from the package.
- Edge Add-ons: the nine data categories and the three certifications on the
  Privacy page, typed once on Partner Center.
- App Store: App Privacy, "Data Not Collected" when the line above says
  none, answered by hand in App Store Connect.

## Chrome Web Store

### Single purpose

Adds a sidebar panel to the browser.

### Permissions justification

<!-- One bullet per permission, host permission and content script match
the manifest requests, as the Chrome dashboard and the Edge Privacy page
ask them. A reason that still starts with TODO is not sent. "Needed for
the extension to work" fails review on every store. -->

- sidePanel: Renders the extension's main interface in the browser side
  panel. Requested on Chromium only.
- tabs: TODO reason
- Content script match <all_urls>: The content script runs on the pages the
  user visits to render the extension's on-page interface. Narrow this to
  the specific sites your extension needs before submitting.

Remote code: none. Every script ships inside the package, which is the
answer to the remote code question on Chrome and Edge.

### Test instructions

TODO the steps a reviewer follows to see the extension work, with test
credentials when sign-in is required. The Firefox reviewer notes and the
Edge certification notes below take the same steps.

## Firefox Add-ons

### Reviewer notes

TODO the steps a reviewer follows to exercise the extension, with test
credentials when sign-in is required. Keep the build paragraph below: AMO
wants a reproducible build for a bundled package.

Build from source with Node 22.12.0 and npm 10.9.0 (replace both with the
output of node --version and npm --version on the machine that built the
upload): run npm install, then npx extension build --browser firefox. The
upload is dist/firefox, byte for byte. With the Firefox source archive
setting on in extension.dev, the platform attaches the repository at the
built commit, so no separate source zip is uploaded.

### Release notes

TODO what changed for users in this version, in their words. Write the notes
here rather than pointing at another section: a pointer reaches AMO
verbatim.

## Edge Add-ons

The package may hold no compressed file: Partner Center refuses any .gz,
.zip or other archive inside it, so vendor such assets uncompressed. Logo,
promo tiles, screenshots, properties and privacy answers are typed once on
Partner Center, because the Publish API takes only packages.

### Certification notes

TODO the steps the certification team follows to test the extension, with
test credentials when sign-in is required. The Firefox reviewer notes fit
here in most cases: paste them rather than pointing at them.

### Dashboard checklist

What the Publish API cannot set, typed once on Partner Center:

- Store logo, 300x300 PNG.
- Promo tiles, 440x280 and 1400x560, shown on the store page.
- Properties page: the answers on personal information and mature content.
- Privacy page: the nine data categories and three certifications, the same
  answers as the Privacy and data use section.
- Optional YouTube URL.

## Safari (Mac App Store)

- Bundle identifier: TODO com.example.my-extension
  <!-- Reverse DNS, permanent once the first build reaches App Store
  Connect. -->
- Review contact name: TODO
- Review contact email: TODO
- Review contact phone: TODO

### Reviewer notes

TODO how to turn the extension on: open Safari, choose Safari, Settings,
Extensions, tick the extension, then allow it on the sites it needs. Add
test credentials when sign-in is required.

### Release notes

TODO what's new in this version, in the user's words. Required from the
second version on.

### Age rating

Apple's questionnaire is answered in full on every push. None applies unless
a line below says otherwise.

- Violence, mature or suggestive themes, profanity, horror, medical or drug
  references, gambling, contests: none
- Parental controls, age assurance: none
- Unrestricted web access: none
- User generated content, social media, messaging: none
- Advertising: none
- Loot boxes or similar in-app purchases: none

App Privacy, and today the age rating and the availability in all 175
territories as well, are confirmed by hand in App Store Connect. Run the
converted app locally with `npx extension build --browser safari --bundle-id
<id> --development-team <TEAM>`: an ad-hoc build without a team stops
answering after Safari relaunches.

## Version history

One line per version and store attempt with its outcome, newest first, for
example "0.1.0: Chrome draft uploaded 2026-10-21, AMO upload refused 401 bad
key pair, Edge draft pending".

- 1.0.0 (unreleased): initial version from the javascript template. Not yet
  submitted to any store.
