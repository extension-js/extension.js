# Changelog

## Unreleased

## 4.1.26 (September 20, 2026)

- **Zen and Floorp launch by name.** `extension dev --browser=zen` and `extension dev --browser=floorp` find a stock install on macOS, Windows and Linux, the same way Waterfox and LibreWolf already do.
- **Readable Opera builds and a `--minify` switch.** `extension build --browser=opera` ships unminified production code, which Opera Add-ons asks for in review, and `--minify` or `--no-minify` overrides the default on any target.
- **Dev server and build fixes.** A one-byte file is served with its byte instead of an empty body that broke the connection, a manifest page kept under `pages/` compiles once, files named under custom manifest keys ship, and the unpacked extension id matches Chrome when the project sits behind a symlink.

### Features

- Add a funding manifest and funding fields to published packages (#610) ([8f1a62ed](https://github.com/extension-js/extension.js/commit/8f1a62edc31e1950ad349db6a4824065115a6c36))
- Add a context7.json so coding agents get the right usage rules (#611) ([84211837](https://github.com/extension-js/extension.js/commit/842118371a0b39528f8156c0018cb1bb488437fd))

<details>
<summary>Other changes (18)</summary>

- Write the 4.1.26 release highlights (#615) ([f2c84d72](https://github.com/extension-js/extension.js/commit/f2c84d729d3b846a54267a15310d960103d8cf25))
- Update the changelog ([ceb57af6](https://github.com/extension-js/extension.js/commit/ceb57af6b943ca2cf1b22d6911802aa6c8f5c66e))
- Compare the emulator dist path from one resolved root (#614) ([e9a84781](https://github.com/extension-js/extension.js/commit/e9a84781b79d644a104e7a3bc642a80dbc207abb))
- Serve a one-byte asset with its byte on the dev server ([cf8ce084](https://github.com/extension-js/extension.js/commit/cf8ce08425c773d87afecd4725b67601683f080e))
- Make the content-script step spy constructible the way the formatter keeps it ([414cfb1e](https://github.com/extension-js/extension.js/commit/414cfb1ed754543cc59202ddc2616ff1a12e2091))
- Keep emulated Chromium on static content scripts, the lane injects no producer to re-register them ([9c61e556](https://github.com/extension-js/extension.js/commit/9c61e556043592d0282cce86d59c4ee38f0a5ad7))
- Fold an empty path segment in the emulator files index and list the file once ([2048f6bf](https://github.com/extension-js/extension.js/commit/2048f6bf750c05dcdbd05932b1cb85ca1cde716d))
- Mock the dev content-script step in the emulator reload spec after the rebase ([fd942636](https://github.com/extension-js/extension.js/commit/fd942636667f24938b72cb0d6cc8ba4d93372e02))
- Read the emulated Chromium origin before opening it and name a hold or a rate limit ([67f263c1](https://github.com/extension-js/extension.js/commit/67f263c15daaba51e2a6130e02bfd9b849618104))
- Reword the emulated Chromium refusals so each one names a next step ([9edb3342](https://github.com/extension-js/extension.js/commit/9edb3342e0c51d513736ec2560c02c49bf2bccbe))
- List only served files in the emulator index and name its livereload path ([b0474da3](https://github.com/extension-js/extension.js/commit/b0474da396f412d0db7212658e7c3d78cdfd8c6a))
- Open emulated Chromium and refuse logs, act and doctor against it ([9af2da7d](https://github.com/extension-js/extension.js/commit/9af2da7daf8712097093f906c75755a42ba04473))
- Serve the emulated Chromium page a file index and a viewer channel ([a74110bd](https://github.com/extension-js/extension.js/commit/a74110bd179fe8aec22078bf19442aa9987282d5))
- Accept chromium-emulator as a browser name behind an env flag ([d11850bd](https://github.com/extension-js/extension.js/commit/d11850bd81862cdd0d0670761f8d9c677c21025f))
- Compile a manifest page that lives under pages/ once (#613) ([ebe8064d](https://github.com/extension-js/extension.js/commit/ebe8064d0a3321fecca7ebaa37682432ce944c7f))
- Launch Zen and Floorp by name as gecko fork targets (#612) ([0a93b847](https://github.com/extension-js/extension.js/commit/0a93b847d2bc6e463130ba33558336b518fd41db))
- Ship manifest-named files and keep Opera builds readable (#609) ([3888d697](https://github.com/extension-js/extension.js/commit/3888d697e0669c7f44a14d07645642acf239e8f1))
- Derive the unpacked extension id from the real path (#608) ([37f500ee](https://github.com/extension-js/extension.js/commit/37f500ee32b7500add02c275669d06939be5718d))
</details>

## 4.1.25 (September 18, 2026)

- **A content script edit runs once.** In `extension dev` on Chrome and Edge, saving a content script now reaches the open tabs and every new page with exactly one copy running, where the previous copy used to keep running beside it. An html page edit refreshes the page alone instead of re-injecting the content script.

<details>
<summary>Other changes (2)</summary>

- Write the 4.1.25 release highlights (#607) ([a27a20a3](https://github.com/extension-js/extension.js/commit/a27a20a3c5f5a9fa1c1d95a20db2681fcd12e0e0))
- Register dev content scripts at runtime so an edit runs one copy (#606) ([5d2083ed](https://github.com/extension-js/extension.js/commit/5d2083ed48a4627c9c959c22c51e7f40718278f8))
</details>

## 4.1.24 (September 18, 2026)

- **Pages load clean again.** A fresh install of 4.1.18 to 4.1.23 could pull a newer rspack than the one tested here, and every page with a linked stylesheet threw on load. The bundler is now pinned, with a real build spec guarding the shape.
- **`extension create --template transformers-js`** scaffolds the side panel reshaped after Hugging Face's own browser extension sample: type in the box and the classification prints as JSON, with page text, selection and model settings on top, for Chrome, Edge and Firefox from one manifest.

<details>
<summary>Other changes (5)</summary>

- Use the new Extension.js logo and size the runtime logos at 64px (#605) ([6066c0fd](https://github.com/extension-js/extension.js/commit/6066c0fd85e3f5444d6dc8599261ec85ecbac8a0))
- Warn on a missing tabs permission only for gated tab fields (#604) ([0f76a134](https://github.com/extension-js/extension.js/commit/0f76a13440efe4dd5cad8fdb95f7a551cdba4fad))
- Write the 4.1.24 release highlights (#603) ([815b8161](https://github.com/extension-js/extension.js/commit/815b8161487e44499f02451a841be5932a31da94))
- Pin @rspack/core to 2.2.3 so a page with a stylesheet loads clean (#602) ([37759cd3](https://github.com/extension-js/extension.js/commit/37759cd3610e13332c5f71ded0fe38f2ebc97df5))
- Repin the template catalog to the transformers-js panel (#601) ([ae065809](https://github.com/extension-js/extension.js/commit/ae0658097512705ba0d5ebbd04134c9f83e6d004))
</details>

## 4.1.23 (September 18, 2026)

<details>
<summary>Other changes (2)</summary>

- Build svelte with one copy, the compiler when the project is older ([878c62d5](https://github.com/extension-js/extension.js/commit/878c62d5abe37b61e2174f8be6be00c1c447cb08))
- Frame a create failure once and name a mismatched CLI ([361231ec](https://github.com/extension-js/extension.js/commit/361231ec6e39d8a244bab5d68025733e411bc9fc))
</details>

## 4.1.22 (September 17, 2026)

<details>
<summary>Other changes (9)</summary>

- Turn developer mode on in the Chromium dev profile ([4e476fd9](https://github.com/extension-js/extension.js/commit/4e476fd9da91d5a7f07dc751986ec553ffcbf80a))
- Build the workspace dependency a package test needs ([378f6506](https://github.com/extension-js/extension.js/commit/378f650613a78939611dcb90ba224e7655ef24b0))
- Repin the catalog to the public folder fix and name the pin flag (#596) ([7603495f](https://github.com/extension-js/extension.js/commit/7603495f6663c1629842d7ab28b6045a0c8ef137))
- Publish the live Firefox pid and end it with the session (#595) ([afa58aef](https://github.com/extension-js/extension.js/commit/afa58aef8831bff47cfa33b145bcef531a782df1))
- Print a self-framed build warning once, without the generic hint (#593) ([6e9c33ef](https://github.com/extension-js/extension.js/commit/6e9c33efe23b5e03d0a7d128300b264da41b2ab4))
- Shorten the paths in the legacy public folder warning (#594) ([3ac0d290](https://github.com/extension-js/extension.js/commit/3ac0d2901c7e11056391e608a6629e3c9de31be1))
- Keep the Safety Check panel off the dev browser's extensions page (#592) ([2b87f773](https://github.com/extension-js/extension.js/commit/2b87f773754f2ad33418889d93c0272f27ed57d8))
- Pin the Yarn and Bun smoke lanes to the packed local tarballs (#591) ([5dcb7ae7](https://github.com/extension-js/extension.js/commit/5dcb7ae7bef3b2aa72482c48669c57a9001ecae2))
- Let the manifest readiness specs survive a slow runner (#590) ([5cb675bc](https://github.com/extension-js/extension.js/commit/5cb675bcb536f7ff1800bf8e2d7825a51d5ab2d1))
</details>

## 4.1.21 (September 17, 2026)

- **Bun as a runtime**, `bunx --bun extension@latest dev` runs the CLI on Bun 1.2 or newer, judged on Bun's own version. Older Bun gets one clear line and the Node.js path. [Docs](https://extension.js.org/docs/languages-and-frameworks/bun)
- **Runtime loaded modules know their own URL**, a file reached through `chrome.runtime.getURL`, `importScripts` or a root-absolute `<script src>` now reads its own emitted path from `import.meta.url`, so wasm, model and worker glue that resolves siblings from it finds them. [Docs](https://extension.js.org/docs/features/environment-variables#import-meta-url)
- **No more manifests without a manifest_version**, since 4.1.19 `chrome:` and `edge:` apply to one browser each, so a manifest that scoped every `manifest_version` to a vendor could build for another target with none. That build is now refused with the fix named. Use a plain `manifest_version` or `chromium:manifest_version` for the whole family. [Docs](https://extension.js.org/docs/features/browser-specific-fields)

### Features

- Add the runtime category to the public perfBudgets type (#582) ([891d101e](https://github.com/extension-js/extension.js/commit/891d101edc05b911e68cb6efc3020a487c37b3e5))

### Fixes

- Restore the published develop type docs and exempt them from lint (#574) ([dac16bc1](https://github.com/extension-js/extension.js/commit/dac16bc1a236da1f0e92ac7b6b4ea3e29dfd887d))
- Guard the shipped runtime against innerHTML assignments (#549) ([78436890](https://github.com/extension-js/extension.js/commit/7843689041432efe0ac9ac3c7facd450efd9899c))

<details>
<summary>Other changes (38)</summary>

- Sync the npm README copy to main automatically when README changes (#589) ([b08a370d](https://github.com/extension-js/extension.js/commit/b08a370dd5086ca4482e87d8bd4e5643d8df656a))
- Rename the badge, separate package managers, add a YouTube link (#588) ([b2c41050](https://github.com/extension-js/extension.js/commit/b2c41050f511db380bc4bb36c1380b409d3b5677))
- Escape the emit path literal in the import.meta.url define (#587) ([d0148b4c](https://github.com/extension-js/extension.js/commit/d0148b4c60c574a6b4f5b6fc0564b1fe49debd01))
- Skip the Safari converter on the first resync after a full package (#586) ([83d805a6](https://github.com/extension-js/extension.js/commit/83d805a6685c9513d37e4c5881013d1e289f24be))
- Keep the MAIN world inlined stylesheet when the polyfill is on (#585) ([1c4804b8](https://github.com/extension-js/extension.js/commit/1c4804b8512e8c337c99d4117dea50a618f1834b))
- Run the Safari pipeline in specs through an injected tool host (#576) ([7cfdc17b](https://github.com/extension-js/extension.js/commit/7cfdc17b65e7d283cf2483f5cf9edff11025fed5))
- Resync the bundled template and pin the catalog to the budget fix (#584) ([94ea9a07](https://github.com/extension-js/extension.js/commit/94ea9a07c5ef7ea574e3165ba72a0e4415f2819e))
- Say what extension open did instead of printing its result object (#581) ([569e2ef1](https://github.com/extension-js/extension.js/commit/569e2ef17afc62c72e49236b28224edafb428fbe))
- Color the logs level token by severity (#580) ([f5565f55](https://github.com/extension-js/extension.js/commit/f5565f5586495b5226241c11fd391af4e184f959))
- Color the doctor check glyphs by state (#579) ([4daf8330](https://github.com/extension-js/extension.js/commit/4daf8330264cbb2a905b4eb9174152cf3cf5c065))
- Reduce the derived Safari bundle id note to one line at completion (#578) ([96870773](https://github.com/extension-js/extension.js/commit/968707731d9c6dffeb9673e2907db28e8a51e62d))
- Print the remote project download as one glyph line with a URL row (#577) ([5787c463](https://github.com/extension-js/extension.js/commit/5787c4631d40dc80cfd97cc841ee8c7bdae22bee))
- Spawn npm and pnpm for real in one spec per package manager runner (#575) ([7568e6aa](https://github.com/extension-js/extension.js/commit/7568e6aa36eace2f8a4a4357323f0d3f301cef88))
- Repin the template catalog to the Firefox sidebar fix (#573) ([28fd62af](https://github.com/extension-js/extension.js/commit/28fd62afff941a6dca7f606edca820617babe6b6))
- Write ready.json stamps atomically and run smokes on the built CLI (#569) ([829c01a9](https://github.com/extension-js/extension.js/commit/829c01a9c057464f26dd1a2df066d418da513266))
- Cover the Vue runtime build and Edge key drop with real specs (#568) ([fe21ac68](https://github.com/extension-js/extension.js/commit/fe21ac6834f30ee3c2e5ea6f6e5e81ddc7c61d7e))
- Sharpen the worker, Safari and reconnect warnings and note Solid (#567) ([b18323df](https://github.com/extension-js/extension.js/commit/b18323df1f3d37ed6f849f179e1ec4a645000cab))
- Emit the dev reload background as scripts on Safari builds (#566) ([2871bc2f](https://github.com/extension-js/extension.js/commit/2871bc2fc1965debdea566244afea68c2ed9a5d9))
- Keep unused CSS module classes through minification (#565) ([95e19c45](https://github.com/extension-js/extension.js/commit/95e19c4580e7077862e1dbac5985c7aaabfcd89c))
- Write the 4.1.21 release highlights (#564) ([e35e77d5](https://github.com/extension-js/extension.js/commit/e35e77d5b406f76b75e43038cbf35b923e57a48a))
- Give runtime loaded modules their own import.meta.url (#563) ([ad583144](https://github.com/extension-js/extension.js/commit/ad5831447e73285af6631f0059595b5ddf8c30c2))
- Refuse a build whose resolved manifest lost its manifest_version (#562) ([b4d3c191](https://github.com/extension-js/extension.js/commit/b4d3c1913385c1fda0f3ec7487fd200403738fb5))
- Detect a pnpm workspace member from a zero indent packages list (#561) ([387d6ed6](https://github.com/extension-js/extension.js/commit/387d6ed68430381a2ef0d2724b55148a6dc89768))
- Keep the nightly green in author mode and report red nightly lanes (#560) ([ca4c32cd](https://github.com/extension-js/extension.js/commit/ca4c32cdb9c752fa5fbc4d5f91453bc3d98221fb))
- Keep the release deploy key out of every step that runs tree code (#559) ([fe0e5059](https://github.com/extension-js/extension.js/commit/fe0e5059440c6d1f9d3f13dfba2e8245bd98f4d5))
- Make pnpm format leave the tree lint-clean (#557) ([5fa7be0f](https://github.com/extension-js/extension.js/commit/5fa7be0f2fb5334df1200305c28e0b500d8df125))
- Keep waiting when the ready contract is read mid-write (#558) ([313c6f9e](https://github.com/extension-js/extension.js/commit/313c6f9e5756d8b796cd62dc1d06987f0ba439e8))
- Launch a real browser on Bun and Deno in the nightly (#556) ([19afbb0a](https://github.com/extension-js/extension.js/commit/19afbb0aa7d804d2a8a007f3d12190ed00d9a61f))
- Say when an AMO warning comes from a bundled dependency (#555) ([15b92774](https://github.com/extension-js/extension.js/commit/15b9277487cc3663c56b1588ed7ed280c2e37724))
- Make the content-reload smoke run the CLI it says it is testing (#554) ([b0cc4c6b](https://github.com/extension-js/extension.js/commit/b0cc4c6b904096b6af8018192eb5faf6a8ded479))
- Take Bun as a runtime from 1.2 and judge it on its own version (#553) ([8e54d2e5](https://github.com/extension-js/extension.js/commit/8e54d2e5a047f97db3bf0d973ef132b2f1510650))
- Warn about a missing permission only when it reaches the output (#552) ([f809fff7](https://github.com/extension-js/extension.js/commit/f809fff70484fd835bd64a9463022ff597694435))
- Ship one solid-js runtime and stop listing Solid as supported (#550) ([73829f5e](https://github.com/extension-js/extension.js/commit/73829f5ef2188eaf04f8e7ca7f652535f04c69f3))
- Warn when a content script starts a worker from an extension URL (#551) ([d8b4526d](https://github.com/extension-js/extension.js/commit/d8b4526da9a1fcf6a9c339e0a7f683407f0779ad))
- Widen the wait contract budgets on CI runners (#548) ([6166da3a](https://github.com/extension-js/extension.js/commit/6166da3a38f75334f67db1679702567aaa97e37a))
- Match dev web_accessible_resources to what the build emits (#547) ([27ff715c](https://github.com/extension-js/extension.js/commit/27ff715c7b411f2d148d967f75e19fc7103a545e))
- Say native file events are the default watch mode, not polling (#546) ([54ba9d5d](https://github.com/extension-js/extension.js/commit/54ba9d5d954794f1fdf9ad28d9188bf21d292cd2))
- Resync the bundled javascript template to the sidebar change (#545) ([a044bee3](https://github.com/extension-js/extension.js/commit/a044bee3e74247ef2ed020e5f6fb788013e7ca9e))
</details>

## 4.1.20 (September 16, 2026)

- **Deno**, `deno run -A npm:extension@latest` runs the CLI on Deno 2.5 and newer, with build and dev both covered by CI. See the [Deno guide](https://extension.js.org/docs/languages-and-frameworks/deno).

### Features

- Add the Deno highlight for the 4.1.20 release note (#544) ([9c2ee1ce](https://github.com/extension-js/extension.js/commit/9c2ee1cecb400cdbe9fe4e23ef8736c8f73f60d2))
- Support Deno as a runtime and fix the bare path import (#543) ([1e3bbbe3](https://github.com/extension-js/extension.js/commit/1e3bbbe3bd0e7362ed6ce6b88d5c575733d37f91))
- Add a scheduled check that the docs flag snapshot matches the CLI (#536) ([2c405c6b](https://github.com/extension-js/extension.js/commit/2c405c6b5444be85871f7bce616bcf2c45d1122f))

### Fixes

- Stop prescribing the Safari unsigned extensions toggle ([c3371d98](https://github.com/extension-js/extension.js/commit/c3371d984f2e33325b0561deb1bbd801325abec4))

<details>
<summary>Other changes (11)</summary>

- Exclude the bundled create template from Biome the way ESLint does ([4d1dc637](https://github.com/extension-js/extension.js/commit/4d1dc637f219379fcd953db7a182e8b544f8fd22))
- Resync the bundled javascript template and move the create pin ([2ae5c282](https://github.com/extension-js/extension.js/commit/2ae5c282d54413513685d35168c3895755a917fe))
- Drop the store key from production Edge builds and say why (#538) ([f870be58](https://github.com/extension-js/extension.js/commit/f870be580a7a156d424c5fefd7c96127c2c7ffcb))
- Report the real mode when a build finishes (#539) ([df109884](https://github.com/extension-js/extension.js/commit/df1098846b54ecec0491f90c7dbfae64cce5a9d3))
- Enforce the repo code style with ESLint next to Biome (#537) ([46dba5a9](https://github.com/extension-js/extension.js/commit/46dba5a96f51b2006042ac418e67a1c3b00b016b))
- Say which Safari converter warnings are keys we keep on purpose (#535) ([7599a78a](https://github.com/extension-js/extension.js/commit/7599a78ab88f6915e8f326d5c1e92861996c0bef))
- Warn when a Safari build calls a member Safari lacks (#534) ([e2f50cb6](https://github.com/extension-js/extension.js/commit/e2f50cb691826d7460af7910396b677c72d1b1ad))
- Make Safari sessions work end to end and fix two session defects (#533) ([508e2b89](https://github.com/extension-js/extension.js/commit/508e2b892de618832dee5879e44e6f7a3cd94a5b))
- Match README links to the docs navbar and drop the Scorecard badge (#532) ([7e43f803](https://github.com/extension-js/extension.js/commit/7e43f8038df922afdc8cca903bae115799850b77))
- Move TestMu AI to the Bronze sponsor placement (#531) ([5055ae24](https://github.com/extension-js/extension.js/commit/5055ae24601a3c53affdd8109afb215b5b8071f6))
- Show the OpenSSF Best Practices passing badge in the READMEs (#530) ([0fd24fea](https://github.com/extension-js/extension.js/commit/0fd24fea4d8b9644f0ea7f7fc9a90ae86dd36827))
</details>

## 4.1.19 (September 15, 2026)

### Features

- Bundle the Vue runtime build and drop the rspack global shim (#524) ([2289e502](https://github.com/extension-js/extension.js/commit/2289e50249b7cc9fda49629263b249b33bcf6b2a))
- Add a CODEOWNERS file naming the maintainer as owner (#521) ([797b2416](https://github.com/extension-js/extension.js/commit/797b2416e50b85609df3f985db703cc0d6abde92))
- Add one always-reporting CI passed check and run CI on every PR (#516) ([6e730661](https://github.com/extension-js/extension.js/commit/6e7306613b7ba74dd8ecaf61aa0b2b8d066e4337))
- Add property tests for the prefix resolver, path keys and MV2 host fold ([80335ba0](https://github.com/extension-js/extension.js/commit/80335ba00cc1c180466216714ed2a1e049b888fb))

### Fixes

- Harden browser installs, template URLs and the control socket (#528) ([b981dd0b](https://github.com/extension-js/extension.js/commit/b981dd0ba953538c28c3668e676d6693cf9abc71))

<details>
<summary>Other changes (15)</summary>

- Keep build paths out of import.meta.url in production bundles (#529) ([6a03e852](https://github.com/extension-js/extension.js/commit/6a03e8522dead341f522ece8d09afe9dd628f14b))
- Ship the chrome, node and polyfill types with extension (#527) ([d4e96a1d](https://github.com/extension-js/extension.js/commit/d4e96a1d158e7cbf91835a2c82ff4627b05abc4e))
- Document release verification, architecture and security (#525) ([0887a6f8](https://github.com/extension-js/extension.js/commit/0887a6f8f23d8ff13f78f1f9fc6749274479a75a))
- Make chrome: and edge: manifest prefixes vendor exact (#526) ([9dd8dbb1](https://github.com/extension-js/extension.js/commit/9dd8dbb1fe7f357827615cc1cd774ad2e407d206))
- Clear the companion AMO warnings in Firefox builds (#523) ([78e2c756](https://github.com/extension-js/extension.js/commit/78e2c756bd4b18bd2969e6a81724d1641d24d4a4))
- Pass optional deps matrix values to the smoke step through env (#520) ([22696758](https://github.com/extension-js/extension.js/commit/22696758c82a072dd2747077f6197ce76aeb84e3))
- Attest release tarballs with the commit-pinned GitHub action (#522) ([b722a348](https://github.com/extension-js/extension.js/commit/b722a348949d8bc63e29200935df68ea0936610c))
- Retry a failed template install once and show the pnpm error (#519) ([0d7dbdda](https://github.com/extension-js/extension.js/commit/0d7dbdda2eb6b85e528d144c1d0a7c1d18b8fae3))
- Push release commits with a deploy key that bypasses the ruleset (#517) ([00fd8f33](https://github.com/extension-js/extension.js/commit/00fd8f33dabd321dc0a3eaa2878cace75bb22645))
- Render the Scorecard badge in the project blue like the other badges ([2bf90156](https://github.com/extension-js/extension.js/commit/2bf9015642da5f630c44bd57226d872e9fcc4bc9))
- Mirror the contributing section on the published package README ([bf2dbd70](https://github.com/extension-js/extension.js/commit/bf2dbd7098f5591249bc33d0f52d3f567026f43b))
- Build the resolved manifest with own properties so a __proto__ key survives ([5ebf2301](https://github.com/extension-js/extension.js/commit/5ebf230163759058fd20dae80162db06d7ec7a37))
- Attach SLSA provenance and the npm tarballs to every GitHub release ([445627bf](https://github.com/extension-js/extension.js/commit/445627bfcd3bd57ee7db80b23053df4b26e51c50))
- State the security response window and point every entry at the guide ([aa50ae22](https://github.com/extension-js/extension.js/commit/aa50ae22cd5b57f7fa250fd1bb28a033d3d68ff8))
- Run CodeQL from a workflow so Scorecard's SAST check can see it ([4a0a5fec](https://github.com/extension-js/extension.js/commit/4a0a5fec154112d49739771d7c4659e85d954a6d))
</details>

## 4.1.18 (September 14, 2026)

<details>
<summary>Other changes (27)</summary>

- Move the release npm pin to 11.19.1, the patch for its bundled advisories ([1ba1b61a](https://github.com/extension-js/extension.js/commit/1ba1b61ad800861e37fb07fc6d306112b600ea1b))
- Install the release npm from a lockfile so its pin is hash-verified ([7162dcf9](https://github.com/extension-js/extension.js/commit/7162dcf9608f8b3cabb968a2e4e49b6456cb7023))
- Override addons-linter's image-size to the release that fixes the DoS ([61ace2de](https://github.com/extension-js/extension.js/commit/61ace2decb0cf21291b57d9640b96e64b364c2c4))
- Spawn package managers through cross-spawn instead of a Windows shell ([fa4c7620](https://github.com/extension-js/extension.js/commit/fa4c762045bc36673aeab0dfd7d6129c6520f472))
- Match the missing-script path on either separator in the assets spec ([96dcc6fa](https://github.com/extension-js/extension.js/commit/96dcc6fa3ff85cc65e23781831a14665b862c7d1))
- Credit a compiled sibling before warning that a root script is missing ([ec830321](https://github.com/extension-js/extension.js/commit/ec830321043c1eaff5fa9936ce39d9ebad0d2c82))
- Warn when a Firefox build bundles sidePanel or an MV2 chrome.action call ([06d02b7f](https://github.com/extension-js/extension.js/commit/06d02b7f6e6e32429181a63e1c14ba701b7f3657))
- Compile root-absolute script refs through the tracer's child compilation ([24e73eaf](https://github.com/extension-js/extension.js/commit/24e73eaf64bb8db0b1d50a0aff75e58e4513bfe1))
- Pin every workflow action to a commit and scope write tokens to jobs ([1f645c06](https://github.com/extension-js/extension.js/commit/1f645c06e85e9ea8a366f71352ebbad1d4df3496))
- Repin the template catalog to the special-folders lint fixes ([1e8f9ae4](https://github.com/extension-js/extension.js/commit/1e8f9ae4c1ce64eb73376adf5827e8389e68fc7e))
- Repin the template catalog so the scaffold builds clean for Firefox ([b9fef3de](https://github.com/extension-js/extension.js/commit/b9fef3dee148facef2fd313e53b03ed7779cc51b))
- Emit the MV2 content_security_policy as a string on Firefox builds ([b1cea36c](https://github.com/extension-js/extension.js/commit/b1cea36ccd308045c2f016968540029d109b56ff))
- Repin the template catalog so scaffolds carry ids and sized icons ([93b01937](https://github.com/extension-js/extension.js/commit/93b01937295cc5729350f47324c1c2f4e5e6b8cc))
- Normalize dist paths in the traced compile spec so Windows lists match ([c2e3e204](https://github.com/extension-js/extension.js/commit/c2e3e2040e10e2dc49a3eb6d30963ebd20507ddb))
- Compile the files the tracer copies instead of shipping raw source ([8bcb88a2](https://github.com/extension-js/extension.js/commit/8bcb88a2cc67bb9c1e419fbd30c6bcd820a3f1e0))
- Import content script chunks via chrome.runtime.getURL for AMO ([4bb32d3f](https://github.com/extension-js/extension.js/commit/4bb32d3ff8d677ddf684eea0eaeaed2afd54f785))
- Fold host permissions into permissions for a Firefox MV2 build ([ffe2b207](https://github.com/extension-js/extension.js/commit/ffe2b207bf4e5b1265cbddf0f8eac63447124b2c))
- Install a pnpm workspace member from its workspace root ([4dc269e7](https://github.com/extension-js/extension.js/commit/4dc269e72c48fefde44aecd03ef9a6139469376d))
- Keep go-git-it quiet and drop the fake PATH row when dev takes a URL ([04111b49](https://github.com/extension-js/extension.js/commit/04111b49ac225d8f05fc10e11dee170b010ed648))
- Show the Scorecard badge on the published package README too ([fdc45390](https://github.com/extension-js/extension.js/commit/fdc45390198a2fba02cbbcdde0158055c414be6a))
- Warn with addons-linter findings after a production Firefox build ([eae231e8](https://github.com/extension-js/extension.js/commit/eae231e812247b31b2994f6a46f873f51d2c399d))
- Run the rspack suite weekly against dependency prereleases ([894763b3](https://github.com/extension-js/extension.js/commit/894763b3c9acbde79d03cca2058c3e1177acbd92))
- Run the dev-reload slice weekly on the browser prerelease channels ([a358ab98](https://github.com/extension-js/extension.js/commit/a358ab981f232abc1ef4282960e526c272919244))
- Publish an OpenSSF Scorecard for the repo and show it in the README ([a6e445ac](https://github.com/extension-js/extension.js/commit/a6e445ace97b97c967791473bebb4b3ad1ed2518))
- Run the core and CLI suites on the Node floor and on Node 24 ([32176f84](https://github.com/extension-js/extension.js/commit/32176f84c7bb72b43f6665cda88cb0343da10d3d))
- Pin the managed Firefox install to the stable channel ([a0d066e0](https://github.com/extension-js/extension.js/commit/a0d066e0d117187361fdf6e5ef5562b43e77fb22))
- Describe the reload model accurately in the README ([441d2ba7](https://github.com/extension-js/extension.js/commit/441d2ba716c5a4f1917f465d88426a0a9a6c0f7d))
</details>

## 4.1.17 (September 12, 2026)

### Features

- Add a focused rspack test entry for ecosystem CI ([17ae2da2](https://github.com/extension-js/extension.js/commit/17ae2da26313d38b3d172566c624498fc9a10452))

### Fixes

- Stop the reload runtime from messaging the companion extension ([798c30b2](https://github.com/extension-js/extension.js/commit/798c30b24e93a23288cc0919d3c8d87c2b897514))
- Patch the emitted page from its current asset so env templating survives ([330815d5](https://github.com/extension-js/extension.js/commit/330815d5d11b31677199d9d2e5dd71ca04641d0c))
- Resolve prefixed keys in the script steps, drop the HMR loader re-read ([16f767e4](https://github.com/extension-js/extension.js/commit/16f767e46102ea6df74ec7165255392fe68ba279))
- Resolve prefixed keys in the wrapper loader and theme icon reader ([67e24db3](https://github.com/extension-js/extension.js/commit/67e24db334ddbb51a6a8b098b0005ec31f8110a5))
- Stop treating an MV2 background page as a runnable script entry ([f6236e13](https://github.com/extension-js/extension.js/commit/f6236e13467732d69aa08bacba750149f99a7eff))
- Resolve the sidebar panel through the shared output target helper ([c0e655c7](https://github.com/extension-js/extension.js/commit/c0e655c720e6fc4a236d2ce4316a929d45e9216c))
- Resolve browser-prefixed manifest keys in every consumer ([8c28dc84](https://github.com/extension-js/extension.js/commit/8c28dc84af595ef364b061b14994efe6c089f65d))
- Stop the test lane from hiding failures and racing itself ([384fe5ab](https://github.com/extension-js/extension.js/commit/384fe5ab441da79edfa22dbfd93246b2c209acc8))

<details>
<summary>Other changes (36)</summary>

- Trim the companion to its welcome page, blank new tab and first-run tabs ([ac80bbde](https://github.com/extension-js/extension.js/commit/ac80bbded7857d0394658195f5e5caa11f78dad2))
- Let Tailwind scan the logger panel so the devtools UI is styled ([1edcd0f8](https://github.com/extension-js/extension.js/commit/1edcd0f8fda7d7b5bab7dd30b2ea4b11104872ef))
- Serialize the CLI suite after its dependencies and lint past the mirror ([2f2ec106](https://github.com/extension-js/extension.js/commit/2f2ec106902c964b44378dd92a47495ecacaa74f))
- Note the process-assets ordering and keep spec scratch out of the tree ([3ea464ea](https://github.com/extension-js/extension.js/commit/3ea464eaf610ea6b193ba11dac7ff780bd48a381))
- Label a missing page by its resolved key, reword the script split note ([420f82a9](https://github.com/extension-js/extension.js/commit/420f82a9dce7bc9311f29ab192bdc8602b42ffb7))
- Drop the unreachable branch from the externally_connectable patch ([95c630c9](https://github.com/extension-js/extension.js/commit/95c630c94623f319b69d74c775c808cc1371ba95))
- Scan .mts and .cts sources and dedupe MAIN world host patterns in dev ([16e9428c](https://github.com/extension-js/extension.js/commit/16e9428c51ee4e06676099b993d58bbb165b8be6))
- Inject the replay shim into a background scripts bundle too ([2aafdcaf](https://github.com/extension-js/extension.js/commit/2aafdcafa468857c4b719e1ba123bf83f735cf72))
- List the page-context chunks of injected scripts as web accessible ([af752a63](https://github.com/extension-js/extension.js/commit/af752a634982dcc505767d35d22c179e5de8dda1))
- Say a telemetry session row marks the handoff, not a finished boot ([eeeef33b](https://github.com/extension-js/extension.js/commit/eeeef33bbf298a3845adb6b8b76d97174beec4cb))
- Refuse the Bun runtime whatever Node version it emulates ([2357d561](https://github.com/extension-js/extension.js/commit/2357d5610af892b5162c63723c83908d244df569))
- Stage a per-session companion copy so --no-open opens no tab anywhere ([3541f73f](https://github.com/extension-js/extension.js/commit/3541f73f33a79575e16e79f4d884107f92f2914f))
- Align the no-open help and the no-browser refusal across commands ([9c7dafed](https://github.com/extension-js/extension.js/commit/9c7dafed212c841ec0c34fdad6098e62e5227f1f))
- Exclude build output from the spec guard with a predicate on Node 22.12 ([efced6f8](https://github.com/extension-js/extension.js/commit/efced6f837d5fb1e218636cc17cf28fae292110d))
- Spawn package managers through a shell on Windows in every runner ([0be8d80d](https://github.com/extension-js/extension.js/commit/0be8d80d2bcdbf09fb4f66e96ea59e436193c0e6))
- Take the lexer's module verdict so export {} keeps its HMR guard ([b929f5df](https://github.com/extension-js/extension.js/commit/b929f5df3863039de7dc24d531156314603e0a49))
- Say when an undeclared host or tabs use really breaks the packaged build ([dabd9ed5](https://github.com/extension-js/extension.js/commit/dabd9ed5ab3859b04d1e69534ea3dd5b0963c2c3))
- Close only the session's own welcome page under --no-open, Edge too ([083e5bc2](https://github.com/extension-js/extension.js/commit/083e5bc26b45be8678d7ff5256662e1265794ecf))
- Build the options page from options_ui before the legacy key ([91d6cfea](https://github.com/extension-js/extension.js/commit/91d6cfeac6499177e58f39de741f19328540a179))
- Classify a user script as a script so its modules stay in its file ([8d189586](https://github.com/extension-js/extension.js/commit/8d18958636f94a429f6d287299846bea6aa7ebe0))
- Fail the suite when a spec file matches no include glob ([f71d10f9](https://github.com/extension-js/extension.js/commit/f71d10f9f505f5cf3069edc32921a8b9b6a51d93))
- Let excludeBrowserFlags cancel the tooling flags too ([45fabae5](https://github.com/extension-js/extension.js/commit/45fabae53f85de2abf00293187a1641744eea534))
- Keep a page under a user folder named hot from losing its chunk ([3a80ba40](https://github.com/extension-js/extension.js/commit/3a80ba400437b67c3c20d8f3ae4a74079d4c1f78))
- Print the pinned Firefox dry-run plan without probing the binary ([f54f24ac](https://github.com/extension-js/extension.js/commit/f54f24ac3a9613736fb8267508534fb42348fa2b))
- Close the tabs the session opens for itself when --no-open is set ([c91f5185](https://github.com/extension-js/extension.js/commit/c91f51851842d5aea484ff781af21c8f77c526be))
- Spawn the package manager through a shell on Windows ([f4971192](https://github.com/extension-js/extension.js/commit/f49711920ebc9aa812c007df637ebfb72042a340))
- Run the page-executing specs on every push and report a red lane ([cfd0b483](https://github.com/extension-js/extension.js/commit/cfd0b483d36886186522450516d8e4a4fda47e59))
- Keep hot update chunks out of the scripts a page loads ([4b48efd6](https://github.com/extension-js/extension.js/commit/4b48efd67cbad3d655278971be7aa53c6b0f2a3a))
- Make the end-to-end lane runnable outside CI ([22113914](https://github.com/extension-js/extension.js/commit/221139148f2d36d533cbb0e1d85e26214eb0be0a))
- Cover the dev server boot and React refresh with real compiles ([8ef83f0b](https://github.com/extension-js/extension.js/commit/8ef83f0be488590c27dfa0993f0b96877ed8c5de))
- Raise the rspack floor to the version rslib 1.0 needs ([b5ffce65](https://github.com/extension-js/extension.js/commit/b5ffce65cb9c89316182d1e47144aa09a17814ee))
- Take the dependabot majors and patch the js-yaml advisory ([fd611f56](https://github.com/extension-js/extension.js/commit/fd611f56ff6e6619b01260d764b645035809c844))
- Open no tab at all when --no-open is set, on every browser ([001e82f3](https://github.com/extension-js/extension.js/commit/001e82f31a9bf104bab6e7c1f45902e5821e8475))
- Warn when dev grants a host the manifest never declared ([ffa242b5](https://github.com/extension-js/extension.js/commit/ffa242b59dcb205cbca649e5980bcac02547ee82))
- Refuse --no-browser with --wait instead of waiting for nothing ([8fd44788](https://github.com/extension-js/extension.js/commit/8fd4478843a7cc659170120c88b9977d393563ae))
- Explain the Bun runtime refusal instead of blaming installed Node ([66c91352](https://github.com/extension-js/extension.js/commit/66c9135246e6cbc07a0ba87246725de67c8870c4))
</details>

## 4.1.16 (September 9, 2026)

<details>
<summary>Other changes (5)</summary>

- Build the em dash from its code point so the prose check passes ([1c0e033d](https://github.com/extension-js/extension.js/commit/1c0e033d62e668ff30e0b026b43593992b14fff0))
- Repin the template catalog so scaffolds carry the chrome types ([bcd57dda](https://github.com/extension-js/extension.js/commit/bcd57ddad875400debfaa4a11f5604ce099221a1))
- Warn on every permission the dev manifest injects, including tabs ([372c2d8c](https://github.com/extension-js/extension.js/commit/372c2d8c49e79ec6f1d17bd41307c7e6f276b505))
- Tell --no-open and --no-browser apart and accept both everywhere ([54668bb4](https://github.com/extension-js/extension.js/commit/54668bb432a2eb3bf88e05d7fb2b19336968e690))
- Report watch sessions and flush telemetry on every exit path ([ac033528](https://github.com/extension-js/extension.js/commit/ac033528477aff0a9130ea63addc968012b9b3c2))
</details>

## 4.1.15 (September 9, 2026)

<details>
<summary>Other changes (10)</summary>

- Match script tags in any case when a spec reads emitted HTML ([f82264cf](https://github.com/extension-js/extension.js/commit/f82264cf60a1d3576a66bf5b96f888fa1df52315))
- Report a failure code and the install offer outcome in telemetry ([d554d3ae](https://github.com/extension-js/extension.js/commit/d554d3ae7653332bbe854f3a7afc2e84d45722b0))
- Offer the managed browser download on a first run in a terminal ([c1935881](https://github.com/extension-js/extension.js/commit/c193588119693f277b654b5c35d972812e2ed8fa))
- Share page code through sibling chunks the emitted HTML loads ([6a4683a9](https://github.com/extension-js/extension.js/commit/6a4683a9ab08f34adc2919ae3095cac32128c0a3))
- Keep the traffic snapshot going when the token cannot read traffic ([492c424c](https://github.com/extension-js/extension.js/commit/492c424c1ea8c51088c303260aad7dd472c08ff7))
- Record npm and stars even when the traffic endpoints refuse the token ([1aa4feb5](https://github.com/extension-js/extension.js/commit/1aa4feb52d76be563559781dac8fa1b202d885c8))
- Snapshot GitHub and npm traffic weekly on the analytics branch ([f284ec5f](https://github.com/extension-js/extension.js/commit/f284ec5f2d09b4f23a1e36adcc95b6f6b6053964))
- Warn when a user cache group splits an entry into several files ([c10fecf8](https://github.com/extension-js/extension.js/commit/c10fecf8c9e0c8036eeb2336e6edaf6142e5f8cf))
- Warn when a runtime injection literal names a compiled source ([f9f518b7](https://github.com/extension-js/extension.js/commit/f9f518b747f7a4999a7e53d2dd7d5198f5067254))
- Keep a page stylesheet's public-owned root url() at the extension root ([a5527f49](https://github.com/extension-js/extension.js/commit/a5527f493fb6300a7d2011af429a45b94f7b4a3c))
</details>

## 4.1.14 (September 6, 2026)

### Fixes

- Stop the config lookup walking a remote URL before the clone ([0a5af645](https://github.com/extension-js/extension.js/commit/0a5af6452acd040cadb6a91ba01e406e08ffc4f4))

<details>
<summary>Other changes (5)</summary>

- Accept the dot segment Windows prefixes to a URL-shaped path ([4d773329](https://github.com/extension-js/extension.js/commit/4d7733297ccb3a680795c38bf3e9a06f15ba20bb))
- Recognize a URL-shaped path with backslashes in the walk-up guards ([30674e68](https://github.com/extension-js/extension.js/commit/30674e68ad95745de153b90721636023cfdc52e3))
- Cover the relative project path in the command config lookup spec ([dd187be4](https://github.com/extension-js/extension.js/commit/dd187be47692927ecebf42d60a0770da87beb95e))
- Alias the Preact JSX runtimes before the package directory ([e6b6368b](https://github.com/extension-js/extension.js/commit/e6b6368baeb23b18b799cb15af28d60f6ebcae25))
- Give the logs follower a wider attach window on CI runners ([bf4b7138](https://github.com/extension-js/extension.js/commit/bf4b7138fbdd01d297e7430025bcd270c6abeac8))
</details>

## 4.1.13 (September 5, 2026)

### Fixes

- Resolve manifest JSON resources from a public folder beside the manifest ([927dab32](https://github.com/extension-js/extension.js/commit/927dab327f3148686aac1ebe66ed86787c06bdb8))
- Resolve a re-pointed output folder the way the bundler does ([3e8be134](https://github.com/extension-js/extension.js/commit/3e8be13441d3aa1f6488b0a1682d27c40d2c2ee3))
- Resolve a session path the way dev anchors it in every reader command ([06792717](https://github.com/extension-js/extension.js/commit/0679271726e62d8d216d6f6e0147578874a6c7ea))
- Resolve the lockfile under the release-age rule Dependabot applies ([5ba8d4dd](https://github.com/extension-js/extension.js/commit/5ba8d4dd14051e4d084b4970272c65047bade2d0))

<details>
<summary>Other changes (61)</summary>

- Match emitted asset names with forward slashes in the WAR scan ([a31ce4cf](https://github.com/extension-js/extension.js/commit/a31ce4cfdddd812ae78d43abe83e36ffb00736fd))
- List the minimizer parity output with posix separators in the spec ([16ff5e6d](https://github.com/extension-js/extension.js/commit/16ff5e6d4f73b5ddd765ee039593430c422cdfda))
- Print public folder placement notes with forward slashes ([219bccf9](https://github.com/extension-js/extension.js/commit/219bccf93fd75e9981a5cdcc6bf25fa602e205da))
- Canonicalize the CSS issuer path before naming its url() targets ([71a5fc7b](https://github.com/extension-js/extension.js/commit/71a5fc7bb96062976fee851244143ecff15c3d78))
- Pin the create failure telemetry to the advertised starter rule ([ff579bd1](https://github.com/extension-js/extension.js/commit/ff579bd16cf9aaf15271de51a5339721596895a1))
- Ask a package manager for its version through a shell on Windows ([0eacf535](https://github.com/extension-js/extension.js/commit/0eacf5355edebff5f8382958268d9e43b6113034))
- Rewrite CSS module urls for content scripts and match sheets through symlinks ([f507a0e2](https://github.com/extension-js/extension.js/commit/f507a0e2363df6e87e5f4f34bc388ad465a2eb67))
- Name the copied public file when a plain JSON ref lives under public ([def4c462](https://github.com/extension-js/extension.js/commit/def4c4621df93b6fdec37b8b18982db4311b1abd))
- Point a content script stylesheet's url() targets at the extension ([f10167b6](https://github.com/extension-js/extension.js/commit/f10167b676f95bac8868095489e20b1de600b947))
- End a logs follow when the session it follows is gone ([a1d7f340](https://github.com/extension-js/extension.js/commit/a1d7f340bb77718b62ecf0ead763113c98a55d9a))
- Reload the extension when a file under the public folder changes in dev ([8e077f1a](https://github.com/extension-js/extension.js/commit/8e077f1ab0652580a146ae3acd9f28aa75410d06))
- Publish the asset module declares from a script file so they apply ([42d680ed](https://github.com/extension-js/extension.js/commit/42d680ed8402a91308181593986f24df21affd04))
- List the chunks a content script imports on demand in the production WAR ([6cad13a3](https://github.com/extension-js/extension.js/commit/6cad13a3b0d64e9ffaedf54dc36372bdde298ff2))
- Name a page's static assets by their path so two pages never collide ([a4d785f1](https://github.com/extension-js/extension.js/commit/a4d785f1fddbc247299bd35c8bf4b936a951a41b))
- Keep theme images and theme icons apart when they share a basename ([fbd7aa22](https://github.com/extension-js/extension.js/commit/fbd7aa22c34821cabb3d92ea701c25b4c1b5ee3f))
- Keep one action surface on a chromium MV2 manifest and say which ([7655781d](https://github.com/extension-js/extension.js/commit/7655781d039eac8a7b0580efd3e30c6089e971a5))
- Treat storage/managed_schema as critical JSON under either spelling ([dfb2d4e1](https://github.com/extension-js/extension.js/commit/dfb2d4e19b8a533b90f60363ccc63d8794e87ce1))
- Refuse a gesture-gated open surface up front and name a 4003 cause ([27b0e821](https://github.com/extension-js/extension.js/commit/27b0e821ae67927e3d1ee4f575a65cd3a3bf3d58))
- Replay programmatic script injections after a scripts folder edit ([d25b1304](https://github.com/extension-js/extension.js/commit/d25b13045fcf0fe0d60caaf149379a2ee0dc236a))
- Pin the css parity rubrics and the logs file round trip in specs ([32298e32](https://github.com/extension-js/extension.js/commit/32298e32bcdeee96e78cf1cfa830ca239cd9a4e1))
- Emit the asset and stylesheet module declares into extension-env.d.ts ([c3903dca](https://github.com/extension-js/extension.js/commit/c3903dca5f29edd26cfd6d902b9f0ab1269f2c24))
- Keep extension-create at the released version ([0f4d696b](https://github.com/extension-js/extension.js/commit/0f4d696b2446f4a550b740d94ab232c1499a5bce))
- Key dev instrumentation on the dev session, not the bundler mode ([fee89d50](https://github.com/extension-js/extension.js/commit/fee89d507a3323c09680d482a066ad90e66cb0ba))
- Keep a stylesheet the parser rejects on the same rules in production ([766f470e](https://github.com/extension-js/extension.js/commit/766f470e21641175368e5ae445dfcc1bfceb09f8))
- Narrow a log line once at the parse boundary ([0f2b756d](https://github.com/extension-js/extension.js/commit/0f2b756d18cf017a198c85f86de6daeaae9d156c))
- Warn when a PostCSS config exists but cannot be loaded ([bb701603](https://github.com/extension-js/extension.js/commit/bb7016033f88e73c22932de415321f3448807839))
- Say what the optional-deps resolver swallowed under verbose ([fd57b74c](https://github.com/extension-js/extension.js/commit/fd57b74cd97d64c0ec049f852bf19305b5ee7985))
- Emit dev source maps that point at the author's source lines ([97b2ae11](https://github.com/extension-js/extension.js/commit/97b2ae1116128b18829210135cf3354273a9d2bb))
- Honor an ISO --since in logs and name a missing locale file ([91109275](https://github.com/extension-js/extension.js/commit/911092756d46a80f21408d7d9cc1187e5d327eaf))
- Give a scaffold one package manager from declaration to install ([79a52519](https://github.com/extension-js/extension.js/commit/79a5251931775ed34a436e11db3b9a5556792826))
- Read a __MSG_ reference the same way in the build and the launch check ([c61c941f](https://github.com/extension-js/extension.js/commit/c61c941f2c54ff0e01325cc88268820fa8af4db5))
- Derive the messaging checker's surface from the files that print ([5801a500](https://github.com/extension-js/extension.js/commit/5801a500e11d7da6db752f8b71a23fb1fab90941))
- Send only an advertised starter name in create telemetry ([a94aa4f6](https://github.com/extension-js/extension.js/commit/a94aa4f6ae021d1cb9ae480a9a4f86f34f76d773))
- Default create to typescript with a bundled offline fallback ([68c46df8](https://github.com/extension-js/extension.js/commit/68c46df8488c091fc3376ede00cd8db673c5096c))
- Scaffold into an existing repository without taking it over ([6c39b166](https://github.com/extension-js/extension.js/commit/6c39b166ee9c05725e413101bc6bd6381e624bf6))
- Keep the author's security contract in a dev build and name what changes ([69e6c115](https://github.com/extension-js/extension.js/commit/69e6c115d6b78744649886fa2560c5651f2f7a66))
- Finish SWC setup before a one-shot development build starts ([3ff3811a](https://github.com/extension-js/extension.js/commit/3ff3811a43615da1f2d3cc98127bea35b3a4179d))
- Let a page accept its own hot update and clear the root it mounts on ([3bebdaf6](https://github.com/extension-js/extension.js/commit/3bebdaf622c527aeb6751f8eaa2a76762d7dc0a4))
- Honor the per-command browser in extension.config on every command ([e8714437](https://github.com/extension-js/extension.js/commit/e871443776896669e5bc6f505eabb86db05289ed))
- Describe the folder preview loaded in its run record ([31c10389](https://github.com/extension-js/extension.js/commit/31c10389d3880a4bd74e74110a22a32d2c0644fd))
- Tell a companion entry that is not a store link or a folder apart ([76c515af](https://github.com/extension-js/extension.js/commit/76c515af99c7e1f06e629925ad5343dff4b7ee4a))
- Load a browser-named companion folder only for that browser ([73d6e5cb](https://github.com/extension-js/extension.js/commit/73d6e5cb3477cc6a58ec12e244605ddfe466a605))
- Layer env files at config time and keep shell values on top ([ef8ee0b7](https://github.com/extension-js/extension.js/commit/ef8ee0b78235f81ef59d5a0b495c865383e9f1d6))
- Let a browser config section outrank a top-level default ([dd27e8f2](https://github.com/extension-js/extension.js/commit/dd27e8f2ceea02e4e2fbb1e1c2916750e6c5d369))
- Keep a page's base href for its links and its files for the build ([e7e1d626](https://github.com/extension-js/extension.js/commit/e7e1d626a30f930cd2534b3513791ece3744292b))
- Compile JSX pages for the framework a project installs ([c5f676c5](https://github.com/extension-js/extension.js/commit/c5f676c56ae40ac6b10e071e657e0ae9f1a7b970))
- Derive swc targets from the floor of the browser being built ([caffcfe3](https://github.com/extension-js/extension.js/commit/caffcfe39368811c59d3cf325a146fb28e51d3da))
- Ship the page_action popup as its own page beside the toolbar popup ([3d2a0d4f](https://github.com/extension-js/extension.js/commit/3d2a0d4f87a2646043286625c59414c7834f0c3d))
- Emit the Firefox theme stylesheet and settings files the manifest names ([32021db8](https://github.com/extension-js/extension.js/commit/32021db83d7f342d1db135eaa7391e36be7635e9))
- Give icons that leave the extension root a slot of their own in the output ([4c44cb9b](https://github.com/extension-js/extension.js/commit/4c44cb9b59d33cb80466137be2b873471e495266))
- Point every manifest resource at an emitted path and watch broken files ([9523c605](https://github.com/extension-js/extension.js/commit/9523c605d57fb52581b90b07e280709058703ab1))
- Ship a public folder beside the manifest and name the folder in use ([58690155](https://github.com/extension-js/extension.js/commit/586901554f5e0893a17c8c1798fe401458a0265b))
- Make every promised CLI flag behave on the commands that list it ([fcf6d784](https://github.com/extension-js/extension.js/commit/fcf6d784b9a534c8808e4fa3c47da5cc63ab59bb))
- Find extension.config beside the manifest when the package root has none ([e5793672](https://github.com/extension-js/extension.js/commit/e579367267478c92298586676e516af00a4f8cf0))
- Show the new-tab override page on Firefox launches via the manager add-on ([128bd891](https://github.com/extension-js/extension.js/commit/128bd8917a74b710b1ca7aeb9bd0b65269cb83fb))
- Print the real launch plan on --dry-run for chromium and firefox ([91a26a33](https://github.com/extension-js/extension.js/commit/91a26a331667518431ac7ffa53108a73a0dbb761))
- Restart the dev session when a manifest entrypoint is added mid-watch ([943b6061](https://github.com/extension-js/extension.js/commit/943b606120b6750e79cf359889d860b2669975ba))
- Survive stray RDP frames and fail Firefox requests fast on a dead socket ([bb0628d8](https://github.com/extension-js/extension.js/commit/bb0628d8ff6dcfa0769d47dfc209f8b1003c3735))
- Reload an extension page when its own HTML changes under HMR ([b709d874](https://github.com/extension-js/extension.js/commit/b709d874a494e87298f7991c27329da8deb7b3e3))
- Pin the patched dependency overrides to releases older than three days ([f992f7be](https://github.com/extension-js/extension.js/commit/f992f7be76c9bc3806bf8083c0fd9aeb7fe955ac))
- Let a publish resume after its tag and wait longer for npm ([0d825879](https://github.com/extension-js/extension.js/commit/0d825879287ec295be74eb201674524a7abb38b4))
</details>

## 4.1.12 (September 4, 2026)

<details>
<summary>Other changes (4)</summary>

- Keep the develop message surface and the bundled template as pinned ([7a605a3f](https://github.com/extension-js/extension.js/commit/7a605a3fa8e3536675de64a72e9ac57f300333d8))
- Bump browserslist to its patched release ([7a8295ab](https://github.com/extension-js/extension.js/commit/7a8295abd12eb9fb614c67b7b755ea0ccfb50465))
- Bump fast-uri and postcss-selector-parser to their patched releases ([9587abe6](https://github.com/extension-js/extension.js/commit/9587abe6d46f03db08136913748f79680b052870))
- Read publish and share doc links from the environment ([fad644cd](https://github.com/extension-js/extension.js/commit/fad644cd26e9df00dcd10eaa2528b769981ae526))
</details>

## 4.1.11 (August 31, 2026)

### Fixes

- Resolve a renamed template's alias in every consumer, not just the fetch ([33ffe509](https://github.com/extension-js/extension.js/commit/33ffe5090027b17fa3cda443f38e6c5958ce97f9))

<details>
<summary>Other changes (5)</summary>

- Take the manifest-fields release resolving prefixed keys by precedence ([3147a5c8](https://github.com/extension-js/extension.js/commit/3147a5c8cb15be1385453f986f05077f079322bd))
- Keep a getURL-bound dynamic import native in every binding shape ([7892f7ff](https://github.com/extension-js/extension.js/commit/7892f7ffbafbe994bfd4ebd6395a9fac36e93ba0))
- Emit public-hosted JSON manifest resources at their manifest paths ([3f5b2d74](https://github.com/extension-js/extension.js/commit/3f5b2d7434163b0d46eca538a7f6ef2e83d221fd))
- Rewrite a page reference into the attribute it came from ([107c1abe](https://github.com/extension-js/extension.js/commit/107c1abe801ed40dcc7b01417717145af29ce4cf))
- Hold a failed compile's changed files until a build consumes them ([9c49713f](https://github.com/extension-js/extension.js/commit/9c49713fc084c8e53bb32da2b6e6efe2d3cb5401))
</details>

## 4.1.10 (August 29, 2026)

### Features

- Enable HMR on extension HTML pages and scrub stale hot=false guards ([7e42d087](https://github.com/extension-js/extension.js/commit/7e42d0878f471117096802bae6acc86da163b949))

### Fixes

- Resolve the background worker entry against entries that exist ([d0d718b7](https://github.com/extension-js/extension.js/commit/d0d718b764b062ab527e06a67c4aa020737d6708))

<details>
<summary>Other changes (4)</summary>

- Honor extension.config.js commands.dev.browser when no flag is given ([c04cdf77](https://github.com/extension-js/extension.js/commit/c04cdf77c0fc8b67c84eef09a8971e28cf6e0753))
- Reopen the panel from the badge and add a settings gear button ([16b58d89](https://github.com/extension-js/extension.js/commit/16b58d894b950c8c09b5c16b4268614f01ea6f56))
- Route the overlay badge to an options page with an on-off toggle ([04d4acb2](https://github.com/extension-js/extension.js/commit/04d4acb284abf9be6a175f801bd70c0417b437c6))
- Probe only emitted stylesheets from the content script wrapper ([75618013](https://github.com/extension-js/extension.js/commit/75618013b9e7bb14f779d08457abad665c17b201))
</details>

## 4.1.9 (August 28, 2026)

<details>
<summary>Other changes (3)</summary>

- Move the template corpus pin past the permission trims ([3233de4d](https://github.com/extension-js/extension.js/commit/3233de4dfda6d9d9e20553b1ce3adf42f7b88070))
- Report pin age and refuse a pin that has left the corpus branch ([3ca0e4d9](https://github.com/extension-js/extension.js/commit/3ca0e4d9cc0af7f67f4b8f9608b909dd41298fed))
- Group the devtools templates under a DevTools panel heading ([0a162f8f](https://github.com/extension-js/extension.js/commit/0a162f8f61766bb66c0943748a46467f80e4a73a))
</details>

## 4.1.8 (August 27, 2026)

<details>
<summary>Other changes (3)</summary>

- Resync the bundled javascript template with the examples source of truth ([94b842be](https://github.com/extension-js/extension.js/commit/94b842beb784c3c9c4a70d9b97548b3ab70b5c70))
- Take the manifest-fields release that keeps nested scripts paths apart ([8dad4c92](https://github.com/extension-js/extension.js/commit/8dad4c926fd44203a79c31a177a429628805d201))
- Move the template corpus pin to the commit with the devtools templates ([15b84abb](https://github.com/extension-js/extension.js/commit/15b84abba54cfe47092aad602cb423b511a6df21))
</details>

## 4.1.7 (August 27, 2026)

<details>
<summary>Other changes (1)</summary>

- Load content-script chunks the isolated world can reach in builds ([cfe6d25d](https://github.com/extension-js/extension.js/commit/cfe6d25d1b4287f07bffa0127bbf9b7402b50343))
</details>

## 4.1.6 (August 27, 2026)

<details>
<summary>Other changes (11)</summary>

- Give the overlay launcher a concentric squircle badge ([a62eba19](https://github.com/extension-js/extension.js/commit/a62eba196d9780e8aadd774324aad4079c7900df))
- Always render the devtools overlay, dropping its env gate ([d115b6cf](https://github.com/extension-js/extension.js/commit/d115b6cff0f0146f513a03666c936bcdd95f5cec))
- Print stylesheet paths as web paths, not with the host separator ([3c0013dc](https://github.com/extension-js/extension.js/commit/3c0013dcfebeeaba644c0976b12884f0c118a404))
- Drop the create alias mocks the CLI no longer imports ([a65bd4ac](https://github.com/extension-js/extension.js/commit/a65bd4acae5a7c7feea270ece89203e167717637))
- Find the tsconfig we scaffolded in a project with no package.json ([be20fd0a](https://github.com/extension-js/extension.js/commit/be20fd0a7d5ac8449921e13cd68620fb5fe54780))
- Parse-check every emitted script, and name a cross-file redeclaration ([f14d992f](https://github.com/extension-js/extension.js/commit/f14d992f5d7518ab6a9d6a63eb7c94ddbb537d9b))
- Reference-check url() in content-script stylesheets too ([e6b4e150](https://github.com/extension-js/extension.js/commit/e6b4e150fb512442067c7fba1b165bec2555fc7a))
- Skip the gitignore append when git already ignores the path ([4fbbff7d](https://github.com/extension-js/extension.js/commit/4fbbff7dd9a2152ef130e7f202c9888900c11009))
- Keep compiled scripts/ entries referenced by their emitted .js path ([549d8433](https://github.com/extension-js/extension.js/commit/549d8433da1ae7e29a758fe777eae4363873b6d3))
- Drop the confirm setup dialog and the icon dock from the welcome page ([06c5240e](https://github.com/extension-js/extension.js/commit/06c5240ea81d98ff1a62acf89b7810375eb413ca))
- Say what opens a gesture-gated surface, and stop misblaming a flag ([c9d9e3e7](https://github.com/extension-js/extension.js/commit/c9d9e3e7dadc6ce2776bc9c5ba69d9a379ee60cb))
</details>

## 4.1.5 (August 22, 2026)

<details>
<summary>Other changes (2)</summary>

- Keep the alias listing out of the CLI startup path ([c52d51fb](https://github.com/extension-js/extension.js/commit/c52d51fb03e5787fc03c0cdf13178d494684e1c8))
- Rename new templates to newtab and alias the old names ([f68749a2](https://github.com/extension-js/extension.js/commit/f68749a2100749cc48e84d1abdd0f1f2bae4b109))
</details>

## 4.1.4 (August 22, 2026)

<details>
<summary>Other changes (1)</summary>

- Honor the documented output contracts for dev, env files, and format ([0007bdb5](https://github.com/extension-js/extension.js/commit/0007bdb55667a7bb505c7499d7cd88620526cb1f))
</details>

## 4.1.3 (August 21, 2026)

<details>
<summary>Other changes (4)</summary>

- Show stars on npm only and repair the downloads strip ([7cb4a557](https://github.com/extension-js/extension.js/commit/7cb4a557d22de1c1d7e129617f6b05b2a911083b))
- Group the nx template and refresh the ai-help snapshot ([f0e562ac](https://github.com/extension-js/extension.js/commit/f0e562ac8c0c6eab512a309d72731914ebb3d119))
- Shrink the browser support labels with sup ([b155f390](https://github.com/extension-js/extension.js/commit/b155f390d2c039e36d2e59f2522eed7b0f582766))
- Move the template corpus past the frozen August pin ([510fbb18](https://github.com/extension-js/extension.js/commit/510fbb187f7dacd73447ec029ca684cd3c4267e8))
</details>

## 4.1.2 (August 21, 2026)

### Fixes

- Stop the README clips promising more than they show ([2295023b](https://github.com/extension-js/extension.js/commit/2295023b8ab640248d7c30f87f3e492060fcaa98))

<details>
<summary>Other changes (4)</summary>

- Drop em dashes CI rejects from two Safari comments ([1994dddb](https://github.com/extension-js/extension.js/commit/1994dddbdfceeb5d8bd31bb2afd46a6ddf881846))
- Scope launch facts to the run that produced them ([fdb838ba](https://github.com/extension-js/extension.js/commit/fdb838ba30de35ef170907d5d83272c3fa6a4b37))
- Sign Safari builds with --development-team and adapt the hints ([4d037894](https://github.com/extension-js/extension.js/commit/4d03789464b9f39bc22e28365bf28542e64c446f))
- Publish the Safari browser pid and keep binary facts on recompile ([e4e0bc83](https://github.com/extension-js/extension.js/commit/e4e0bc8305e06a1af4eb9ebabe4756df23c36902))
</details>

## 4.1.1 (August 20, 2026)

<details>
<summary>Other changes (3)</summary>

- Name the browser binary and how it was chosen in doctor output ([23c615df](https://github.com/extension-js/extension.js/commit/23c615df3304f0fb81779f858f3c4c969228ea0c))
- Drop binary provenance from the card and record it in ready.json ([09066b51](https://github.com/extension-js/extension.js/commit/09066b512dce331d3a4a9382174dc2dee259de26))
- Show the binary row only for a pinned browser path ([3a3f275d](https://github.com/extension-js/extension.js/commit/3a3f275d2eb1349b6b5f8c01f80fb495d94b8465))
</details>

## 4.1.0 (August 20, 2026)

<details>
<summary>Other changes (2)</summary>

- Cap the CLI card at three rows and print the name uncolored ([d3c63c30](https://github.com/extension-js/extension.js/commit/d3c63c30ca1151651c1e92d8818c13d33373f0f8))
- Show the demo clips as CDN-hosted GIFs so npm renders them too ([1abbe1f8](https://github.com/extension-js/extension.js/commit/1abbe1f89d2434ae4f463e4c57f793ecce97b0da))
</details>

## 4.0.35 (August 19, 2026)

### Features

- Add BACKERS.md and point the sponsor link at the live listing ([32adbd49](https://github.com/extension-js/extension.js/commit/32adbd49e51b7267656eb2c92ce1c5d7838be2fe))

<details>
<summary>Other changes (9)</summary>

- Escape all regex metacharacters when matching a getURL identifier ([24448fc7](https://github.com/extension-js/extension.js/commit/24448fc77af9d9fe44ab176172f2bfd8c30dde85))
- Print the late @import warning path with forward slashes on Windows ([3c14912b](https://github.com/extension-js/extension.js/commit/3c14912b99362a5dc970a385799d443f7e0c6edc))
- Keep import() native when its URL variable is bound from runtime.getURL ([d41480bd](https://github.com/extension-js/extension.js/commit/d41480bd997c3ffdedfc09213dcb9851164de00f))
- Skip a late CSS @import with a warning instead of failing the build ([d0415141](https://github.com/extension-js/extension.js/commit/d0415141a9ee2a88f0d1eb1dd6e3145c4c26c860))
- Credit Mintlify for docs hosting in the README sponsors section ([82219cb7](https://github.com/extension-js/extension.js/commit/82219cb7ac449567761712f34efa13ac2f08b441))
- Say when preview falls back to the source manifest directory ([6506e945](https://github.com/extension-js/extension.js/commit/6506e945f0cd8538dbffe33395db8561fb28531c))
- Drop the yarn --cwd flag Berry rejects from optional dep installs ([a626b6da](https://github.com/extension-js/extension.js/commit/a626b6da156aa60abf9436e1e5ac105a09058681))
- Let user static-asset rules win per extension, add the fonts threshold ([3de49452](https://github.com/extension-js/extension.js/commit/3de4945262eeaa5f5741f08f767a7b296ac77bb3))
- Update sponsors ([689ed57a](https://github.com/extension-js/extension.js/commit/689ed57a298c883ef8f73fbb3018be80cd15cd20))
</details>

## 4.0.34 (August 18, 2026)

<details>
<summary>Other changes (4)</summary>

- Pin the create source tag to both the flag and the argv it rides ([e912bd42](https://github.com/extension-js/extension.js/commit/e912bd42078ce059f5242e8a5176847202f3c8ac))
- Make the telemetry flush timeout injectable and pin it under test ([517a17c7](https://github.com/extension-js/extension.js/commit/517a17c7bc7cad797133165672664c0374e7b031))
- Copy page-referenced libs through even when content scripts declare them ([f057d6ba](https://github.com/extension-js/extension.js/commit/f057d6ba897f2b6b3e7d89ccd6e1e127158e640e))
- Give MV3 background.scripts the worker chunk loader on chromium ([5a3be923](https://github.com/extension-js/extension.js/commit/5a3be923508183561b931887c08386fc023eec16))
</details>

## 4.0.33 (August 17, 2026)

<details>
<summary>Other changes (22)</summary>

- Consolidate all zip create and extract paths on fflate ([afc178ad](https://github.com/extension-js/extension.js/commit/afc178ad122c0d3dddbd0f7f2a757b595c089875))
- Bump extension-from-store to 0.2.5, drops vulnerable extract-zip ([0d0b3258](https://github.com/extension-js/extension.js/commit/0d0b32588b202230d2a90c0d9dc36f877ae490e6))
- Skip script-binary pin specs on Windows, fix outputPath assert ([d203734a](https://github.com/extension-js/extension.js/commit/d203734a872fb4b450d9ea5df307a13572c271e4))
- Merge the browser config layer into build like dev already does ([34502d10](https://github.com/extension-js/extension.js/commit/34502d1042593f8966ae739e950cd2742a8a8cf4))
- Scan browser subfolders for any companion extensions dir ([83a186d6](https://github.com/extension-js/extension.js/commit/83a186d6a244143549b151e73fe73c84c3f7b7f6))
- Match the macOS Edge app-bundle binary name in the deep scan ([e4cca5d7](https://github.com/extension-js/extension.js/commit/e4cca5d7b9ce70eb4950a97bc181b0dd1982a229))
- Unify excludeBrowserFlags semantics and cover the user flag layer ([aecf5554](https://github.com/extension-js/extension.js/commit/aecf55548c8a7554f60d9b9a47f8686ac3c49ef7))
- Match swc rule paths through symlinked roots, realpath both forms ([5ddba9df](https://github.com/extension-js/extension.js/commit/5ddba9df43bd8ab79d81a8c0be1fad4e4a37b9c8))
- Anchor the tsconfig scaffold at the package root and widen detection ([5ed9be17](https://github.com/extension-js/extension.js/commit/5ed9be17386a0218c97176e1270f1234520c6b30))
- Ship HTML pages referenced via chrome.devtools.panels.create ([3704476b](https://github.com/extension-js/extension.js/commit/3704476bbac2fe1a860dc008d260fab3552b79de))
- Scaffold the default tsconfig for TS sources instead of refusing ([184de197](https://github.com/extension-js/extension.js/commit/184de197a0a308515fc8d209ea9bdeea55ed1251))
- Collapse casing-mismatch refusals to one line, stack in author mode ([14e99c18](https://github.com/extension-js/extension.js/commit/14e99c18fa1ea5c927682382fc65d817d3894134))
- Refuse public/manifest.json alone, without the copy conflict noise ([d8129549](https://github.com/extension-js/extension.js/commit/d8129549243d01eb9f7ac5438c013d133ee1e74a))
- Order managed browser builds numerically so reinstalls win ([aa24c81c](https://github.com/extension-js/extension.js/commit/aa24c81c3c461be99232f9f17d470f322a9e6992))
- Honor --chromium-binary on every chromium target with honest identity ([87080e30](https://github.com/extension-js/extension.js/commit/87080e30a6370c1b4d2061ab482ed90f7a37683e))
- Preserve the start run receipt across build and preview phases ([e6f3311f](https://github.com/extension-js/extension.js/commit/e6f3311f33d4e2bf3bdf36cfe88addf1994ab586))
- Make content-script runtime assets reach web_accessible_resources ([f430230e](https://github.com/extension-js/extension.js/commit/f430230e9bd8f76a41bf911fb704fd927cd7413d))
- Use Reflect.deleteProperty for the env scrub to satisfy dts build ([eb576413](https://github.com/extension-js/extension.js/commit/eb576413ba2bc38942b2b9a2fae1a35afce4f378))
- Scrub author-mode envs in both vitest setups for exact output ([ce9217df](https://github.com/extension-js/extension.js/commit/ce9217dfa5f4902d7169417e54ac22f4e4531a59))
- Build the bundled extensions for chromium in push CI ([5a28cc7f](https://github.com/extension-js/extension.js/commit/5a28cc7fa093f1ec82dca9ecf0ed511ec5335e71))
- Unify the install vendor taxonomy across CLI and installer ([96a7ff8d](https://github.com/extension-js/extension.js/commit/96a7ff8d01d70ffafd3bb5a310c918f5074f7a64))
- Merge deno.jsonc per key and restore install recovery for deno-primary ([5487bd32](https://github.com/extension-js/extension.js/commit/5487bd32d4940103059d993b0e8514de8eb8ab6c))
</details>

## 4.0.32 (August 8, 2026)

### Features

- Expose forced env vars to template substitution too ([35e1cdb3](https://github.com/extension-js/extension.js/commit/35e1cdb3bb77c7d1022ceafa132e4098bb9d0ffd))
- Inspect every modified page in the watch batch with fresh bytes ([489c4898](https://github.com/extension-js/extension.js/commit/489c4898cbbbf5b298788814f575a305d5439576))

### Fixes

- Guard the DNR override against dynamic-only manifests ([79ced738](https://github.com/extension-js/extension.js/commit/79ced738a4aa90ae0ed0d862a2b303785a5203bd))

<details>
<summary>Other changes (15)</summary>

- Raise the js-yaml floor past its advisories ([a5060973](https://github.com/extension-js/extension.js/commit/a5060973e2d20d3191d06bed0d46ba3561e93278))
- Hold react-table majors in dependabot until the v9 migration ([e4f848a2](https://github.com/extension-js/extension.js/commit/e4f848a2299fe887d1a7deaa88ce55c5eb89c0da))
- Revert the react-table 9 bump until the log-table is migrated ([0539cf5e](https://github.com/extension-js/extension.js/commit/0539cf5ec6e85b5fcbd128d70925f503028e576c))
- Use a comma in the legacy-path warning to pass the messaging gate ([7b9b0bd9](https://github.com/extension-js/extension.js/commit/7b9b0bd967b9abea5ea934b718cfc20198d6f85a))
- Scrub the author-mode alias in the default-verbosity retry spec ([24b8b4cb](https://github.com/extension-js/extension.js/commit/24b8b4cbb9bbf424e92d8698291045cd2dcebae3))
- Drop em dashes from watch-batch comments to pass the prose gate ([7fd4ff8f](https://github.com/extension-js/extension.js/commit/7fd4ff8f192a1fc68ef10d22f07db756a648a056))
- Warn on stderr when logs --signals-only has no emitter to match ([d314572f](https://github.com/extension-js/extension.js/commit/d314572f60be78021e85c2b31137d26907180e7b))
- True up browser-family docs and pin webkit-fork behavior ([9758f9b4](https://github.com/extension-js/extension.js/commit/9758f9b45b22498002edba921583499021e8eacb))
- Skip the polyfill for the webkit family ([f411fbc2](https://github.com/extension-js/extension.js/commit/f411fbc26f497ce6f258746f50d39696d5326804))
- Adopt the safari product block for webkit-based runs ([37978ac7](https://github.com/extension-js/extension.js/commit/37978ac7bd288e9a45c034c7d697f5bcbde3e9ff))
- Print a repeated fatal-shape repair once per dev session ([1cd202b3](https://github.com/extension-js/extension.js/commit/1cd202b301e6377a465f44022aeb90c904449532))
- Warn on legacy manifest paths from the author source, per field ([f0aeb2f3](https://github.com/extension-js/extension.js/commit/f0aeb2f3633284a56371b1b1b80bd2b27984dba9))
- Give telemetry a budget that covers a cold TLS handshake ([9c2ab836](https://github.com/extension-js/extension.js/commit/9c2ab8360739d5cd71fa2b8c7469250e25bb9142))
- Derive the create template list from the corpus commit it downloads ([7776859f](https://github.com/extension-js/extension.js/commit/7776859ff4e11da8207e56f41c7635a70c1c576b))
- Force color off in test suites, monochrome is the assertion contract ([123d4a45](https://github.com/extension-js/extension.js/commit/123d4a45d97685bd220e95fee358f7ca9925a357))
</details>

## 4.0.30 (August 4, 2026)

<details>
<summary>Other changes (3)</summary>

- Refuse consent and identity that arrived with a git clone ([9633df96](https://github.com/extension-js/extension.js/commit/9633df964dab829180df9969b76edb88344a4687))
- Let the MAIN world resolve assets through the bridge base ([fecf687b](https://github.com/extension-js/extension.js/commit/fecf687b7b374ddf5d997b30b8da18788ee64bcc))
- Follow the examples rename to sidebar-monorepo-turborepo in the catalog ([ccaef7ad](https://github.com/extension-js/extension.js/commit/ccaef7ad12ea789167f480b924811340ca1a0ca9))
</details>

## 4.0.29 (August 4, 2026)

- No changes listed.

## 4.0.28 (August 3, 2026)

### Fixes

- Guard load-checked HTML entry points in the persist gate ([583ccf43](https://github.com/extension-js/extension.js/commit/583ccf43e384059705892c3e872b6222161ba7e9))
- Harden the built-in theme contrast and per-engine key parity ([111c2a7e](https://github.com/extension-js/extension.js/commit/111c2a7e94228bc5dbaffa6c7f02b27d5257ca7e))
- Fix extension-js-devtools typecheck under TypeScript 7 ([e075f4d5](https://github.com/extension-js/extension.js/commit/e075f4d547ed689a6326c9396bf11c77950f99a0))

<details>
<summary>Other changes (13)</summary>

- Drop the stale templates/wasm ignore rule ([635e4aff](https://github.com/extension-js/extension.js/commit/635e4affb5acb82af70c62b986e3a176dcc9d4cb))
- Redirect guarded manifest writes to the platform null device ([f10b44d9](https://github.com/extension-js/extension.js/commit/f10b44d9688efaf94097e74cd3ce231f86f85880))
- Pin the default template corpus to a commit instead of tracking main ([3d831ae6](https://github.com/extension-js/extension.js/commit/3d831ae6ba15f05afc68dbc65988a8a5d93ab4ba))
- Convert hex theme colors for chromium builds instead of refusing ([3424bd2e](https://github.com/extension-js/extension.js/commit/3424bd2e527722e32daa316e4069766f31fa69b5))
- Keep the catalog screenshot out of every scaffold and its store zip ([ee2e9f9b](https://github.com/extension-js/extension.js/commit/ee2e9f9bc101a668b2d70a7d7a8e7008738ae228))
- Make --allow-eval self-sufficient and name it in eval refusals ([490285af](https://github.com/extension-js/extension.js/commit/490285af2a1489a5b29d8942825e9d9580a49d86))
- Refuse a publish that would share a project you are not in ([5b7a971a](https://github.com/extension-js/extension.js/commit/5b7a971a2d0c10c06304761151d832dacfa0e467))
- Drop the template author from scaffolds instead of inheriting it ([d79a49d9](https://github.com/extension-js/extension.js/commit/d79a49d91ecbe171c1e633aaaedf8a3616a836ab))
- Remove type casts left by the manifest-shape and flags campaigns ([3390fd9a](https://github.com/extension-js/extension.js/commit/3390fd9abf86bc301889b075680ef90f4143511d))
- Scope the manifest write guard per server and spare read opens ([de3db36b](https://github.com/extension-js/extension.js/commit/de3db36bcb1ed2dd09f87b20f59e9e40d926808b))
- Compare theme_icons by value so identical manifests never diff ([12244e85](https://github.com/extension-js/extension.js/commit/12244e85dfcd24485e6daccd8e961042426ee4bb))
- Declare gecko data_collection_permissions in the built-in extensions ([52497d46](https://github.com/extension-js/extension.js/commit/52497d46b5d20806a934ef6cb7b7125b8b618f75))
- Print the build receipt against the merged output.path ([d0e3c9b6](https://github.com/extension-js/extension.js/commit/d0e3c9b62e7c162c325217679d2b28101fd6cefc))
</details>

## 4.0.27 (August 2, 2026)

### Fixes

- Fix boring line dist classification, name fallback and warn arming ([1805ba79](https://github.com/extension-js/extension.js/commit/1805ba79a14eff10d85d4214a20a26ed35483901))
- Gate held share-hint strings in the extension-develop publish ([77ccc445](https://github.com/extension-js/extension.js/commit/77ccc445a28e8f3cf27d4e5ef6a4e408706e6722))

<details>
<summary>Other changes (42)</summary>

- Let a stale producer re-resolve the live control port from disk ([da701002](https://github.com/extension-js/extension.js/commit/da701002b2698a6bc210f4e351b202d155010a9b))
- Capture listener events on both the chrome and browser namespaces ([2a9809db](https://github.com/extension-js/extension.js/commit/2a9809db5e80dc16e5e180a7eed2d599c6cd90eb))
- Derive uninstall --all paths from installTargets instead of a literal ([54440409](https://github.com/extension-js/extension.js/commit/54440409c81e4acfbe371f963bcc20375086f6db))
- Keep the user extension last when a companion names the same path ([3fac8983](https://github.com/extension-js/extension.js/commit/3fac89830022b72a24ee0c7495b83040c6facefe))
- Type the perfBudgets config read and add it to the public config ([d0ff4a10](https://github.com/extension-js/extension.js/commit/d0ff4a107f47bc6412f761b8132db51f703e01e2))
- Let unset CLI flags fall through to extension.config.js commands ([ef9070e9](https://github.com/extension-js/extension.js/commit/ef9070e91cba630e9bdfcb9e3cf254ebb7a06d61))
- Treat a profile of false or the string false as the system profile ([97d7a123](https://github.com/extension-js/extension.js/commit/97d7a123ed21b5eab33ff4d377a6feca436e55d9))
- Validate DNR rules per rule and fail builds with index and reason ([6f0c5991](https://github.com/extension-js/extension.js/commit/6f0c599155b3429736c11bac390c5f62334c2d9c))
- Capture nested assets paths in the web resources fallback scans ([45e6dc23](https://github.com/extension-js/extension.js/commit/45e6dc2316e0ccb73aa4de673db0c7178edae956))
- Trim the HTML asset cache key, add eviction, throw on deleted HTML ([1ffb7250](https://github.com/extension-js/extension.js/commit/1ffb725002e67efe8675abb22b4fd39fd90a07c0))
- Emit the ?url rule after typed asset rules and fix custom rule checks ([e8973b0f](https://github.com/extension-js/extension.js/commit/e8973b0f60de95fde85462b4f3baf297f2dc5d9a))
- Accept safari identity options in commands.dev and commands.build ([6b781112](https://github.com/extension-js/extension.js/commit/6b781112839070dc763e0caca06e461fc70bcacb))
- Map safari to its own devtools engine and wire the safari binary ([0238a77c](https://github.com/extension-js/extension.js/commit/0238a77c0c5782f8da9907bc0e4c29a919bdf4c4))
- Exempt webkit targets from the chrome WAR match-pattern contract ([8e8d48e4](https://github.com/extension-js/extension.js/commit/8e8d48e432d4af8de0a9d25131f8a0d7fa1aa510))
- Warn when a themed manifest targets safari instead of skipping silently ([38b535b4](https://github.com/extension-js/extension.js/commit/38b535b4a8c665f274ed8fb186434606fa0ff580))
- Give safari ready.json the appex id instead of a chromium hash ([7d3048fe](https://github.com/extension-js/extension.js/commit/7d3048fe815cb6cf43bac29bcc43003fc7ada971))
- Run pnpm optional-dep installs silent to match project installs ([b95f86b1](https://github.com/extension-js/extension.js/commit/b95f86b17b3a28dfa8ef17560d768538cba3c12b))
- Warn when a malformed package.json blanks integration detection ([c37f22d5](https://github.com/extension-js/extension.js/commit/c37f22d5e2267fc9a06dea693fbf33b2158d4463))
- Align Deno scaffolds: deno.lock strip, primary merge, deno.json wins ([27a7fc0f](https://github.com/extension-js/extension.js/commit/27a7fc0f090d6dd33a8da82acb5adfbd41afea94))
- Rewrite store metadata names in one pass so extending names never double ([f51ce9bd](https://github.com/extension-js/extension.js/commit/f51ce9bd3d0d87c77aa627058bcc4b0ccb68a389))
- Keep create failure cleanup away from pre-existing user content ([1b4be860](https://github.com/extension-js/extension.js/commit/1b4be8604932687cd694ffbe2757dad49c0b125f))
- Clean the compiler output path instead of the context dist folder ([b43268af](https://github.com/extension-js/extension.js/commit/b43268afd0ceda66f376d13a0258a2393c52749e))
- Detect the system Edge binary when the lookup exits zero ([8195243a](https://github.com/extension-js/extension.js/commit/8195243aa09f404e6af081e880c2c48c9f87c386))
- Emit one-shot builds into a staging dir and rename into dist on success ([3bde9337](https://github.com/extension-js/extension.js/commit/3bde933746ead9b0fb6d4675516a722a76fd7e84))
- Merge the .extension-js ignore line into adopted project gitignores ([0af35866](https://github.com/extension-js/extension.js/commit/0af35866538cd017ca3adaa4589c5a7688344c4e))
- Gitignore the env files the framework loads in new scaffolds ([cc75991a](https://github.com/extension-js/extension.js/commit/cc75991a2d474cf52314565550489863ff2b9043))
- Deny secrets in the source zip independent of any gitignore ([58b02eb4](https://github.com/extension-js/extension.js/commit/58b02eb4cb73742ab05ea5dca911f327df502237))
- Read the stored device login as the publish token fallback ([ac3f31e1](https://github.com/extension-js/extension.js/commit/ac3f31e1d6d46eb217e2e98d8cdf891f5cc60d2d))
- Cover per-script reinject identity for multi-script content entries ([bc43a36e](https://github.com/extension-js/extension.js/commit/bc43a36ed60902cb6b567da15804262f5f4fb6d3))
- Disable deno minimum dependency age in the optional deps smoke ([3263cf04](https://github.com/extension-js/extension.js/commit/3263cf0459914edd832574364ca8e7ceb5366dff))
- Resync the bundled javascript template to the public screenshot ([8118e0d6](https://github.com/extension-js/extension.js/commit/8118e0d6e888bd95da9d0e4cffacd8bc057bd1c2))
- Pin waterfox-location 2.1.1 to finish the which 6 rollout ([d762486f](https://github.com/extension-js/extension.js/commit/d762486f0acee62ce35b73d0d48a2ee81d6c7ee0))
- Bump nine location package pins to the which 6 releases ([5b833eb7](https://github.com/extension-js/extension.js/commit/5b833eb7c5da0f2f3bd138ff3315f9cda2f37466))
- Name the requested template truthfully in the create banner and help ([11f4d779](https://github.com/extension-js/extension.js/commit/11f4d779b42e9e9794dfdc8f4e5f847f152ddd1e))
- Drop copied template lockfiles so npm ci works in a fresh scaffold ([dfe56de1](https://github.com/extension-js/extension.js/commit/dfe56de1a731e8bdd201e6b6caac615923af7a1f))
- Size the nightly e2e to a verdict and assert the CLI boots first ([aa7c2c49](https://github.com/extension-js/extension.js/commit/aa7c2c49435a84c359561b211538b1bbd2f5d2fd))
- Scope the firefox e2e project to the real Firefox specs ([2d9dc0d9](https://github.com/extension-js/extension.js/commit/2d9dc0d92ce08cc0d53e92bdd3ea432b7b062f9d))
- Let the nightly e2e fail red and find the CLI it builds with ([1455f52a](https://github.com/extension-js/extension.js/commit/1455f52a59f189f41745b1e2378ff099f4871fef))
- Name the browser doctor ran on and keep screenshots out of the zip ([eb766996](https://github.com/extension-js/extension.js/commit/eb7669964cc26a900e1e368300345f05a9afa9c1))
- Report a failed create to telemetry before the process exits ([a941ea6c](https://github.com/extension-js/extension.js/commit/a941ea6c64aa92262414a088accf2b9760c8119e))
- Revalidate the packument so a good release stops failing ([8842e104](https://github.com/extension-js/extension.js/commit/8842e104524c78ba6c588648fd8e073f16bbd2f4))
- Flush telemetry before exiting so a failure is actually reported ([558c12b4](https://github.com/extension-js/extension.js/commit/558c12b4f82b643ec24beb0e0347826bb6f4bd8d))
</details>

## 4.0.26 (July 31, 2026)

### Fixes

- Stop a missing Discord webhook from blocking a release ([a3f77b75](https://github.com/extension-js/extension.js/commit/a3f77b751d1871984cab9fa223977c034246d681))

<details>
<summary>Other changes (1)</summary>

- Make init scaffold the init template instead of a different one ([e6768252](https://github.com/extension-js/extension.js/commit/e67682526cd5a1ddcdac2dd300dee4f3cf1f9856))
</details>

## 4.0.25 (July 30, 2026)

### Fixes

- Stop a stored consent from speaking for a pipeline that inherited it ([0efa105c](https://github.com/extension-js/extension.js/commit/0efa105c6a3ecce1ebe090833f97f02f924be2c4))

<details>
<summary>Other changes (6)</summary>

- Update the AI help snapshot for the reworded template note ([366cfa10](https://github.com/extension-js/extension.js/commit/366cfa10e8523798f84968f3a453dde83bb9ca4b))
- Say the template rules in sentences the messaging check allows ([ba76f391](https://github.com/extension-js/extension.js/commit/ba76f391fecb4c13538d1a9ec269668f7116ce0b))
- Show every template name in create help instead of only to agents ([92dfb62b](https://github.com/extension-js/extension.js/commit/92dfb62b1ef2259ac35544784ad6d1e62dc77f27))
- Resync the bundled javascript template with the examples repo ([e6f4e96b](https://github.com/extension-js/extension.js/commit/e6f4e96b5bae8cc821ec3418fcf45454164f3b62))
- Give the default scaffold its own name, identity, and first commit ([f6adc197](https://github.com/extension-js/extension.js/commit/f6adc197e307437515ccad4933d2b4438cbf94be))
- Tell the reader where to get a token when publish has none ([e79862f3](https://github.com/extension-js/extension.js/commit/e79862f3c974abc100fef3e8be6b918fbafb91df))
</details>

## 4.0.24 (July 30, 2026)

### Fixes

- Stop reporting telemetry from CI, where nobody can consent ([75704161](https://github.com/extension-js/extension.js/commit/75704161ef1a2d6c10367288a59507e084afcc98))

<details>
<summary>Other changes (3)</summary>

- Prove a release shipped the fix by reading the published tarball ([3b2037e3](https://github.com/extension-js/extension.js/commit/3b2037e3d31b4510ee62b8ce5f3e63c92963e606))
- Keep reporting when CI is set but a person has a terminal ([1ebc1356](https://github.com/extension-js/extension.js/commit/1ebc1356183464dfd415083ac7341d1a97dd5b76))
- Resync the bundled javascript template with the examples repo ([e8ea0849](https://github.com/extension-js/extension.js/commit/e8ea0849aff2e340df0974ca056af13b20436c5c))
</details>

## 4.0.23 (July 30, 2026)

### Features

- Surface legacy manifest path warnings at scan time, not stats time ([19b0bfd9](https://github.com/extension-js/extension.js/commit/19b0bfd913a096e2714b137befa73d0955956cc2))
- Surface fatal manifest repairs at patch time with one visible line ([b71e2192](https://github.com/extension-js/extension.js/commit/b71e21921bd4979413b212f4dc8130f4ad1159da))
- Add machine-aware human sinks to the shared messaging primitives ([321da16a](https://github.com/extension-js/extension.js/commit/321da16ad96ba61dfe81470f0d2e5280243033c6))

### Fixes

- Stop warning about a port conflict when port 0 asked for any port ([eb2af2bc](https://github.com/extension-js/extension.js/commit/eb2af2bc2f2f25ea28fcd1cfb7ef3258151abf9d))

<details>
<summary>Other changes (11)</summary>

- Print where to share a build and name the sponsor in the README ([ca4d66a8](https://github.com/extension-js/extension.js/commit/ca4d66a8c24829f99bd5cfcad36ee6423d1cfc10))
- Name the sponsor in the README every scaffold keeps ([06831937](https://github.com/extension-js/extension.js/commit/068319371df7333ae1ccc851c4c3fe4039917221))
- Pin npm and drop a pnpm flag that npm 12 turns into a hard error ([8893ca9a](https://github.com/extension-js/extension.js/commit/8893ca9aadb55b29cdc5be4e4f13d1c9ef9077b2))
- Publish all four packages through OIDC instead of a shared npm token ([347f8b7b](https://github.com/extension-js/extension.js/commit/347f8b7be46209be487c0613556c0d50485f1f20))
- Honor commands noBrowser from the file config, flag still wins ([98d1ef47](https://github.com/extension-js/extension.js/commit/98d1ef477569f8880a7bd411b525fd78fdcd0e85))
- Stamp the user extension id on the ready contract for both families ([29b3f035](https://github.com/extension-js/extension.js/commit/29b3f035e86ff3ae0efc0c503b61644459ff504a))
- Warn early that a derived Safari bundle id is shared, drop Apple claim ([1afeb57b](https://github.com/extension-js/extension.js/commit/1afeb57b6532642c0b60ea2e460ffd18e5e9d916))
- Warn when a second dev session targets the same browser dist ([2b49905f](https://github.com/extension-js/extension.js/commit/2b49905f747040f8da590b64bea8ffbeb0db2297))
- Document the human sinks and the logs printer exception ([278cb12c](https://github.com/extension-js/extension.js/commit/278cb12ced86b8b97490f524d18ab49589050457))
- Trim snapshot and fallback notices to cause and remedy warn lines ([3b202466](https://github.com/extension-js/extension.js/commit/3b202466c80d78086911152d880bf780f028b94a))
- Route browsers-bundle console output through the human sinks ([70ebd131](https://github.com/extension-js/extension.js/commit/70ebd131aff1875c425d514b2ba89333476e4840))
</details>

## 4.0.22 (July 29, 2026)

### Fixes

- Sweep install messages and move the unpack receipt to success ([9a2681da](https://github.com/extension-js/extension.js/commit/9a2681dabfbca91609a8d23ed2f4febbf0e475d0))
- Sweep CLI helper messages and help headings to the style spec ([6da91b48](https://github.com/extension-js/extension.js/commit/6da91b48866b00ea7f7e035c1228df3aae3256eb))
- Sweep the browsers-lib catalog to the terminal style spec ([310961ca](https://github.com/extension-js/extension.js/commit/310961caa010577af386480c341556638fb367a4))
- Sweep the create catalog to error anatomy and progress voice ([c8222c87](https://github.com/extension-js/extension.js/commit/c8222c8772ed54605f4ad1486fa951b70b8f2026))

<details>
<summary>Other changes (16)</summary>

- Extend check-messaging with word, emoji, color, and period rules ([fc145be2](https://github.com/extension-js/extension.js/commit/fc145be2ff4f60f7d6dff7673a59c2da637046cc))
- Rewrite docs/MESSAGING.md as the spec v1 terminal-output standard ([c9a3af5b](https://github.com/extension-js/extension.js/commit/c9a3af5b10bd2ce1b0eeb8843cd1a2badee9a50c))
- Wrap bundler stats blocks in the standard error anatomy ([7604c9f6](https://github.com/extension-js/extension.js/commit/7604c9f60f8b8f2e7de91a4505305a7bae51ede5))
- Render commander parse failures through the error anatomy ([ea9cbdd6](https://github.com/extension-js/extension.js/commit/ea9cbdd65c6d7b9309736c9600c596adfdf47434))
- Reword develop lib messages to spec anatomy and drop dead twins ([501901ac](https://github.com/extension-js/extension.js/commit/501901ac63d448fdc538c205873dd9fe96e68e14))
- Glyph dev-server flow lines and sweep plugin catalog copy ([2ee60594](https://github.com/extension-js/extension.js/commit/2ee6059429d05d459025d9fcfdce416a9da394b6))
- Align web-extension feature catalogs with the error anatomy ([f6bc3918](https://github.com/extension-js/extension.js/commit/f6bc39184b135beb7e3de5c5d5d83352582a7f4d))
- Collapse the build summary into card, asset tree, and one closer ([39f23ebd](https://github.com/extension-js/extension.js/commit/39f23ebd967e7456e301eb87e4a03eaf11b82442))
- Record zip artifacts on the compilation instead of printing early ([e4ab9d25](https://github.com/extension-js/extension.js/commit/e4ab9d254cec3e3806074c15860c3450a3011247))
- Render build errors once by skipping the raw renderer under build ([455319ad](https://github.com/extension-js/extension.js/commit/455319ad2aaf889e5aa178d8e41020e59252b3e3))
- Collapse the home dir in the fallback card Output row ([feaf44ed](https://github.com/extension-js/extension.js/commit/feaf44edd003a8df29086022eb53496bdda7df34))
- Pin the dev no-browser boot transcript order with an exec spec ([281b8a26](https://github.com/extension-js/extension.js/commit/281b8a26b2a324202744cf5e9c78b343da5c79d2))
- Give the no-browser card an Output row, one mode marker, update hint ([899c3c3f](https://github.com/extension-js/extension.js/commit/899c3c3f1d3cbe7d8b5b8aec89ff5bc965574ef4))
- Move the resolved binary onto the card with provenance rows ([6341dc66](https://github.com/extension-js/extension.js/commit/6341dc66e03e682f518210112111c467ad819625))
- Unify the ready line wording and move it to the success channel ([c8267a1b](https://github.com/extension-js/extension.js/commit/c8267a1b9cd737f71864c8edb9db89c3c3ef2bd4))
- Print the compile line immediately and drop successfully from it ([67f16a80](https://github.com/extension-js/extension.js/commit/67f16a80289a1d7ac355f04e1bcbc80448c4e208))
</details>

## 4.0.21 (July 29, 2026)

<details>
<summary>Other changes (3)</summary>

- Report a chromium session that cannot confirm the extension loaded ([3cfbc95e](https://github.com/extension-js/extension.js/commit/3cfbc95eaaf84d4f82740aaeb0a9d06f7ba720a1))
- Print one browser row spelling across dev start preview build ([fda13f98](https://github.com/extension-js/extension.js/commit/fda13f98e47b3672f6386e983a5255c850d4cecd))
- Honor explicit zip filenames and name written zips on stdout ([91f7ee36](https://github.com/extension-js/extension.js/commit/91f7ee362d585173d24198ddb2741909838c6b47))
</details>

## 4.0.20 (July 28, 2026)

### Features

- Add a capabilities command answering versions and json-capable commands ([3d2eff57](https://github.com/extension-js/extension.js/commit/3d2eff57d61755a546c7648b6809b23ccc6b5a1f))

<details>
<summary>Other changes (17)</summary>

- Report inspect refused targets as TargetNotFound like eval ([e6eb2b5b](https://github.com/extension-js/extension.js/commit/e6eb2b5b03cc8e4336be4c729f098cfe8854b45c))
- Admit the capabilities command and theme message to contract guards ([99b71d92](https://github.com/extension-js/extension.js/commit/99b71d92bfeef07845f9dd4abe9172359253eb26))
- Frame every CLI exit path as one stdout envelope with structured refs ([5979f60b](https://github.com/extension-js/extension.js/commit/5979f60b8d2f6ff35b8362a116f903f2f5c9b248))
- Stamp profile path and browser pid, publish profile and dist helpers ([5b980075](https://github.com/extension-js/extension.js/commit/5b98007579a96817cc81b701b0cdd2cfaddfcd6d))
- Publish the whole ready contract and its type from the bridge entry ([08b1d1ed](https://github.com/extension-js/extension.js/commit/08b1d1ed209ab0a8e4f9cd82c98c247621781f00))
- Mint the documented eval hint on guest-throw failures ([6e68f67c](https://github.com/extension-js/extension.js/commit/6e68f67cd41ac5f0be68033897b65bbbf4720be6))
- Report the resolved build mode in the JSON envelope ([5fdc2a3f](https://github.com/extension-js/extension.js/commit/5fdc2a3f20b71a511b8e33d8e744023221723334))
- Name eval refusals on the wire and map unreachable targets ([6ccb3822](https://github.com/extension-js/extension.js/commit/6ccb382205bb594bbfec344943bc0042aaafeab6))
- Hand the WebSocket close code and reason to BridgeConsumer callers ([0f2b2d1b](https://github.com/extension-js/extension.js/commit/0f2b2d1b43c038cf86337805a9c43c9d8b9e16d1))
- Name open refusals on the wire so consumers stop matching prose ([c0b632b7](https://github.com/extension-js/extension.js/commit/c0b632b7f22ca07036bae121fabc273848b78410))
- Record engine-loaded companion extension ids in ready.json ([2f02e176](https://github.com/extension-js/extension.js/commit/2f02e1761e35ce26f27f119a0b184fb2e64c3f22))
- Reach the shipped dist contract through a package exports entry ([e841b404](https://github.com/extension-js/extension.js/commit/e841b40409a8a2a7005c7f99e4d78efcf2f1a309))
- Publish a browser-safe contracts entry with zero-import wire constants ([cbeaa8a9](https://github.com/extension-js/extension.js/commit/cbeaa8a9645ce706a35f2fa957acf65d976ba8cc))
- Name the theme image in the missing theme-image build error ([9b46f386](https://github.com/extension-js/extension.js/commit/9b46f386603af470f1fac088f83506ebc64a9584))
- Scope the MV2 install warning to manifests Chrome actually refuses ([8325a2bf](https://github.com/extension-js/extension.js/commit/8325a2bfe00df33158f6b3e45fe30e8e7c2df99e))
- Fail chromium builds over theme color values Chrome refuses at load ([bbe2548d](https://github.com/extension-js/extension.js/commit/bbe2548d8ad81473327e4794e7af3d8a286b4cde))
- Match Chrome's message-name charset in the manifest placeholder scan ([014bdb5f](https://github.com/extension-js/extension.js/commit/014bdb5f9ac42eb34ee75c8900474a9bd88e1270))
</details>

## 4.0.19 (July 28, 2026)

### Fixes

- Repair CI env and platform assumptions in three spec surfaces ([ef9f009c](https://github.com/extension-js/extension.js/commit/ef9f009c68a883a18418372ebf5e6fe884e890de))

<details>
<summary>Other changes (6)</summary>

- Publish the log ranking and the control close codes ([f5ee7e9c](https://github.com/extension-js/extension.js/commit/f5ee7e9ccff87d7a35fdc84417aeb4d80a9a3b5c))
- Rename treeWithDistFilesBrowser to repair the missing separator ([1e1cdb07](https://github.com/extension-js/extension.js/commit/1e1cdb0712d80ab525527496740a8ce3d462fa69))
- Move the chromium profile path from the debug stream to the card ([a7984212](https://github.com/extension-js/extension.js/commit/a7984212fc8122b7634a7d7cc04cca7964183c14))
- Rename pm args and drop dead params in create message catalog ([d1b2ac69](https://github.com/extension-js/extension.js/commit/d1b2ac6964a500313a1bb022b8663736905febe6))
- Let a library caller package Safari and read what the build made ([e624505a](https://github.com/extension-js/extension.js/commit/e624505a3b479acd98c290adab8f55eceda968a8))
- Keep companion extensions out of the source zip ([1b6b90bd](https://github.com/extension-js/extension.js/commit/1b6b90bd1fc14c4e83a8c007f444462c24646726))
</details>

## 4.0.18 (July 27, 2026)

<details>
<summary>Other changes (5)</summary>

- Override transitive postcss to 8.5.18 repo-wide ([6fc770e3](https://github.com/extension-js/extension.js/commit/6fc770e3b92db28128e02a23f19b2122fd48aaea))
- Bump postcss to 8.5.18 for the source-map path traversal fix ([1b7b2a8c](https://github.com/extension-js/extension.js/commit/1b7b2a8c9c07b7219307fd20df101e9f7e5eb690))
- Hold contract bytes and drift paths steady on Windows checkouts ([df4eecac](https://github.com/extension-js/extension.js/commit/df4eecac1e17d80f1f8172555e2b58f047fbc065))
- Render the compile arrow with prefix() and drop its glyph exemption ([ac618c29](https://github.com/extension-js/extension.js/commit/ac618c29e631cbb6ce57fd90da43b63e1a799cce))
- Migrate scripts harnesses from stdout tokens to the ready contract ([c7e4f978](https://github.com/extension-js/extension.js/commit/c7e4f9788eafb6f217f0d3ec31b157a40195915e))
</details>

## 4.0.17 (July 27, 2026)

### Features

- Add the schema-1 result envelope and its contract spec ([877a56ba](https://github.com/extension-js/extension.js/commit/877a56ba1b3c0c2035d0c75796808836e68b81d8))
- Add --debug and hide the author-mode alias behind it ([4ec7558a](https://github.com/extension-js/extension.js/commit/4ec7558a20eb7e689d6750662f8a6439e0e8ff89))
- Add duplicated messaging primitives with a drift spec ([49f5f5d6](https://github.com/extension-js/extension.js/commit/49f5f5d68d02db5d2d6643cebc803984055e4761))

### Fixes

- Gate the messaging standard in CI and publish it ([0b24d2cf](https://github.com/extension-js/extension.js/commit/0b24d2cfc19645c173ace1f2186a4215553905a3))
- Resolve the artifact noun through one rule for every browser ([7da4f6de](https://github.com/extension-js/extension.js/commit/7da4f6de1478c6136d0279aa9d6cad8836254d7e))

<details>
<summary>Other changes (28)</summary>

- Describe --silent truthfully and drop preview's unwired host flags ([5cd4d123](https://github.com/extension-js/extension.js/commit/5cd4d1237cf2da9e272e583e85cb9195fc6496ca))
- Complete the error code table and ship its golden envelopes ([782a2cdc](https://github.com/extension-js/extension.js/commit/782a2cdc0391c656e354534f60cdb6fc6041db14))
- Rewrite browser runner messages to the imperative standard ([0ca79c34](https://github.com/extension-js/extension.js/commit/0ca79c34106fb210a27f5c37db3df54950ab2b92))
- Rewrite develop core messages to the imperative standard ([37c16254](https://github.com/extension-js/extension.js/commit/37c162547e7be5d9e540c99e5365281f20bb4829))
- Rewrite CLI helper messages to the imperative standard ([092691e1](https://github.com/extension-js/extension.js/commit/092691e14a23239c62097ecf6f84d86b7d9cd296))
- Rewrite web-extension feature messages to the imperative standard ([81924644](https://github.com/extension-js/extension.js/commit/819246441cad777b5632bc09da5b8d88b999f3fd))
- Rewrite develop leaf-plugin messages to the imperative standard ([f81b968e](https://github.com/extension-js/extension.js/commit/f81b968ebb2eb50b8b86279c91e4f8bf66291855))
- Print the card first on every path and retire the banner event ([01d7ee81](https://github.com/extension-js/extension.js/commit/01d7ee8150fc4c85a80a66f1672bd18ce60e33c5))
- Map the legacy format flags onto --output and free the dev failure frame ([dd6bf6e7](https://github.com/extension-js/extension.js/commit/dd6bf6e706293a6bd7229cbba3eb6bed4b0e7e23))
- Ship the envelope contract inside the extension-develop package ([a0dbb1af](https://github.com/extension-js/extension.js/commit/a0dbb1afe1f9399414f1d9ede4ed8ff91b631dad))
- Advertise schema-1 support in the ready contract ([cea4f029](https://github.com/extension-js/extension.js/commit/cea4f029af6d26e95c4af4cb65e86cf33882b323))
- Generate the help center from the command table ([99a88ff2](https://github.com/extension-js/extension.js/commit/99a88ff2418f05b3b36539f97f6597e3b7c08108))
- Move internal steps to the debug channel across develop ([67caa0db](https://github.com/extension-js/extension.js/commit/67caa0dbfdccf16de324c63c8ab2dd504befabd6))
- Print the card before launch work and stamp profile locks ([d026f017](https://github.com/extension-js/extension.js/commit/d026f017f6ad43f8d49ad88e7a8ea4c3a7b08700))
- Emit the result envelope from every terminating command ([8917a32d](https://github.com/extension-js/extension.js/commit/8917a32d28cd1fd97e8324869d6d65375ca1f742))
- Stream the dev session lifecycle as schema-1 NDJSON frames ([d28aa615](https://github.com/extension-js/extension.js/commit/d28aa615ca264009e985e29b7dd32171d438fb11))
- Seed the error code table for the remaining commands ([e91221f9](https://github.com/extension-js/extension.js/commit/e91221f9a31a436155c726dc550dc598a68c0069))
- Emit the result envelope from build under --output json ([7c3f20e9](https://github.com/extension-js/extension.js/commit/7c3f20e9b4298fc6d941761debb3bcc9609293f6))
- Describe every command once, in the imperative mood ([0615bf25](https://github.com/extension-js/extension.js/commit/0615bf25ff0c7c23beb8987c05f3a1a73b5eff4a))
- Print the card before the ready line in no-browser mode ([6ea73aa9](https://github.com/extension-js/extension.js/commit/6ea73aa907003e32328e1289c6e86358e8b70e96))
- Render every Extension.js card through one renderer ([c63ec7b3](https://github.com/extension-js/extension.js/commit/c63ec7b317d2108e8da7dc54b8ca31f918dddab6))
- Point the debug docs at the flag that actually works ([20ab2c36](https://github.com/extension-js/extension.js/commit/20ab2c363a9844639a19ef9ffb66cca1e6b1cccc))
- Drop the Author says prefix and move errors onto the glyph ([c44c9eae](https://github.com/extension-js/extension.js/commit/c44c9eaeff5b08b76a762f1460cd3dee9f9a1f81))
- Read the debug flag through one accessor with a closed value set ([497374ee](https://github.com/extension-js/extension.js/commit/497374ee8d7d37d3879a389908a401aa40e4ce33))
- Move fmt into the shared messaging primitives ([140496ec](https://github.com/extension-js/extension.js/commit/140496ec2987b5dd40fcdf3d1352da9c56264b25))
- Let commands report vendor and wait failures themselves ([4a26aff0](https://github.com/extension-js/extension.js/commit/4a26aff0162aba1f849ee5863d86cc03bc909691))
- Collect specs under the contract directory in vitest ([fa227cc0](https://github.com/extension-js/extension.js/commit/fa227cc08b3172c70c73fc5728c079cd75b2eec8))
- Send first-run and update notices to stderr ([7742e4cf](https://github.com/extension-js/extension.js/commit/7742e4cf9a647256a9d9a101161ca9b020c14708))
</details>

## 4.0.16 (July 24, 2026)

### Features

- Add a package managers table and drop the README top banner ([6a20d62a](https://github.com/extension-js/extension.js/commit/6a20d62aa7c60cc891968bfa9b47da102431261d))
- Add the brand banner to the README ([854a3d51](https://github.com/extension-js/extension.js/commit/854a3d51ab8354bf61dc38abd534d3914047be6d))

### Fixes

- Resolve packed-tarball paths at run time in the CLI exec tests ([d38a4f97](https://github.com/extension-js/extension.js/commit/d38a4f97e282a483ce7a9413e44970dcdbfc944b))
- Correct docs: Rspack naming, Node 22, and stale links ([a80a96ec](https://github.com/extension-js/extension.js/commit/a80a96ec9e08bb52f47d43de3b94767f9bfee520))

<details>
<summary>Other changes (24)</summary>

- Bump CI GitHub Actions to their latest major versions ([d9085481](https://github.com/extension-js/extension.js/commit/d9085481ca61d2eab8a997a312273b9208797394))
- Probe exec-runner readiness in a temp dir, not the repo root ([33171cc0](https://github.com/extension-js/extension.js/commit/33171cc0ac4a3b3f9ebe4fe90078f9c97ad4639d))
- Ignore the workspace in the pnpm smoke frozen installs ([0a89bf49](https://github.com/extension-js/extension.js/commit/0a89bf49a67da35c02105e589d463992e2f182c1))
- Sync pnpm-lock.yaml with the extension devDependencies move ([da3257c2](https://github.com/extension-js/extension.js/commit/da3257c2b54a3d2975f8244145cb54aa0866aa13))
- Stamp template provenance into scaffolds and CreateResult ([7333b399](https://github.com/extension-js/extension.js/commit/7333b399edbfee71b17eb2cfd2d9de3bf0bf6a2f))
- Accept a commit SHA or tag for the template corpus ref ([1dffd4cd](https://github.com/extension-js/extension.js/commit/1dffd4cdc622b7e2c3f2a735e5ac98331e6d078d))
- Strip internal tracker refs and rename client test fixture ([c85eec74](https://github.com/extension-js/extension.js/commit/c85eec748c32f5caf0b474460cfd59711f1ac71c))
- Tidy gitignore, CI perms, dependabot, and package metadata ([a65da380](https://github.com/extension-js/extension.js/commit/a65da380697e6fbefbab0011669932d98ecaafac))
- Remove unused html-merge browser helper ([23e065a6](https://github.com/extension-js/extension.js/commit/23e065a663bd5c6b807b95625fa2f2f99b99adf6))
- Prune nine pnpm overrides that no longer change any resolution ([f03de5e7](https://github.com/extension-js/extension.js/commit/f03de5e7c76bbd2eb4b7e30c53b882ea3fcd093f))
- Drop the unused root extension devDep that kept postcss 8.5.10 ([55e688bb](https://github.com/extension-js/extension.js/commit/55e688bb06b3b311fd21a60716c76802e9abca53))
- Fall back to the framework logo when a welcome icon fails to load ([0ef0592c](https://github.com/extension-js/extension.js/commit/0ef0592c296b80e69738bc8a3b16f41305a5b24e))
- List Safari among the browsers the framework builds for ([21fa4c0a](https://github.com/extension-js/extension.js/commit/21fa4c0ad092319f13efba68db008d59e74d4078))
- Recover a refused dev session once the browser accepts the extension ([4d568d71](https://github.com/extension-js/extension.js/commit/4d568d71879d6b372bb3a73338b1e843de096e5f))
- Report a Firefox add-on refusal and let the engine re-offer the dist ([d69cc932](https://github.com/extension-js/extension.js/commit/d69cc93225779eb1cb4386d91e658ec22c7c02fa))
- Report Chrome refusing to load the extension instead of ready ([c2ed1ee5](https://github.com/extension-js/extension.js/commit/c2ed1ee5f9ecad39666d0a825e0c8455ea3e1f36))
- Isolate the browser-flags specs from an exported EXTENSION_HEADLESS ([6c076c2e](https://github.com/extension-js/extension.js/commit/6c076c2e4c309bde116ec3fd343ab7cc88979c3a))
- Match the missing-JSON message to whether the build actually fails ([001ae301](https://github.com/extension-js/extension.js/commit/001ae301c7afb7cf3711c21bf12a8bf86a8b3084))
- Leave static themes uninstrumented in dev on Firefox too ([4bde2c4f](https://github.com/extension-js/extension.js/commit/4bde2c4f5180cbfef24f9b46cfd116df5201f46a))
- Honor EXTENSION_HEADLESS so automated runs never steal focus ([8ce8be25](https://github.com/extension-js/extension.js/commit/8ce8be25d781728c77eabb74480879d67b081b9d))
- Refresh the messages catalog snapshot for themeImageIsEmpty ([51e99a7b](https://github.com/extension-js/extension.js/commit/51e99a7b5ced8488c0d365bb0e7e4196f047078b))
- Fail the build on missing theme images, warn on 0-byte ones ([fe08a437](https://github.com/extension-js/extension.js/commit/fe08a437d8a9de6f62b4eb983ef3e20db6d084dc))
- Match the release-notes tooling to the new release commit subjects ([4192a4bd](https://github.com/extension-js/extension.js/commit/4192a4bd1c5bcfb3643d28fa4c2c4dacdee07103))
- List Safari as a supported target in the README ([29656327](https://github.com/extension-js/extension.js/commit/2965632735a2c6d9d67dbc5fc8385ce746d7ae2d))
</details>

## 4.0.15 (July 23, 2026)

<details>
<summary>Other changes (3)</summary>

- Bump fast-uri to 3.1.4 and immutable to 5.1.9 (Dependabot) ([c0647378](https://github.com/extension-js/extension.js/commit/c064737835197fbb6a524001f011e3ec36bc2d92))
- Drain stdout before exit so piped --output json frames arrive intact ([3e78dada](https://github.com/extension-js/extension.js/commit/3e78dadab810ef9bf8fd70b9a50cff3bca3180f1))
- Align log/event runId with ready.json and publish Firefox rdpPort ([f6a639fd](https://github.com/extension-js/extension.js/commit/f6a639fd842e217e7c3b96b31970009cbc9e393e))
</details>

## 4.0.14 (July 21, 2026)

### Fixes

- Guard the CLI on Node < 22.12 with a clear version error ([06930647](https://github.com/extension-js/extension.js/commit/069306474494cb5db291d4208a04ada52567c1a5))
- Fix eval executor: surface contexts, CSP honesty, Gecko callback APIs ([2c386c58](https://github.com/extension-js/extension.js/commit/2c386c584968156c34c275ef11a5b6b0f6a1ad80))
- Stop dropping release notes and recover the lost 4.0.x changelog ([0c2b4a59](https://github.com/extension-js/extension.js/commit/0c2b4a59963c9de565448c827d533ac46d3fdf1b))
- Fix Firefox storage bridge and surface uncaught dev-log errors ([b9381fb6](https://github.com/extension-js/extension.js/commit/b9381fb63a48be0ca9a843f51da0356c0eb71ca0))

<details>
<summary>Other changes (39)</summary>

- Sync bundled javascript template: STORE.md and manifest key order ([d0649f41](https://github.com/extension-js/extension.js/commit/d0649f41d91751f2eca575f52467462c5432eba5))
- Bump the js-yaml override to 4.3.0 to clear GHSA-52cp-r559-cp3m ([22392bbd](https://github.com/extension-js/extension.js/commit/22392bbd51ccfcc259bb5debad91116e254540f5))
- Replace em dashes in user-facing strings to satisfy the prose gate ([5581bb7b](https://github.com/extension-js/extension.js/commit/5581bb7b5eac85b305c7d83cd3fef7ae1ad02fec))
- Scrub source comments wave 3 of 3; annotate empty catches with Ignore ([9319bcd7](https://github.com/extension-js/extension.js/commit/9319bcd777999519a1d9315ac70b37e1b044dd15))
- Scrub narration and internal refs from source, wave 2 of 3 ([a3f23352](https://github.com/extension-js/extension.js/commit/a3f233528a208a2aff52ca1701a3900ffd14c337))
- Scrub narration and internal refs from source, wave 1 of 3 ([935e71d4](https://github.com/extension-js/extension.js/commit/935e71d48bc4b7d01080e3f31308368f0205742d))
- Record the AMO data-collection message in the catalog snapshot ([6a165dda](https://github.com/extension-js/extension.js/commit/6a165dda4426b0c7f9c2e879c72f6116557fbc53))
- Scaffold the AMO data-collection key; warn on key-less Firefox builds ([c3edd7cb](https://github.com/extension-js/extension.js/commit/c3edd7cb3c106c82d3a1936487ff5d7cbc95f02a))
- Remove non-policy comments from test files ([0b08d787](https://github.com/extension-js/extension.js/commit/0b08d787b66cf85c85c895de64259908907b0ae7))
- Keep the watcher alive when a mid-save manifest is invalid JSON ([0a7e4de5](https://github.com/extension-js/extension.js/commit/0a7e4de5fab4eb90481fb9c8b8739b9944d3b6a6))
- Self-ignore dist/extension-js so session state never gets committed ([485e8aae](https://github.com/extension-js/extension.js/commit/485e8aae5deedfe09e54bcbade866e61a8b84fc0))
- Persist the build summary contract for hosts that shell out to build ([998ba33f](https://github.com/extension-js/extension.js/commit/998ba33f6582a067522fc59a16a0012add5b25e1))
- Route browser-generated CDP Log warnings into the bridge log pipeline ([f28cae7a](https://github.com/extension-js/extension.js/commit/f28cae7ae81330b16f16e1b83ddc3df28ed04a73))
- Align doctor specs with the unknown browser-liveness verdict ([b44843df](https://github.com/extension-js/extension.js/commit/b44843df9107495e3087ae86f1fce9c09a7a0bf1))
- Honesty cluster: doctor unknown verdict, stub warning text, zip locale ([e82edf95](https://github.com/extension-js/extension.js/commit/e82edf95eaabff233d2cedaff1e098b6e531d32a))
- Reach url-override extension pages via the surface relay ([a593d3e1](https://github.com/extension-js/extension.js/commit/a593d3e1b009e41293dd6b65cd0e2d108a9dc6b1))
- Keep MV2 dev background persistent and drop stale Firefox startupCache ([2c973280](https://github.com/extension-js/extension.js/commit/2c9732803a8d8f29b332bd8fca689322f5bb15d7))
- Warn when user code relies on dev-injected permissions, align MV2 set ([db244e82](https://github.com/extension-js/extension.js/commit/db244e8298fffafea6017fdbecf77811835b8ca0))
- Never rewrite a live dev session contract from build/preview/start ([1b787ac4](https://github.com/extension-js/extension.js/commit/1b787ac4a27b85c64c0aeec755dc0edac2fbafae))
- Stamp unexpected browser exits for Firefox and preview, flip run-only ([68eb64e4](https://github.com/extension-js/extension.js/commit/68eb64e47fca8ff9124b8342ab05b28d2b28b01f))
- Stamp ready.json stopped at watch close and keep errored manifests watched ([9dc071b5](https://github.com/extension-js/extension.js/commit/9dc071b518451ca7ac1c08dfc377e6bd03081af4))
- Trace offscreen.createDocument urls so offscreen documents ship in dist ([3b121530](https://github.com/extension-js/extension.js/commit/3b12153033cabafa40f5c28adfa59cad65441229))
- Ban explicit any across every program, leaving specs and the fork ([f33537ca](https://github.com/extension-js/extension.js/commit/f33537caf28eb241e9f9b74c5f72e13759cb19e3))
- Ban explicit any across the develop program source ([da1a8b0c](https://github.com/extension-js/extension.js/commit/da1a8b0c910f45d9f185bb56aa7d1094ddeb77dd))
- Ban explicit any in the CDP and RDP browser clients ([35de37f5](https://github.com/extension-js/extension.js/commit/35de37f57f8371fd9328230ad70cd76e9048e02a))
- Ban explicit any in plugin-web-extension and type its boundaries ([04f535bf](https://github.com/extension-js/extension.js/commit/04f535bf92f861a4b86b5789df92e47b9c262403))
- Apply the safe autofixes for five style and import lint rules ([0b792d76](https://github.com/extension-js/extension.js/commit/0b792d762c8e175275c06d738a456b23e3e20de9))
- Retire the deferred lint warnings and make two suspicious rules errors ([90ece933](https://github.com/extension-js/extension.js/commit/90ece933ecfe6032551a119fb3a0fa3075fb0c82))
- Cover the bridge injection steps and the whole CLI command surface ([e7db54e6](https://github.com/extension-js/extension.js/commit/e7db54e63e3328285497e2ba349e672e4a32d4b0))
- Unwrap the async promise executor in CDP connect and ban the pattern ([855aa59c](https://github.com/extension-js/extension.js/commit/855aa59c41bafbce5b09651d771c2dff9c1a60a6))
- Cover the reload strategy background entry and MAIN world bridges ([28684c36](https://github.com/extension-js/extension.js/commit/28684c36197e0a275fbb4d074651ea5d9cd504dc))
- Give the browser connection errors a cause and a next step ([da7b91a4](https://github.com/extension-js/extension.js/commit/da7b91a4a5097a640605183825e625f9ca8d7839))
- Clear em dashes from source and guard against new ones ([ca8a880e](https://github.com/extension-js/extension.js/commit/ca8a880e70685d500e9594d7d5d938ed40d275e2))
- Replace the 23.6MB typescript dependency with rspack's swc and acorn ([694b1970](https://github.com/extension-js/extension.js/commit/694b1970fad4838215e794c32dbe37b6f6c19659))
- Make the lint gate real and restore the pre-commit hook ([87fc0ff5](https://github.com/extension-js/extension.js/commit/87fc0ff54575c12330cdcbf4ab53315c03394102))
- Scaffold moduleResolution bundler; node is gone in TypeScript 7 ([fe126c7e](https://github.com/extension-js/extension.js/commit/fe126c7e0a8f48d1f0f9bd3a81a0af2a48b07998))
- Split typescript: runtime stays on 6.x, tooling moves to 7.0.2 ([f0fa2169](https://github.com/extension-js/extension.js/commit/f0fa216997d38fe6712d9ab2303d59c28d2af812))
- Fetch create templates via codeload tarball, not a full git clone ([2fc5bd58](https://github.com/extension-js/extension.js/commit/2fc5bd58a1cc2abd3b46172e4c1a255bf5524159))
- Pin a resolved engine version in scaffolds instead of floating latest ([283b4ab9](https://github.com/extension-js/extension.js/commit/283b4ab959f3a23940550fd72ca146afcd150cb3))
</details>

## 4.0.13 (July 19, 2026)

### Features

- Add --no-polyfill, emit extension-develop dts, fix stale --source help ([176dcbc6](https://github.com/extension-js/extension.js/commit/176dcbc6d119e5e5d73b122bef0caa3dc1fca2a1))
- Add --parent-pid watchdog so leaked dev servers die with their owner ([d621db4c](https://github.com/extension-js/extension.js/commit/d621db4ce573afeb72c0cc7c3a6b9f3dbaf93753))

### Fixes

- Resolve HMR runtime from @rspack/core so Yarn PnP resolves it (#486) ([c8921028](https://github.com/extension-js/extension.js/commit/c89210285ef3d248979125ae2c49c91c1414fdbf))
- Resolve browser-prefixed world keys before MAIN-world bridge compilation ([6a28451e](https://github.com/extension-js/extension.js/commit/6a28451e610d8dc7096e951137f0ff1fe17a1ec6))
- Sweep reload-era dead code from browsers; trim README deno note ([cf542f59](https://github.com/extension-js/extension.js/commit/cf542f5914e19e1d0e84778a2471b145f26ebde8))

<details>
<summary>Other changes (4)</summary>

- Prune superseded hot-update generations from the loadable dev dist ([c4c9712f](https://github.com/extension-js/extension.js/commit/c4c9712fd3a9b9a2fdd197f4dd70145a8bc35e71))
- Stamp real command + versions in ready.json; per-run events.ndjson ([14a148a3](https://github.com/extension-js/extension.js/commit/14a148a367edc62e0756bf65a9fb49aa606569a4))
- Slim feature-scripts: drop dead shims, unify compilation issue reporting ([9753ac78](https://github.com/extension-js/extension.js/commit/9753ac78d2db28979c06a2a9d2cfed2a8b2fef14))
- Extract reload/HMR into plugin-reload; hoist content-script wrapper ([40242f16](https://github.com/extension-js/extension.js/commit/40242f16787eea55b7f734bba9438359eeacb53b))
</details>

## 4.0.12 (July 17, 2026)

- **`extension doctor`**, one command that walks a dev session's control-channel legs (ready contract, server process, ports, token, executor, browser) and names the first failing one with a fix. Agents get `--output json`.
- **Fork-browser fixes**, waterfox/librewolf now get Firefox-shaped `web_accessible_resources`, and brave/opera/vivaldi/yandex now get the MV2-deprecation warning Chromium targets already had.
- **Clearer control-channel errors**, "no executor connected" and eval "Forbidden" now say *why* (stale service worker mid-resync, browser still launching, missing/mismatched eval token) instead of a catch-all.

### Fixes

- Fix control-port spec: resolve() adds drive letter on Windows ([9c3409b8](https://github.com/extension-js/extension.js/commit/9c3409b8d577c1641e515fdd4db976e5998a4729))
- Prevent #484 class: per-browser token, doctor verb, session smoke CI ([7a364996](https://github.com/extension-js/extension.js/commit/7a364996db0e84cc284a53c2a84c3596e2ef7284))
- Fix deno smoke lane: deno install ignores file: deps; use links field ([30bd487a](https://github.com/extension-js/extension.js/commit/30bd487a9873d4082734eccb4579830ee09caeb3))
- Stop claiming Preact HMR in author-mode summary and dev help ([c541e389](https://github.com/extension-js/extension.js/commit/c541e3899f09b08c46e6ead6f88d91f396f3bc4d))
- Fix npm README logo rewrite regex; resync generated mirror ([675f409f](https://github.com/extension-js/extension.js/commit/675f409f8c038fa4d0073a8da8de68bcfcd49798))
- Repair named commands missing descriptions Chrome refuses to load ([f3f7ef04](https://github.com/extension-js/extension.js/commit/f3f7ef0497fdbede4d1101317761974597760a28))

<details>
<summary>Other changes (16)</summary>

- Extract inline script by string index, not regex (CodeQL #73) ([f2212e2f](https://github.com/extension-js/extension.js/commit/f2212e2f29f1d827c0fb4ae4635e8bba7a252c8b))
- Trace webpack numeric chunks + runtime-set HTML surfaces into dist ([af7d01dc](https://github.com/extension-js/extension.js/commit/af7d01dc825b40127cc2a9dbda326866b8f943dc))
- Normalize folder ASCII banners: add 113 missing, fix 20 wrong ([4dceaa53](https://github.com/extension-js/extension.js/commit/4dceaa53c3c49fdda137761af2a959dffffa63e7))
- Remove resolved docs/followups and dead vitest.workspace.ts ([1012fa4d](https://github.com/extension-js/extension.js/commit/1012fa4d031ddf6ff5cb140744b30169673f7673))
- Log Firefox RDP connect retries and name the port on give-up ([6df40b3c](https://github.com/extension-js/extension.js/commit/6df40b3c0dd8ed7247f2c1cb9f474035c07462e7))
- Repo hygiene: drop dead files, fix docs drift, sync test workspace ([2968a6bb](https://github.com/extension-js/extension.js/commit/2968a6bb8039e4405807d89f47f446cd1ca975e5))
- Bridge classic page-script globals to window for inline consumers ([03ab02f0](https://github.com/extension-js/extension.js/commit/03ab02f0e9410a35b64a328457ebf56e92b2be31))
- Root-absolute refs: ship JS import closure, fix manifest page targets ([93b91eb9](https://github.com/extension-js/extension.js/commit/93b91eb94c1593b78d1a4c5abbd6dfa640cc6bde))
- Resync generated npm README mirror (Safari status Alpha) ([c9f50098](https://github.com/extension-js/extension.js/commit/c9f500983926f33d0c20f6fd32c9bce7f2649acc))
- Resync bundled javascript template: top-level setPanelBehavior fix ([16244387](https://github.com/extension-js/extension.js/commit/16244387be8a0db88c705e86d3ef5f1d90a97883))
- Reject failed builds as promises; process.exit(1) only via CLI opt-in ([28444e30](https://github.com/extension-js/extension.js/commit/28444e30c36251488daa653410322202f6f30e60))
- Leave unresolvable bare require() verbatim instead of failing the build ([0e350461](https://github.com/extension-js/extension.js/commit/0e350461eb5c4fdaf43afb899d100aa7f409ee31))
- Canonicalize supported-surface lists; promote deno to full peer ([b92e379f](https://github.com/extension-js/extension.js/commit/b92e379f60f913352c9668953f87291b40c2f0d1))
- CI: promote Deno to PR-gating smoke lane (validated locally) ([95cd5dc4](https://github.com/extension-js/extension.js/commit/95cd5dc43b5a397af76ae0f9e69c441be55b6327))
- CI: smoke fork build targets; add non-blocking nightly Deno lane ([535bd26a](https://github.com/extension-js/extension.js/commit/535bd26a5e199aa031906954ae72b83d3c8a8f49))
- README: note Deno support alongside npm/pnpm/yarn/bun ([fc5e0e4c](https://github.com/extension-js/extension.js/commit/fc5e0e4cf5db30a95ed8c912f7cbcc96f509204e))
</details>

## 4.0.11 (July 17, 2026)

### Features

- Add nightly macOS smoke for the real Safari toolchain pipeline ([58e695a8](https://github.com/extension-js/extension.js/commit/58e695a80986efa020c305ebf5826e8c8c192bb1))
- Surface Safari xcrun/xcodebuild output; build skips packaging off-macOS ([d85bda2d](https://github.com/extension-js/extension.js/commit/d85bda2d241f8d22db865186f12f6908ee2b5949))

### Fixes

- Guard bundled javascript template against examples drift ([ddb6cbe4](https://github.com/extension-js/extension.js/commit/ddb6cbe4a8c4bf28508f5d954f67d4715135c409))
- Resolve safari:/webkit: manifest prefixes; warn before project regen ([627a47ed](https://github.com/extension-js/extension.js/commit/627a47ed57028d20ce24c8632613d0243125e992))
- Repair missing version and CSP unsafe-inline; diagnose unsupported MV ([752d7b41](https://github.com/extension-js/extension.js/commit/752d7b419c1779bd7b04671165c9f62e2529cdad))

<details>
<summary>Other changes (6)</summary>

- Resync bundled javascript template with examples repo ([c91107b0](https://github.com/extension-js/extension.js/commit/c91107b0f8a92cb2c474d2b9bbe651d76597cd20))
- Align Safari app/appex bundle ids to --bundle-id after conversion ([92f52393](https://github.com/extension-js/extension.js/commit/92f52393a1e91b9f8ad1b84e26ff94758ae1b2ab))
- Safari status to Alpha; install explains Xcode instead of a binary ([f0e1476f](https://github.com/extension-js/extension.js/commit/f0e1476fd24df5a158442a828268e88a118eebe4))
- Wire Safari identity options: --bundle-id/--app-name + config support ([e807425e](https://github.com/extension-js/extension.js/commit/e807425e3fb9690468d0e424129473bf51c0ffbd))
- Record Safari converter as a non-surface for manifest refusals ([61ea1b2d](https://github.com/extension-js/extension.js/commit/61ea1b2da510c7b787fac6969dfd5bc208bd2500))
- Diagnose live-verified Chrome manifest refusals; repair bad names ([f847bf04](https://github.com/extension-js/extension.js/commit/f847bf04c847ce7a43ba5bf4224f58218694edbf))
</details>

## 4.0.10 (July 15, 2026)

### Fixes

- Stop emitting assets on errored compiles so dist keeps last-good ([c892604b](https://github.com/extension-js/extension.js/commit/c892604b8ff07da2e4dd24a54c95a1da74447128))

<details>
<summary>Other changes (5)</summary>

- Strip emojis from generated release notes ([e695af5c](https://github.com/extension-js/extension.js/commit/e695af5ccbbc333bc28a358534897a955f822d5c))
- Ship real compile-error text in ready.json and events.ndjson ([c240e957](https://github.com/extension-js/extension.js/commit/c240e957c1aee0b45c287de6f5db370460027c8a))
- Print dev command failures cleanly without a stack trace ([43da7705](https://github.com/extension-js/extension.js/commit/43da7705964f95375e1ec80b10782d48f050838a))
- Latch content-script reloads until the SW acks, replay on hello ([3ba10bef](https://github.com/extension-js/extension.js/commit/3ba10befcd8e219a383bf027282651b01633958d))
- Warn per file when scss/less ship uncompiled without their compiler ([2b13c69e](https://github.com/extension-js/extension.js/commit/2b13c69e1966bb01d6ce5abcdbff53443be8b8d0))
</details>

## 4.0.9 (July 13, 2026)

### 🐛 Fixes

- Stop killing the dev browser on CDP stalls; surface its death ([6efb433b](https://github.com/extension-js/extension.js/commit/6efb433b1558d3f7d32c101161068bb618c90ff2))
- Stop flagging wildcard ports in match patterns as launch refusals ([45919bda](https://github.com/extension-js/extension.js/commit/45919bdafda1d87495d87e382d00c6b8a845dcd6))
- Resolve root-absolute CSS url() from the extension root ([0528f719](https://github.com/extension-js/extension.js/commit/0528f719b9f69d74a1de4b877f0117e168052a26))
- Resolve root-absolute refs and TS NodeNext .js import specifiers ([0489ee2f](https://github.com/extension-js/extension.js/commit/0489ee2fa6488d618d7b8ac4e5206a8e9055e772))
- Stop flagging query strings and fragments as launch refusals ([867e9cfa](https://github.com/extension-js/extension.js/commit/867e9cfa5756abeecc918dd7560b042fc654b982))

<details>
<summary>🧹 Other changes (8)</summary>

- Loosen dev connect-src for the resolved connectable host ([17387584](https://github.com/extension-js/extension.js/commit/17387584314d8b50aca67088a56f68e7b16cd89c))
- Tolerate dead CSS url() refs; type-strip TS in classic-concat ([3f897b86](https://github.com/extension-js/extension.js/commit/3f897b86cb64bbb8bd0997849a937c86825673c8))
- Ship console-relay logs over a named Port to kill message loops ([25b8fc3d](https://github.com/extension-js/extension.js/commit/25b8fc3d06ff7e26faa4a063e690bd47243fe78c))
- Auto-install with --ignore-scripts; warn on dead HTML refs ([f814c5a6](https://github.com/extension-js/extension.js/commit/f814c5a6f9cdacfab5bc30c37975dcce57628663))
- Isolate devtools overlay shadow host from page styles ([9c820490](https://github.com/extension-js/extension.js/commit/9c82049023662c91bc3b5e1cbc8b258d6bcabc37))
- Raise RUST_MIN_STACK to 256MB so deep ASTs do not SIGILL rspack ([6bb690d7](https://github.com/extension-js/extension.js/commit/6bb690d7cc64ba35f8bab4a62fa1973eea1e6ff3))
- Dedupe files listed twice in one content_scripts js array ([a92ea492](https://github.com/extension-js/extension.js/commit/a92ea4926be5eb7a2fd736c31cf2601834159741))
- Content-hash dev asset names to stop same-basename collisions ([448908d4](https://github.com/extension-js/extension.js/commit/448908d49dbc1fc3acd25012f631dd6375237b4f))
</details>

## 4.0.8 (July 12, 2026)

### 🚀 Features

- Add EXTENSION_BROWSER_FLAGS env pass-through for launch flags ([9caff479](https://github.com/extension-js/extension.js/commit/9caff479e4a916a261be5d219ab0cbd635a7f060))
- Add getURLDependencyMissing to the messages-catalog snapshot ([892d5017](https://github.com/extension-js/extension.js/commit/892d5017175d754708b81b8dcfb1f48f650e335d))

### 🐛 Fixes

- Stop flagging explicit ports in match patterns as launch refusals ([4173b78b](https://github.com/extension-js/extension.js/commit/4173b78beab1b57b58daf7583c4c515569bce8d2))
- Repair 0-byte manifest icons and diagnose unloadable icons at launch ([7f8b05c3](https://github.com/extension-js/extension.js/commit/7f8b05c36e9cefcbb27c4fb83614c3547834d052))
- Repair non-numeric manifest version strings at emission ([6317ef87](https://github.com/extension-js/extension.js/commit/6317ef8728a0e0a826994b2a2a667a32cba72dc1))
- Resolve root-URL HTML refs against the manifest root, not dist ([dc74367c](https://github.com/extension-js/extension.js/commit/dc74367c3c7f79f3f1b55161fcc49090f3664e77))
- Repair manifest shapes Chrome refuses and diagnose MV2 on Chromium ([7e31834c](https://github.com/extension-js/extension.js/commit/7e31834cb6f39a3062f722ce150693e4cb72887f))
- Harden dev reload delivery: empty background, CSP origins, load errors ([c6ef6b09](https://github.com/extension-js/extension.js/commit/c6ef6b09a16dca8fd1e9a4e07ff2bfb6100c736c))

<details>
<summary>🧹 Other changes (27)</summary>

- Fan shared SW+content module edits to both reload paths and heal tabs ([2d28ad77](https://github.com/extension-js/extension.js/commit/2d28ad77674c3864057decdbc93bc1646176ba2e))
- Pick the HTML HMR API by the source's own module syntax ([9ac1c807](https://github.com/extension-js/extension.js/commit/9ac1c8076ab092c94c2c68a4d78f11dd700d4b87))
- Name the manifest shapes Chrome silently refuses at launch ([e94bd3ac](https://github.com/extension-js/extension.js/commit/e94bd3ac652553d42637dad555c7e5c1cc9b4c8f))
- Strip the UTF-8 BOM before the manifest read in emit-html-file ([87ddc2f5](https://github.com/extension-js/extension.js/commit/87ddc2f5855f7ea1cda76fa46e840c3d81f91fe1))
- Ignore watch paths by segment instead of substring ([be8d67f2](https://github.com/extension-js/extension.js/commit/be8d67f214a0c6ed1d2aa12dce25e2a04702aacb))
- Warn at launch on match patterns with query, fragment, or port ([ea841d70](https://github.com/extension-js/extension.js/commit/ea841d70220de570086e7e4ef171771fee6db10f))
- Diagnose Firefox-style MV3 background.scripts at Chromium launch ([782df586](https://github.com/extension-js/extension.js/commit/782df586bde16e68a5ec9fbb890cdb55a47466c7))
- Inject module.hot into script-parsed page scripts, not import.meta ([8cb2cd80](https://github.com/extension-js/extension.js/commit/8cb2cd80eb829cb677de8ff2bf6efec35acb3079))
- Keep import(chrome.runtime.getURL(...)) native in emitted bundles ([ed6e55e0](https://github.com/extension-js/extension.js/commit/ed6e55e03bb70ff269677bf557153e4e04a604d9))
- Ship the static import closure of runtime-traced modules ([8c470d5b](https://github.com/extension-js/extension.js/commit/8c470d5b144f9ae72cc6a53e7b4d8f1b9a75471a))
- Update messages-catalog snapshot for fatalManifestShapeFixed ([b47a5ee1](https://github.com/extension-js/extension.js/commit/b47a5ee15388f5c343434e405a55be092cad778a))
- Fail the build when an emitted content script does not parse ([b362b4da](https://github.com/extension-js/extension.js/commit/b362b4da027f3b0c5fb3fba11b051a58b1ce85cc))
- Honor exclude_matches in dev reinjection and re-registration ([43c1085f](https://github.com/extension-js/extension.js/commit/43c1085f0fa47ece8e59a3f9b7ad1f36ce2ead30))
- Keep dev reloads deliverable to idle MV3 service workers ([8ebf6137](https://github.com/extension-js/extension.js/commit/8ebf6137aaea6e62d582a98d1b48a09ac44bbcd0))
- Point css-only content_scripts groups at the emitted entry chunk ([f91fea21](https://github.com/extension-js/extension.js/commit/f91fea2192d7c820d9813fd2ad499ddea3ab7b37))
- Compare requested vs resolved dev-server ports numerically ([7415a637](https://github.com/extension-js/extension.js/commit/7415a637e01ccd6e402ee7832b09e9690e4449b6))
- Name the resolved browser binary and stop stale snapshot outranking ([e969338b](https://github.com/extension-js/extension.js/commit/e969338bc4773f1a8b75782406aa8c7ada4e4292))
- Survive Chromium 152 dev reloads and merge repeated feature switches ([6bd5f132](https://github.com/extension-js/extension.js/commit/6bd5f132108eef5a38a8824e99c77830dff4bf4d))
- Bound the telemetry audit log with a size-cap rotation ([74fbd2f3](https://github.com/extension-js/extension.js/commit/74fbd2f30580275ada2f8632f3ae66ab79970cef))
- Scaffold deno.jsonc and make the toolchain manifest-agnostic (#482) ([380df447](https://github.com/extension-js/extension.js/commit/380df447decbad018e41fe2005adaeb506cfb6dd))
- Persist the dev control port outside dist for SW resync (#484) ([1e244dba](https://github.com/extension-js/extension.js/commit/1e244dba32763f3302754c9e0cd4837608b6deaa))
- Classify dev reloads by chunk graph and clamp asset names to output dir ([602665e4](https://github.com/extension-js/extension.js/commit/602665e4158e9df8300c6df9f910733a2dfef6ad))
- Identify dev-server runtime modules by content, not require position ([52030431](https://github.com/extension-js/extension.js/commit/52030431f21141a0f4740a93900e76a85ec66876))
- Fall back to manifest directory when a project has no package.json ([7ce9fe4d](https://github.com/extension-js/extension.js/commit/7ce9fe4dcce0820e14d863b539a703d74967af99))
- Always rebuild bundled companion extensions; fix CDP port from --port 0 ([1c2c3819](https://github.com/extension-js/extension.js/commit/1c2c38197b7a6318cc3774552af725458480d3eb))
- Qualify content-script wrapper ownership by extension id ([2719d532](https://github.com/extension-js/extension.js/commit/2719d5327f652569a04f24d4748dfbcdfe6d1451))
- Trace chrome.runtime.getURL literal targets into dist ([f4dc68f6](https://github.com/extension-js/extension.js/commit/f4dc68f66d03ed28b30be5795984ec3c90d1266b))
</details>

## 4.0.7 (July 11, 2026)

### 🐛 Fixes

- Resolve PostCSS config string plugins project-first so CLI installs outside the project can load them ([bcde64e5](https://github.com/extension-js/extension.js/commit/bcde64e566dd6a20068329be917de77021ca6ad4))
- Resolve .env files family-wide and make undefined env vars safe ([f6751f35](https://github.com/extension-js/extension.js/commit/f6751f3533b917b20a36ffdc80046a1e26c407cf))

<details>
<summary>🧹 Other changes (8)</summary>

- Fail the build when manifest page surfaces (popup, options, overrides, devtools) point at missing files ([0dc7c5e0](https://github.com/extension-js/extension.js/commit/0dc7c5e0db0e18d526b53768d842494cbb5d43ad))
- Trace runtime-fetched package files into dist and keep executeScript tracing alive past multi-KB template literals ([4b231953](https://github.com/extension-js/extension.js/commit/4b2319534afffc5b1c8a8f69b0c108d3e4bd0a54))
- Confine project auto-install to the project dir and fall back to npm when the resolved package manager fails ([171f39e6](https://github.com/extension-js/extension.js/commit/171f39e6ac55186a6080dfd33302cb8f06223a80))
- Type ?inline stylesheet imports as asset/source so Vue custom-element styles resolve to CSS strings ([91300e97](https://github.com/extension-js/extension.js/commit/91300e976245feda60a223c18ac7fc364453ab48))
- Match link rel as a token list so shortcut icon assets stay static instead of becoming phantom stylesheet modules ([e417019c](https://github.com/extension-js/extension.js/commit/e417019cbd682955c6c3320990b0a800ff758ac3))
- Update all *-location dependencies ([ea5e976b](https://github.com/extension-js/extension.js/commit/ea5e976b419a2381f42703a6364da75b3ab82b5d))
- Concatenate classic multi-script HTML pages into one shared scope ([6e48adf3](https://github.com/extension-js/extension.js/commit/6e48adf3d428af4cea1f4edbf5ef80eb52efc902))
- Trace importScripts deps and executeScript file payloads into dist ([0af83fef](https://github.com/extension-js/extension.js/commit/0af83fefabaa8bf6342e43186c58e95bf0e0d68d))
</details>

## 4.0.6 (July 7, 2026)

<details>
<summary>🧹 Other changes (3)</summary>

- Fall back to any managed chromium-family binary when the requested chrome/chromium is missing ([986cea80](https://github.com/extension-js/extension.js/commit/986cea809e8c5d6c47075b026eda8f9e43f8d055))
- Cover chromium in install all and fall back to managed chromium-family binaries when dev's default chromium is missing ([23dae519](https://github.com/extension-js/extension.js/commit/23dae5196fcdf66a28ea0876843e8e182eb62e20))
- Update README.md ([a900b797](https://github.com/extension-js/extension.js/commit/a900b797edf4a9a89c2ab93dfcb90c2ebe4a378a))
</details>

## 4.0.5 (July 5, 2026)

### 🐛 Fixes

- Fix Safari extension-URL scheme in CSS url() and import.meta minification in vendored ESM chunks ([64f9582d](https://github.com/extension-js/extension.js/commit/64f9582d4f974633a126332120c39605cd06473e))
- Fix classic-concat content-script CSS/MV2 background emission and vendored UMD require build break ([1eea2546](https://github.com/extension-js/extension.js/commit/1eea2546732690ffddd881f63c85df6dec5ba79f))

<details>
<summary>🧹 Other changes (16)</summary>

- Compare path sets against rspack resources through one resolved toResourceKey ([2a561f3e](https://github.com/extension-js/extension.js/commit/2a561f3e17fa3177e9945738a39fe6098c1d7ea6))
- Pin swc rules to explicit javascript/auto so the project package.json type field cannot override browser-parity script-vs-module detection ([e6049ea6](https://github.com/extension-js/extension.js/commit/e6049ea614b9bb696b4c2d11550fa3ec0d6cb723))
- Tolerate UTF-8 BOM in all extension JSON parses and route preprocessor stylesheets as plain CSS when the preprocessor is not installed, matching Chrome loading ([dc523349](https://github.com/extension-js/extension.js/commit/dc523349d41727752ac8c9f5fc2150de224b1331))
- Announce dev reloads with one server-built context label across CLI stdout, the page devtools console, and the devtools pill, and self-heal stale cached service workers via a persisted control port and broker resync ([263ae3f3](https://github.com/extension-js/extension.js/commit/263ae3f376b76c3cf46da2ceb56e8f012cf3e49a))
- Lead npm and README metadata with the cross-browser extension framework positioning ([d4ae1d70](https://github.com/extension-js/extension.js/commit/d4ae1d706cb9b287b1aee2b762a6c31f67607276))
- Emit HTML static assets at their source paths so runtime references resolve like Chrome serves them ([0ff3dd65](https://github.com/extension-js/extension.js/commit/0ff3dd659d8989c49bc9d4e49d4a79e007b29d5b))
- Accept web_accessible_resources match patterns with ports and port wildcards that Chrome loads instead of failing the build ([da435151](https://github.com/extension-js/extension.js/commit/da435151408b43eb75053a86ecf60b155a1f7605))
- Parse page scripts as javascript/auto and force ESM only where the platform declares it (script type=module, module service workers) ([a52e2351](https://github.com/extension-js/extension.js/commit/a52e23510c83ab81bfa88229369c7e4b342488f9))
- Auto-detect script vs module in swc-loader so classic sloppy-mode content scripts build like Chrome loads them ([b58be88f](https://github.com/extension-js/extension.js/commit/b58be88f027a89e1974bb7da20867adbda625fe8))
- Skip PWA web-app manifests when resolving manifest.json and re-resolve to the real extension manifest instead of crashing on PWA-shaped fields ([f4f9392a](https://github.com/extension-js/extension.js/commit/f4f9392ab303f805235fe9a4e3811b5e380bf506))
- Warn and ship invalid CSS verbatim instead of failing the build, matching browser error recovery ([e941802e](https://github.com/extension-js/extension.js/commit/e941802e9f2892efa161b39b26767d55c9a23aef))
- Preserve in-project icon paths in the output instead of flattening to icons/<basename> so same-name icons stop colliding ([13459897](https://github.com/extension-js/extension.js/commit/134598979cba474266d7d22e51c5093d76a1f4aa))
- Emit a directory web_accessible_resources entry as its files plus a glob instead of crashing on EISDIR ([71f2f1e2](https://github.com/extension-js/extension.js/commit/71f2f1e2238384f2233540cebc9490439bc0987a))
- Drop scripts/ files the extension never references so data and generator helpers stop breaking builds ([ba2e8b81](https://github.com/extension-js/extension.js/commit/ba2e8b819eb9d2694b7155390e5bff7cb2f72e98))
- Emit both background keys when a manifest declares service_worker and scripts together instead of clobbering one to its raw path ([1a5dc025](https://github.com/extension-js/extension.js/commit/1a5dc025039c191b824aafda797131251f1360c6))
- Exclude Node build/dev tooling from the scripts/ special folder so it stops breaking builds ([e340a069](https://github.com/extension-js/extension.js/commit/e340a069c5d811518c28f31781aba6d531b9b03a))
</details>

## 4.0.4 (July 4, 2026)

### 🐛 Fixes

- Resolve bundled sass-loader and less-loader hoisted beside extension-develop so npx and exec builds find them ([59b8ba2e](https://github.com/extension-js/extension.js/commit/59b8ba2efb9d4736ba2513af2d300ab474d81bf5))

<details>
<summary>🧹 Other changes (1)</summary>

- Disable Preact fast-refresh so the rspack 2.x prefresh runtime stops crashing dev with module is not defined ([f6ded956](https://github.com/extension-js/extension.js/commit/f6ded9562f5cec21b254ee2dba2d9cc3561704d7))
</details>

## 4.0.3 (July 1, 2026)

### 🚀 Features

- Support named browser forks via engine-family manifest keys and build/launch path ([4238b13e](https://github.com/extension-js/extension.js/commit/4238b13ee9febce3bc06c24e6894a1c311c3d813))

### 🐛 Fixes

- Harden Firefox banner add-on id fallback to refuse ambiguous guesses ([7bec7177](https://github.com/extension-js/extension.js/commit/7bec7177b75debe30f7a2b0d0f15b452a0d56226))
- Resolve bundled CSS preprocessor loaders via rspack resolveLoader.modules instead of manual path resolution ([de2d360d](https://github.com/extension-js/extension.js/commit/de2d360d425bc1db3e01bf4d90c7ddb8e6322381))

<details>
<summary>🧹 Other changes (10)</summary>

- Drop four dead develop exports and rename the firefox follow-up to match its content ([118ae923](https://github.com/extension-js/extension.js/commit/118ae923d6710ca43368a66415a207788f0c165f))
- Rename the source-inspection dirs to cdp/ and rdp/, upgrade the firefox id follow-up ([9a54660b](https://github.com/extension-js/extension.js/commit/9a54660b4882f20baaea72ac336d043b8f876c51))
- Remove dead controller methods left by source-inspection and pair up chromium/firefox ([460bd49d](https://github.com/extension-js/extension.js/commit/460bd49d7380dc84de51cc03fb59e73bfaa4be52))
- Remove the unwired source-inspection feature ([6c75040d](https://github.com/extension-js/extension.js/commit/6c75040d6c8c8c3d53f7ef9d1bee6e24854ae957))
- Remove dead code across create, develop, and extension ([caa9be7a](https://github.com/extension-js/extension.js/commit/caa9be7a87208751f0fbbba76d9b2853639ecf05))
- Single-source optional-dependency install hints from bundled versions and drop dead signature helper ([d42fd629](https://github.com/extension-js/extension.js/commit/d42fd62976bc0c02d7a638dda799753dcc797b72))
- Make the not-emitted manifest guard version-aware instead of blaming incremental builds ([b3d77160](https://github.com/extension-js/extension.js/commit/b3d771601c360285e9eb914c2b3ed08adc55b67f))
- Bump bundled less to 4.6.7 to drop the errant 4.5.1 postinstall that trips build-script warnings ([c7e1c316](https://github.com/extension-js/extension.js/commit/c7e1c316dc916b68a459d3c1812b80b33339cb75))
- Detect the Deno runtime so scaffolds suggest deno install and deno task commands ([3eebf348](https://github.com/extension-js/extension.js/commit/3eebf3487bd00fa5e0882c64de1103402c6d97e1))
- Pre-approve dependency build scripts in scaffolds so install-once just works ([b0002f46](https://github.com/extension-js/extension.js/commit/b0002f464c4d4f0d2f5937f390753c7302dc64cd))
</details>

## 4.0.2 (July 1, 2026)

### 🚀 Features

- Add ci:test:create job so create specs run in CI ([4d3400fe](https://github.com/extension-js/extension.js/commit/4d3400feec94a04e60209df0a289ebc12b2883f3))

### 🐛 Fixes

- Resolve chromium manifest keys for Safari and unify the browser-key resolver ([f84e9e26](https://github.com/extension-js/extension.js/commit/f84e9e2662dae9c984e1f57273b1e7b1e48448c1))

<details>
<summary>🧹 Other changes (5)</summary>

- Explain where there other templates are hosted (#477) ([37a3bcb2](https://github.com/extension-js/extension.js/commit/37a3bcb2928a4ff601b03474d49ea8af42179ef7))
- Register a default background entry for Safari and version-less manifests ([49c1c4a3](https://github.com/extension-js/extension.js/commit/49c1c4a3b0b94c9d474a1d588ca5ca429c3cfded))
- Compile create before its tests and gate env-fragile install specs under CI ([981643cf](https://github.com/extension-js/extension.js/commit/981643cf74028e37e9e5138f5bfad5fe3888c2ec))
- Complete the init-alias create test so it actually imports the template ([8de32522](https://github.com/extension-js/extension.js/commit/8de32522006373ab6756134d965a9736043b1b41))
- Strip examples-repo scaffolding files from scaffolded projects ([bb37f9fe](https://github.com/extension-js/extension.js/commit/bb37f9fe6843c551476525321fbc9cf983cf4c13))
</details>

## 4.0.1 (June 30, 2026)

- **Extension.js v4, now on Node.js 22+.** Node 20 is no longer supported. There are no API changes: upgrade Node and your project keeps working.
- **Multi-file content scripts just work in dev.** Split a content script across plain files (a base class in one, the rest in another), saves now hot-reload without a restart, and a thrown error traces back to your real file and line instead of an inlined blob.
- **Snappier Safari dev.** `extension dev --browser=safari` resyncs in the background instead of blocking on a full Xcode build every save, and a burst of saves collapses into a single rebuild.
- **No leaked browsers.** A dev session that exits on its own now reliably shuts the browser down, no more Chrome or Firefox processes lingering after you're finished.

### 🚀 Features

- Add regression test for @rspack/plugin-react-refresh named export resolution ([900408dd](https://github.com/extension-js/extension.js/commit/900408ddcb5cca73b272b3bd799c0265a32ccae1))
- Expose FileConfig type at package level for extension.config.js (#468) ([001eba19](https://github.com/extension-js/extension.js/commit/001eba19a7afa167c4975f01f28a0317e44c4c55))
- Support @rspack/plugin-react-refresh v2 export shape and align the contract to 2.0.2 ([bad1016a](https://github.com/extension-js/extension.js/commit/bad1016a3185800ae67d3d07dea97a8328618c5d))
- Add v4 release highlights ([bee82be7](https://github.com/extension-js/extension.js/commit/bee82be795b01b95b0802eee5ae7f7ed60e390ca))
- Surface swallowed Chromium source-inspection failures through author-mode diagnostics ([94666631](https://github.com/extension-js/extension.js/commit/94666631fcbc716785a8c4487ff326ce69129a80))
- Surface swallowed locale-validation failures through author-mode diagnostics ([32aa3fce](https://github.com/extension-js/extension.js/commit/32aa3fce55fbc256fa8256ebbaa05f295345fd9b))
- add Brave, Opera, Vivaldi, Yandex, Waterfox and LibreWolf as browser targets ([857fe598](https://github.com/extension-js/extension.js/commit/857fe5983159e1a915694301b12249599d306ef6))
- Forward profile keep/copy options through the firefox launch request ([ec540bdd](https://github.com/extension-js/extension.js/commit/ec540bdd7a421113f8ed694e4ad32675197cec13))
- Forward copyFromProfile/keepProfileChanges from config through to the chromium and firefox launchers ([d38c7935](https://github.com/extension-js/extension.js/commit/d38c793562909f34d930a435fd2dcba298eea36a))

### 🐛 Fixes

- Override js-yaml, form-data, vite and read-yaml-file to clear dependabot security advisories ([998288da](https://github.com/extension-js/extension.js/commit/998288da32d028a50b372109dce308138316c0fd))
- Resolve CDP/RDP port per browser instance so a second instance cannot capture the first's port ([b004148b](https://github.com/extension-js/extension.js/commit/b004148b96ce94dbf6767f219731d1a4da6923f7))
- Fix theme additional_backgrounds array crash and chrome-extension:// CSS URLs ([74a94818](https://github.com/extension-js/extension.js/commit/74a948185648a8a3b91397911b94eb338c5bbaa0))
- Fix page-script top-level await and stop wrapping vendored *.min.js ([1ee3b09e](https://github.com/extension-js/extension.js/commit/1ee3b09e8d135f566baf59139d279f3df794c6ed))
- Fix WAR parity gaps w/ extension compiler ([5f9b9c6e](https://github.com/extension-js/extension.js/commit/5f9b9c6e96649d035ef96f50953cdd014d59df6a))

<details>
<summary>🧹 Other changes (44)</summary>

- Route isSubPath through the shared resource-path helper for cross-platform consistency ([8d8c9d13](https://github.com/extension-js/extension.js/commit/8d8c9d1333326beb5497463b2b7ec80a7dedcda4))
- Centralize resource-path canonicalization in a shared, cross-platform helper ([17ebd120](https://github.com/extension-js/extension.js/commit/17ebd120b2edb0725768714598fb4b7691f0289e))
- Match content-script loader include via canonicalized resource path for Windows ([8e12cc84](https://github.com/extension-js/extension.js/commit/8e12cc8486b460aaadc63391691f06378775b438))
- Canonicalize content-script resourcePath so wrapping works on Windows ([80905d61](https://github.com/extension-js/extension.js/commit/80905d61569e836225ccc14ea2439aac321458e5))
- Emit prefixed manifest entries for engine-family browser targets ([f55d9db8](https://github.com/extension-js/extension.js/commit/f55d9db88d9c375e3591481c130045047949ab95))
- Drop the duplicated command name from CLI usage strings ([86f9445e](https://github.com/extension-js/extension.js/commit/86f9445e63fb00ac258dabca9ae993715a88eb53))
- Use the launched Firefox RDP port verbatim instead of re-deriving it ([e7838e4b](https://github.com/extension-js/extension.js/commit/e7838e4b04d4d482f7aabf50248424a9b9423a8e))
- Run launched Firefox headless when MOZ_HEADLESS is set ([3a1a6cd3](https://github.com/extension-js/extension.js/commit/3a1a6cd32c4604885982f0e9ab68507bb447f2cc))
- Unify reload through the extension service worker for launched and `--no-browser` browsers ([1fe053c6](https://github.com/extension-js/extension.js/commit/1fe053c63780c69d0daf42b9308548e2bdcf149a))
- Reload content scripts under `extension dev --no-browser` and add a connectable host ([40488ad4](https://github.com/extension-js/extension.js/commit/40488ad4afb238421c41e1297906d7317555418b))
- Probe the dev server port on the configured host ([270d0d39](https://github.com/extension-js/extension.js/commit/270d0d39c14bd7b6e8b8c97b6fbbb76b7d26bb9d))
- Inherit chrome:/firefox: manifest keys for browser forks ([5192fbf3](https://github.com/extension-js/extension.js/commit/5192fbf3d65c9252e1195e0d82f9ba36ea2b3e53))
- Parse optional-boolean CLI flags so --flag false disables them ([65ca8cc1](https://github.com/extension-js/extension.js/commit/65ca8cc19f466038cb0075dfe73f0ed169b05b16))
- Update dependencies for Node 22 ([276d21f8](https://github.com/extension-js/extension.js/commit/276d21f82f5e85087c0033040632aa016188ca51))
- Drop Node 20: bump CI and engines.node to 22 so yarn installs resolve which@7 ([bf20ae12](https://github.com/extension-js/extension.js/commit/bf20ae12bd58c64cdb80e7a362d5ae481bfb3a28))
- Update message-catalog snapshot for the new firefox-reinject and chromium source-inspection messages ([7d55ba7a](https://github.com/extension-js/extension.js/commit/7d55ba7a688e94e1b18c99d9b59fb64701e14c02))
- Coalesce Safari dev packaging so saves resync in the background and bursts collapse to one rebuild ([f83de39f](https://github.com/extension-js/extension.js/commit/f83de39fe6976ff78f11917928f0b43691ee174a))
- Type the Firefox RDP wire boundary and client so wrong shapes fail the compile ([e88ea219](https://github.com/extension-js/extension.js/commit/e88ea219dbbac1281abc88b2e3088b53c0468851))
- Type the Chromium runner's CDP wire boundary so wrong-shaped protocol data fails the compile ([db0762ae](https://github.com/extension-js/extension.js/commit/db0762ae7528ffedc73604b74b11958466c60a59))
- Force-kill the browser synchronously on process exit via a shared teardown module ([64d25f99](https://github.com/extension-js/extension.js/commit/64d25f9987c7a91a67c7858b3d681a272963e157))
- Watch and source-map classic multi-file content scripts via a dedicated concat loader ([c2ab527c](https://github.com/extension-js/extension.js/commit/c2ab527c1ba30096592c2799f4e289428d09f9f1))
- Route Firefox runtime-reinjection failures through the messages convention with author-mode diagnostics ([44e60524](https://github.com/extension-js/extension.js/commit/44e60524a1959bb31b34333b8df4450cb31fc5c5))
- Exclude TypeScript declaration files from script entries ([60721065](https://github.com/extension-js/extension.js/commit/60721065392f0a2cd8680d97573cf05b96171908))
- Warn when building a Manifest V2 extension for a Chromium target ([dc6607f9](https://github.com/extension-js/extension.js/commit/dc6607f9e59949b8b57d1d998c920d204a9511a8))
- Concatenate and dedupe MV2 background.scripts output ([bc8eed3f](https://github.com/extension-js/extension.js/commit/bc8eed3f38b3f3b6917ad1f99d145c27a2b379d2))
- Concatenate classic multi-file content scripts so they share one scope ([d159734e](https://github.com/extension-js/extension.js/commit/d159734eff73a12c479c677a8934cdb8ebae8d1f))
- Pin which to ^4 so browser-location packages stay Node 20 compatible under yarn ([a13ccea4](https://github.com/extension-js/extension.js/commit/a13ccea48a70c752244c5ee64af0068af03fc898))
- Declare keepProfileChanges/copyFromProfile on BrowserConfig so the dev config typechecks ([e419c36c](https://github.com/extension-js/extension.js/commit/e419c36c2a9d899a8ef3719966dedcfbbecf58d7))
- reuse wsl-support package for generic WSL primitives ([83b0d7ec](https://github.com/extension-js/extension.js/commit/83b0d7ec82538b2d04e3ddce2b383c9f783ca974))
- Warn (don't fail) on missing CSS url() assets and pass the url through ([90d63e94](https://github.com/extension-js/extension.js/commit/90d63e942b9e7b9d20e9535f89b8f849f8bd2e0f))
- reuse prefers-yarn helpers in develop package manager ([1c0cfced](https://github.com/extension-js/extension.js/commit/1c0cfcedaf6677b6c46592fe5b1f3449166dbcad))
- import Compiler type explicitly in rspack config ([d35559e1](https://github.com/extension-js/extension.js/commit/d35559e18e9f5df4b47eea0962ea29806aa0dc82))
- reuse prefers-yarn for package manager detection in create ([5299b0c9](https://github.com/extension-js/extension.js/commit/5299b0c997c9087c7616c2fc7d4cca31ea302515))
- Relocate leading-slash icon paths to icons/ so the manifest matches the emitted files ([a96a67ed](https://github.com/extension-js/extension.js/commit/a96a67edfb4467ba7417bc952f1f05a82f5cf187))
- Seed copyFromProfile once so kept profiles are not clobbered on later runs ([b9feb056](https://github.com/extension-js/extension.js/commit/b9feb0561899e9afcbe83e37a124b6bf8b4f44c6))
- Update message-catalog snapshot for the new Safari resync messages ([a9bed2c4](https://github.com/extension-js/extension.js/commit/a9bed2c4e2f1fda96eaa5079c8e3225801207702))
- Type 41 manifest-shape casts to drop any so wrong-shaped manifests fail the compiler ([42baa1b2](https://github.com/extension-js/extension.js/commit/42baa1b2b89e7db5e3170bc5135026f553620e5f))
- Throw a readable PM-aware install hint for missing optional deps instead of a raw JSON blob ([68844f65](https://github.com/extension-js/extension.js/commit/68844f65f0ef80f17d88bb137b792ced3b673ddd))
- Honor profile:false, copyFromProfile and keepProfileChanges via shared resolve-profile ([7425b241](https://github.com/extension-js/extension.js/commit/7425b241b8f9fc3024c966860bf598b2f671f29d))
- Treat unknown chromium extension ownership as not-owned to avoid adopting foreign extensions ([af23a72e](https://github.com/extension-js/extension.js/commit/af23a72e66662655e9894059df1d75475d97f56f))
- Re-run Safari converter on manifest changes and preserve Xcode user settings on --force ([32534950](https://github.com/extension-js/extension.js/commit/32534950211ac97562b66f4fa7730477c79a3da9))
- Bump browser-extension-manifest-fields to ^2.2.5 ([a44d6563](https://github.com/extension-js/extension.js/commit/a44d6563231fb739a078f5b637e196972ca4f2b6))
- Emit theme image files (theme/images/<basename>) ([39898138](https://github.com/extension-js/extension.js/commit/39898138c4eb0921f59397f4d1ff12da6556dd7d))
- Exit non-zero when compilation errors prevent output ([e6f02acb](https://github.com/extension-js/extension.js/commit/e6f02acbf482df260390be30a66ca3e8d6580cda))
</details>

## 4.0.0 (June 30, 2026)

### 🚀 Features

- Add open action/command bridge triggers and fix Firefox extension loading (RDP addons actor cache, background producer injection, service_worker→scripts) ([52b1f837](https://github.com/extension-js/extension.js/commit/52b1f8376bd5aa2c64f863ebc3d97deb637c840a))

### 🐛 Fixes

- Fix smoke:npx for workspace specifiers and wire it into CI as a packed-tarball guardrail ([c5c9bb84](https://github.com/extension-js/extension.js/commit/c5c9bb84af4d9258d61c56ddf404a476289e5b4f))

<details>
<summary>🧹 Other changes (3)</summary>

- Delete dormant feature-resolve and drop @swc/core and magic-string ([289e3813](https://github.com/extension-js/extension.js/commit/289e3813aa91a5ace06d9f821244b9e1e8c169a5))
- Use es-module-lexer instead of @swc/core for content-script default-export detection ([fd24539b](https://github.com/extension-js/extension.js/commit/fd24539b2061b75c875d59de68462d8de41fab4b))
- Remove dead dependencies from extension-develop (cross-spawn, unique-names-generator, loader-utils, @swc/helpers) ([319d75fb](https://github.com/extension-js/extension.js/commit/319d75fb9626dac1560acde8681f71ba269ccd7f))
</details>

## 3.18.0 (May 28, 2026)

### 🚀 Features

- Surface real CDP port into ready.json for out-of-process source inspect ([4e330926](https://github.com/extension-js/extension.js/commit/4e330926e67fe4e48cd64ee7fd3f957bb55e6ee5))
- Add the extension publish command for a shareable url ([e9d05b23](https://github.com/extension-js/extension.js/commit/e9d05b232fcbffccadda09126dc6c50bc19b62ce))
- Inspect extension surface dom through the in bundle relay ([71ee1337](https://github.com/extension-js/extension.js/commit/71ee1337234727660475115028a83d7014b329cf))
- Add the agent bridge act and inspect slices with multi context logs ([2260504d](https://github.com/extension-js/extension.js/commit/2260504d15b803a33409fe1dfa0139dd6ce4e6b7))
- Add the extension logs command to read and stream the bridge ([aed9c018](https://github.com/extension-js/extension.js/commit/aed9c018ccabb54ec5976e888e89bb3ac3d3dedc))
- Add the agent bridge consumer client and ready contract reader ([aaaf0fdb](https://github.com/extension-js/extension.js/commit/aaaf0fdb1ec113678231b65aa646fac952ded259))
- Forward background console output over the control websocket ([2961f7d9](https://github.com/extension-js/extension.js/commit/2961f7d9c8fd5c2b1dd978f7fff61aed61ab52c4))
- Add the agent bridge slice 1 control websocket broker and log file ([6735edcb](https://github.com/extension-js/extension.js/commit/6735edcb5a58b7f3a89b13acad176235b6eadea2))
- Add CI lint/typecheck gate, readiness schema, producer tests, and reload-matrix smoke ([4b8d5782](https://github.com/extension-js/extension.js/commit/4b8d57824c87b3b09bab5224265389716981f2bf))
- Enhance zip download mechanism ([11ebfa83](https://github.com/extension-js/extension.js/commit/11ebfa8334a4569fd1e3855b0d6433d77d7f4fdf))
- Bundle default `create` template, fix package-manager detection and network timeouts ([aafc2ac3](https://github.com/extension-js/extension.js/commit/aafc2ac3b01d7c49ea1fad14a71ce349d793730f))
- Add (alpha) Safari target support and Chromium/Firefox runner hardening ([9e522d03](https://github.com/extension-js/extension.js/commit/9e522d0353a826c13bd736ffa027bfe43fe99865))

### 🐛 Fixes

- Bump ws to ^8.20.1 to patch GHSA-58qx-3vcg-4xpx ([23a19ca7](https://github.com/extension-js/extension.js/commit/23a19ca7727faebbd281685f9f6915d01f6ed212))
- Restore the @rspack/dev-server@2.0.2 SCAFFOLD_OVERRIDES workaround ([b804721a](https://github.com/extension-js/extension.js/commit/b804721ac5db4a15e1cfb711f88e357e4f5f4a8a))
- Ensure `build` also produces the extension.d.ts file ([1b7632de](https://github.com/extension-js/extension.js/commit/1b7632decca77bfbd07c82d57b0b9d5e6f670667))
- Fix the three CI failures revealed once the lockfile was synced ([ecb2049e](https://github.com/extension-js/extension.js/commit/ecb2049e4d8ca4e180859afca5434f137a219390))

<details>
<summary>🧹 Other changes (11)</summary>

- Raise perf-budget defaults to 512/512/1024 KiB ([a4ff2fc6](https://github.com/extension-js/extension.js/commit/a4ff2fc6b50bffd418d7b1b4899c73b23417c78b))
- Drop the scaffold-overrides workaround for the @rspack/dev-server 2.0.2 break ([461cf571](https://github.com/extension-js/extension.js/commit/461cf571fb45cc0007e063fbdb9b45900f0bd472))
- Remove the implemented readiness design docs ([c01a93a0](https://github.com/extension-js/extension.js/commit/c01a93a076325cfd0249c44848b16329932d1c45))
- Snapshot the 21 messages.ts catalogs (readiness item 5c) ([87e13f20](https://github.com/extension-js/extension.js/commit/87e13f207da4120f594f38001b947dc404c9a890))
- Remove the implemented agent bridge and distribution design docs and fix code comments ([0d0b5b21](https://github.com/extension-js/extension.js/commit/0d0b5b21794c4915a6f251a0747d03ebc20836b9))
- Pierce closed shadow roots in dev source deep dom ([c0d6c1fd](https://github.com/extension-js/extension.js/commit/c0d6c1fd8b19ba7b36a714122a8d4cc3561b7f9b))
- Declare the ws dependency for the control bridge ([39479255](https://github.com/extension-js/extension.js/commit/39479255ae8b8c889f2e5a51c2d088f77c05281f))
- Declare webpack devDep in develop so typecheck gate resolves the vendored HMR fork ([64e91887](https://github.com/extension-js/extension.js/commit/64e91887beda382db3ff12d0f6e4a9124e471d66))
- Unify package-manager detection across yarn and bun ([bbc52839](https://github.com/extension-js/extension.js/commit/bbc52839f5b1824ecaac9996ea34f88f9241d7f9))
- Review cleanup of extension package ([0b5fbe2d](https://github.com/extension-js/extension.js/commit/0b5fbe2d5e0824227ea8bd603b7137c1d284af47))
- Develop plugin review cleanup, hardening, and browser process shim ([48fb056a](https://github.com/extension-js/extension.js/commit/48fb056a51126b6b7c2482035cf706d421441e8d))
</details>
## 3.17.0 (May 21, 2026)

### 🐛 Fixes

- Bump svelte to 5.55.9 to clear Dependabot XSS advisories ([348df897](https://github.com/extension-js/extension.js/commit/348df897cbf07a60567f5a91fb99e99d8706d63e))

<details>
<summary>🧹 Other changes (2)</summary>

- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash ([29a91d44](https://github.com/extension-js/extension.js/commit/29a91d444a517d6cc0fce300678e9c99c7b48c07))
- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash ([eec11486](https://github.com/extension-js/extension.js/commit/eec1148685e0177832f1cbb3401058368a149488))
</details>
## 3.16.1 (May 14, 2026)

### 🐛 Fixes

- Bump fast-uri to ^3.1.2 to clear Dependabot path-traversal + host-confusion advisories ([c27cc05e](https://github.com/extension-js/extension.js/commit/c27cc05e2abe2b9ee497abe885de50aa2f0789aa))
- Sweep orphan content-script roots and ignore current-build roots in cleanupKnownRoots ([a3d58a3e](https://github.com/extension-js/extension.js/commit/a3d58a3eb8755667e46210243be7cef2c9949796))
- Gate devtools overlay at content-script entry and harden launcher UX ([fc785bb3](https://github.com/extension-js/extension.js/commit/fc785bb3487d018bed25671d46e3abea824d2a8e))
- Gate devtools overlay at content-script entry and harden launcher UX ([22ec2a57](https://github.com/extension-js/extension.js/commit/22ec2a57e313775b2c54c859cb479feb38931d92))

<details>
<summary>🧹 Other changes (5)</summary>

- Replay programmatic chrome.scripting.executeScript calls on /scripts/* edits ([e97f8fb3](https://github.com/extension-js/extension.js/commit/e97f8fb3f82fc1956fa428194fe9712445a5f189))
- Only warn for genuinely new files in pages/ and scripts/, not modifications ([223b0f78](https://github.com/extension-js/extension.js/commit/223b0f786410503c6ec77e6bc536fc9943da4be3))
- Auto-resolve workspace subpackage when extension dev is given the monorepo root ([e7995aa4](https://github.com/extension-js/extension.js/commit/e7995aa414f1327c33d0129321231d8352f3b024))
- Honor namespaced manifest_version in SetupBackgroundEntry default background entry ([119a68ae](https://github.com/extension-js/extension.js/commit/119a68aea2a8ea3162ac46df6106710578ff3565))
- Derive Chromium extension ID from load path when no manifest key + no runtime target ([7d26b942](https://github.com/extension-js/extension.js/commit/7d26b942a52e4711dd69936f628ebe85291c2ceb))
</details>
## 3.16.0 (May 7, 2026)

<details>
<summary>🧹 Other changes (6)</summary>

- Ignore benign socket teardown errors in browser process handlers (Templates Nightly Edge ECONNRESET) ([e98f46db](https://github.com/extension-js/extension.js/commit/e98f46db9d66006d3f6889bd767886fdb9605740))
- Force-exit optional-deps smoke after main() so Linux orphans don't hang the CI step ([9016ab0f](https://github.com/extension-js/extension.js/commit/9016ab0f90959bf40c809cd178ef2e619610c26e))
- Compile extension-develop before vitest so dist-shape spec has artifacts ([31650b38](https://github.com/extension-js/extension.js/commit/31650b38e4823e30bcba6256711b871cf4454a9e))
- Scope ESM banner to Node-side bundles and add regression gates ([a455f615](https://github.com/extension-js/extension.js/commit/a455f615d575a09f5406e408d0666c43651aed16))
- Flip extension-develop to ESM output for @rspack/core@2 compatibility ([fb0cd269](https://github.com/extension-js/extension.js/commit/fb0cd269c6f62db2a1e8c27d7b9e24e91e10e357))
- Update WASM example link in README ([0055ae96](https://github.com/extension-js/extension.js/commit/0055ae9655b09fd8d20f37d26b1e4e2f885747db))
</details>
## 3.15.1 (May 5, 2026)

### 🚀 Features

- Add regression test for PreactRefreshPlugin preactPath option ([ea87fcfc](https://github.com/extension-js/extension.js/commit/ea87fcfc26061fb970191c9daac64bc967e72693))
- Add regression tests for module-context-resolve project-package fallback ([df9d3a66](https://github.com/extension-js/extension.js/commit/df9d3a66285116a95c929bf28a47c72e1323c355))
- Add remote-mode and template-name fixture resolution to reload-matrix harness ([d0c88ffe](https://github.com/extension-js/extension.js/commit/d0c88ffe897f77e10fa0839cafe696250c958666))

### 🐛 Fixes

- Stop firing chrome.runtime.reload for page-only edits in non-content-script extensions ([8316ee9a](https://github.com/extension-js/extension.js/commit/8316ee9a26f41dc5136860113c3d554f660acdeb))

<details>
<summary>🧹 Other changes (14)</summary>

- Update preact.spec assertions to match package-directory preactPath ([82255072](https://github.com/extension-js/extension.js/commit/82255072798c43e18bf975699653cc9cf9cd835a))
- Pass preact package directory to PreactRefreshPlugin (not entry file) ([8d734122](https://github.com/extension-js/extension.js/commit/8d734122295ae14b7fe8d04adc09f9ecd6a5c42c))
- Pass project preact path to PreactRefreshPlugin for pnpm strict layouts ([ed63656c](https://github.com/extension-js/extension.js/commit/ed63656c2810152bb314659f0da801b7762e3015))
- Raise content-script perf budget to 256 KiB for framework templates ([0870bd01](https://github.com/extension-js/extension.js/commit/0870bd01bf12fb6f060bfeb7eb5e8c623512f55c))
- Apply project-package fallback to module-context-resolve rules ([e114e58e](https://github.com/extension-js/extension.js/commit/e114e58ef2ded1cd2e5788de916e979d12a802f6))
- Trust project package.json when pnpm symlinks hide the contract dep ([8b6aeeea](https://github.com/extension-js/extension.js/commit/8b6aeeeabb2efac4f333fa956ffa18a86020c8b1))
- Suppress executionContextCreated burst on watched-session attach ([b72a86ef](https://github.com/extension-js/extension.js/commit/b72a86efe05479a62b5274eaa66d4e1cbcdc1b70))
- Preserve sibling content_scripts entries during dev reinject ([ae68669b](https://github.com/extension-js/extension.js/commit/ae68669b3622f6b4343e5856caabbef1ae0ce787))
- Inline content-script CSS as data URLs to close the WAR gap on rspack 2.x ([1d622e69](https://github.com/extension-js/extension.js/commit/1d622e69d835b6a77a15f5cc45000dbde6eadb90))
- Relocate reload-matrix harness to _FUTURE/examples per workspace convention ([e07736af](https://github.com/extension-js/extension.js/commit/e07736af095c48184303fec574052532eed6f265))
- Extend reload-matrix harness with multi-scenario runner and 5-row matrix ([bd7f3607](https://github.com/extension-js/extension.js/commit/bd7f3607ddb38f8f40f47ce65362246f5cab8a53))
- Scaffold reload-matrix CDP harness for ground-truth reload measurement ([44e7355c](https://github.com/extension-js/extension.js/commit/44e7355c9a4bb3f9238a970f70141defe0bd8fc7))
- Revert "Serialize and coalesce reload requests at the controller boundary" ([5587de61](https://github.com/extension-js/extension.js/commit/5587de612c5e30568225af184c8e8f1d57c48278))
- Serialize and coalesce reload requests at the controller boundary ([b6145e2d](https://github.com/extension-js/extension.js/commit/b6145e2deda9e7f08d9f9e248c7d929f2a4144ab))
</details>
## 3.15.0 (May 4, 2026)

### 🚀 Features

- Add per-category perf budgets tuned for browser-extension workloads ([bcbb134c](https://github.com/extension-js/extension.js/commit/bcbb134c49d6dcc7f56f840ed2e0d86a076431a0))
- Add script to inventory perf warnings across _FUTURE example builds ([dffab714](https://github.com/extension-js/extension.js/commit/dffab714a3b6512c26b7efda91551bc10402bb2d))

### 🐛 Fixes

- Prevent companion extension duplication ([33779d42](https://github.com/extension-js/extension.js/commit/33779d424a4c6dfd7805beb7e4573ab356d6573e))
- Stop installing unused firefox/chromium in cli CI suite to dodge snap hang ([b42c0756](https://github.com/extension-js/extension.js/commit/b42c0756af1862eb30fa19ff3c1551c624e9276b))
- Fix nightly CI template builds and the playwright-core resolution ([c41a33e4](https://github.com/extension-js/extension.js/commit/c41a33e474ea50ccd598a65bc481328df8495e94))
- Stop devtools companion from toggling user extension via chrome.management ([fc9c9f8d](https://github.com/extension-js/extension.js/commit/fc9c9f8d9546f9f382fde7851a4a5092ade8b896))
- Resolve _locales at the project root and reject manifest-dir layout ([17d18461](https://github.com/extension-js/extension.js/commit/17d1846152c24f6b69bbb09b09bab429edf341df))
- Fix manifest/SW/locale reload classifier and lock companion-targeting in tests ([ce32aa19](https://github.com/extension-js/extension.js/commit/ce32aa199e83fbfbb48e050ac529987f7179ba1a))
- Stop passing chromium-only flags to Firefox launch ([4756dc6b](https://github.com/extension-js/extension.js/commit/4756dc6b9c62d017636c6c578a15be56592ccfdc))
- Gate chromium-only background listeners in extension-js-devtools ([e1672a0c](https://github.com/extension-js/extension.js/commit/e1672a0cd4595c64a33028b0a011e0c578af182b))
- Stop manifest icons diff from firing spuriously on every rebuild ([bf43019d](https://github.com/extension-js/extension.js/commit/bf43019d22778843566e070ca43ba4b79ed41575))
- Fix bad output of the (re)compilation banner ([9059c8c1](https://github.com/extension-js/extension.js/commit/9059c8c167c6a64dbe37d7e5abd4e8ba4b5cf9de))
- Stop extension-develop resolver from escaping node_modules into outer monorepo ([c514d2db](https://github.com/extension-js/extension.js/commit/c514d2db2fef2d4649a955705b4730340bd6dfe5))
- Fix HTML live-reload regression on rspack 2.x and lock the contract in tests ([bc0a741f](https://github.com/extension-js/extension.js/commit/bc0a741fa19025f3ecffee42a555ff26df6fe74f))
- Restore content-script wrapper in production to keep mount call alive ([ce552c5e](https://github.com/extension-js/extension.js/commit/ce552c5eb9ac163edba521483d04be343902727f))

<details>
<summary>🧹 Other changes (21)</summary>

- Fire chrome.runtime.reload() once per save instead of N times racing on the eval response ([cdc6504c](https://github.com/extension-js/extension.js/commit/cdc6504c9222f13167b027a31c1965b00f56260d))
- Anchor relative profile paths to the rspack context so sequential examples do not share one profile ([950c7e60](https://github.com/extension-js/extension.js/commit/950c7e6057f6d8c6f262ca1520bb06823862ce31))
- Bump browser-extension-manifest-fields ([9fbaeb31](https://github.com/extension-js/extension.js/commit/9fbaeb31361c2b13a11b016fa3884b07e5273452))
- Pick user extension over companion when version + manifest_version tie ([617e532e](https://github.com/extension-js/extension.js/commit/617e532e22e2b6a8dc0cd1446adc39963335fe78))
- Compile extension CLI on demand from companion Firefox MV3 spec ([de77cfa4](https://github.com/extension-js/extension.js/commit/de77cfa4c252672edc54edeb92a600bc186f3546))
- Update README.md ([f2af9b43](https://github.com/extension-js/extension.js/commit/f2af9b43af717f4d987f608910992c5cea0a9276))
- Dedupe extension load list and ignore companion shadows of built-in packages ([a1c7f786](https://github.com/extension-js/extension.js/commit/a1c7f786b201887be114eb25721f9977398bc184))
- Skip dependency install in web-only mode to fix extension dev crash on Chrome samples ([98bf0d71](https://github.com/extension-js/extension.js/commit/98bf0d71617ef127e4f0611bde2bf152340d49c3))
- Rework README with growth-oriented hero, comparison table, and ship-to-store guide ([db13deb3](https://github.com/extension-js/extension.js/commit/db13deb355c03af87a8467418b9e1bc57f2e1559))
- Lock in companion-extension Firefox bundle as MV3-API-free ([9ad8c21e](https://github.com/extension-js/extension.js/commit/9ad8c21ec224bcb9e4165592846d6d0feb463f21))
- Force single Playwright worker to eliminate content-reload spec race ([d20a36eb](https://github.com/extension-js/extension.js/commit/d20a36eb0dd1a6854f7bf4d2b2546da784eb4c51))
- Hold firefox apt package so --with-deps does not trigger snap install ([db02d659](https://github.com/extension-js/extension.js/commit/db02d6591b98fed87bee6e999028641194a8c77d))
- Soften strict _locales layout policy from build error to warning ([121b6526](https://github.com/extension-js/extension.js/commit/121b65268a9b67a9a6e748b7efa42f77330bc263))
- Mark generated templates/package.json as ESM to keep spec imports working ([80636fb3](https://github.com/extension-js/extension.js/commit/80636fb34904f399332cb7891161b41fa00dae5c))
- Teach perf-warning inventory to parse the new PerfBudgetWarning block ([d4412c6b](https://github.com/extension-js/extension.js/commit/d4412c6bc019495f71ce85146178a5e736a11427))
- Discriminate page vs content errors in devtools dialog by script origin ([706b48b7](https://github.com/extension-js/extension.js/commit/706b48b7c9c71960b086c8e16eb1184824b8145d))
- Pick newest content-script bundle by mtime so reload reflects latest rebuild ([bed5de5f](https://github.com/extension-js/extension.js/commit/bed5de5faa8bd7190af307735a9ee2e2ae034750))
- Make Firefox welcome tab open reliably on first run ([06618883](https://github.com/extension-js/extension.js/commit/066188832b4429d27b2eafc422c7359de9c81829))
- Normalize watch path separators in dev-server config spec for Windows CI ([0477981e](https://github.com/extension-js/extension.js/commit/0477981ea07671b93305a5d4c12a5842b632d7b0))
- Normalize watch path separators in dev-server config spec for Windows CI ([0640d592](https://github.com/extension-js/extension.js/commit/0640d59219d9870a2a4131b8148acc114b4ce4ac))
- Drop dist-build dependency from minimum-script-file/preact-refresh-shim specs ([573756e3](https://github.com/extension-js/extension.js/commit/573756e3ad3c357b3d2101d0c25b8f57f85ba2a8))
</details>
## 3.14.5 (April 25, 2026)

### 🐛 Fixes

- Resolve CJS requires via the `require` exports condition (#445) ([4e91fddf](https://github.com/extension-js/extension.js/commit/4e91fddf8f24a83b22c8c35e3713983e9b596e5d))
## 3.14.3 (April 24, 2026)

### 🚀 Features

- Add content-script reload regression tests ([2a1c8d81](https://github.com/extension-js/extension.js/commit/2a1c8d81387ec50c3908f3afdbbe0bfe10a9f67e))

### 🐛 Fixes

- Restore the per-rebuild "compiled successfully" stdout line in browser-launch mode ([497c870c](https://github.com/extension-js/extension.js/commit/497c870cb520e67e11f7838a0d1839cdbb8a8c57))
- Fix content-script hot reload ([b1a14a3d](https://github.com/extension-js/extension.js/commit/b1a14a3df25cc6dc29adf294754efd3921d5dcd1))

<details>
<summary>🧹 Other changes (3)</summary>

- Pin uuid >=14 to close Dependabot alert 143 ([e3b2a078](https://github.com/extension-js/extension.js/commit/e3b2a0782495296056cb9f5eb50f7273f7be073d))
- Cover fresh tabs and page reloads for content-script edits ([b22c93c0](https://github.com/extension-js/extension.js/commit/b22c93c0786b513ff1d12d87645dd6a6e412c044))
- Scope browser-root auto-attach to extension targets, silence debugger infobar ([469deaae](https://github.com/extension-js/extension.js/commit/469deaae1bb94b734193a72d41dc56b2546c452c))
</details>
## 3.14.2 (April 22, 2026)

### 🚀 Features

- Forward extension.config.js browser/command fields to the browser launcher ([24ed2da6](https://github.com/extension-js/extension.js/commit/24ed2da6bfafa882c492a76c58c40efbea54805b))
## 3.14.1 (April 22, 2026)

### 🚀 Features

- Surface reserved-folder diagnostic for Node.js scripts dropped into scripts/ ([e114f6d6](https://github.com/extension-js/extension.js/commit/e114f6d6aff69b91ae291d5fe37545717a7f8855))

<details>
<summary>🧹 Other changes (1)</summary>

- Disable module concatenation in dev to fix react-refresh __webpack_module__ clash ([0e02429d](https://github.com/extension-js/extension.js/commit/0e02429d1722f91a1883ee16ff507f3164c6b83d))
</details>
## 3.14.0 (April 21, 2026)

<details>
<summary>🧹 Other changes (4)</summary>

- Drop ?url query bypass in CSS loaders, add end-to-end regression spec ([38553e95](https://github.com/extension-js/extension.js/commit/38553e956f9e4f670e18404bcf920b4923a10243))
- Pin @rspack/dev-server to ^1.2.1 until @rspack/core 2.x ships stable ([4b206af6](https://github.com/extension-js/extension.js/commit/4b206af676c39f5a8ee1b2e85f60538871327530))
- Default --install to off on extension create ([c8459498](https://github.com/extension-js/extension.js/commit/c8459498a5729459d60f5335ea7e1986e0410b73))
- Collapse CLI telemetry to 2 events with sampling, cap, and dedup ([fe9bbf9c](https://github.com/extension-js/extension.js/commit/fe9bbf9c45adc35eeba5b6ea15abd0e05352cf07))
</details>
## 3.13.5 (April 11, 2026)

### 🐛 Fixes

- Fix --port 0 (OS-assigned port) crashing the dev server ([2043b377](https://github.com/extension-js/extension.js/commit/2043b377f8427d7b31884ebfccb77594b43fcd23))
## 3.13.4 (April 11, 2026)

### 🐛 Fixes

- Fix user project dependency resolution for pnpm dlx and npx builds ([328ee7e8](https://github.com/extension-js/extension.js/commit/328ee7e8df9cfdef0796a949af699185fb8ebe27))

<details>
<summary>🧹 Other changes (1)</summary>

- Respect --install flag to skip dependency install in build/dev commands ([16b1436e](https://github.com/extension-js/extension.js/commit/16b1436e4c7e499b919ba465596523f0f10b7f57))
</details>
## 3.13.3 (April 11, 2026)

### 🚀 Features

- Add browser spec tests for CDP and RDP transport layers ([1e5152e8](https://github.com/extension-js/extension.js/commit/1e5152e89ddda4708cf868adc82c56ca4001cdc4))

### 🐛 Fixes

- Fix release pipeline changelog filters and apply lint formatting ([8f7e91fa](https://github.com/extension-js/extension.js/commit/8f7e91fa40c7f46b904e5240f3009a230fe4769c))
- Fix stale programs/cli path in first-dev smoke script ([15ad079d](https://github.com/extension-js/extension.js/commit/15ad079d05931b8e61ce3ea424d376619e2098aa))
- Harden browser CDP/RDP reliability and observability ([27de553e](https://github.com/extension-js/extension.js/commit/27de553ef34dcd1890434e52985e59ab222ced2e))

<details>
<summary>🧹 Other changes (2)</summary>

- Remove dead code, extract shared utilities, fix signal race, simplify core plugins ([a4eac350](https://github.com/extension-js/extension.js/commit/a4eac350f410cecfc362932860fb63588c275461))
- Make extensionCreate API/AI-friendly with injectable logger and structured result ([d570a5c7](https://github.com/extension-js/extension.js/commit/d570a5c794dbe8364dd0f49e011464bd1b9ca424))
</details>
## 3.13.0 (April 9, 2026)

### 🚀 Features

- Add Linux CI Chromium sandbox flags for CDP dev tooling ([b70058d7](https://github.com/extension-js/extension.js/commit/b70058d77c411d2d5462322c5dcc214f8c7224c6))
- Add BuildEmitter event API to extension-develop ([cc8e1536](https://github.com/extension-js/extension.js/commit/cc8e15368f5ae959376cedc702123769a1f851c3))
- Add lightweight preview entry to develop for fast extension preview ([36c9690c](https://github.com/extension-js/extension.js/commit/36c9690cceab43da83931a6186244cf53861c3c5))

### 🐛 Fixes

- Resolve release notes range when stable tag is off current branch ([48ea5e4a](https://github.com/extension-js/extension.js/commit/48ea5e4ae2b31e112726c81e14be8d384c536fe1))

<details>
<summary>🧹 Other changes (3)</summary>

- Remove extensionStart from develop. CLI now orchestrates build + preview ([49ecba42](https://github.com/extension-js/extension.js/commit/49ecba4265c1e4f0fbe5a6d010f940673db9c323))
- Orchestrate start command with separate build + preview calls ([ef18e190](https://github.com/extension-js/extension.js/commit/ef18e19033b2e9e38e3451ba406dc794f64cea05))
- Optimize GitHub Actions workflows for faster CI ([9226a385](https://github.com/extension-js/extension.js/commit/9226a3851c64ba81a5eeb8ce895091502bb40168))
</details>
## 3.12.1 (April 9, 2026)

### 🐛 Fixes

- Fix CDP race condition, log leak, globalThis state, and MAIN world manifest persistence ([5ab401b0](https://github.com/extension-js/extension.js/commit/5ab401b0a6d663ca5f6c551b03e52cb2112856a2))
## 3.12.0 (April 9, 2026)

### 🐛 Fixes

- Fix CVE-2026-22028 preact VNode injection and CodeQL code sanitization alert ([9bdddd59](https://github.com/extension-js/extension.js/commit/9bdddd5901c91f67c6ed7b4577140f837f0fd793))
- Fix CodeQL Firefox inspection and harden dev-server client resolution ([7e53197e](https://github.com/extension-js/extension.js/commit/7e53197e9f1783b5a96baf1148d1c76739cd0e81))
- Resolve HMR client paths from extension-develop at injection time ([86afa678](https://github.com/extension-js/extension.js/commit/86afa678d70e821386110dae0b2268fdc63269cb))

<details>
<summary>🧹 Other changes (8)</summary>

- Default create template to javascript and make template option optional ([faa7e4fe](https://github.com/extension-js/extension.js/commit/faa7e4fef0615c443215516903d5ec8526718f73))
- Use workspace:* for extension dev dependency ([993866f8](https://github.com/extension-js/extension.js/commit/993866f850c7dde024acb7e3c527d13a38bd3ef1))
- Remove isolated-deps and bundle extension-develop toolchain ([8ec8bba3](https://github.com/extension-js/extension.js/commit/8ec8bba373bb57bf2ff4bdb218a88dd8b69062be))
- Use geometric triangle prefix for signature log lines across CLI and webpack ([8ae1b405](https://github.com/extension-js/extension.js/commit/8ae1b405e2688319c86f78e0952a03c324bd4dc0))
- Update Vite/Vitest ([cbab3b5d](https://github.com/extension-js/extension.js/commit/cbab3b5dfcf3ec8141b0eb8ff75a22d298d0ddb2))
- Normalize path separators in HMR entry assertions for Windows ([03386dc6](https://github.com/extension-js/extension.js/commit/03386dc6764d16bc0ff6f86dc22fcc97b141c760))
- Bump go-git-it to 5.1.5 ([f57d3758](https://github.com/extension-js/extension.js/commit/f57d37588a57113c86a5f770255280898a4ad4f5))
- Show Firefox add-on ready line in dev and align ready copy ([680d5feb](https://github.com/extension-js/extension.js/commit/680d5feb4763147054cb21b2b80161a385e6be99))
</details>
## 3.11.1 (April 8, 2026)

### 🚀 Features

- Add strip and remove dev server runtime from content script bundles ([0b6f801c](https://github.com/extension-js/extension.js/commit/0b6f801c6f988f1b8e537f846a8f8265929cdb72))
- Add canonical content script naming contracts and entry helpers ([d190c9a8](https://github.com/extension-js/extension.js/commit/d190c9a8b05d7cfe1db4387970c33f794a6806db))

### 🐛 Fixes

- Fix CI workflow script name and Windows path double-slash normalization ([39a8f771](https://github.com/extension-js/extension.js/commit/39a8f771eb76c7e5f6312551c6393d28cea5b494))
- Fix pre-existing test failures in dev-server and update-manifest specs ([f27c7115](https://github.com/extension-js/extension.js/commit/f27c7115314418fb17da87087471cbd7f61ee0fd))
- Fix Firefox content reload parity with Chromium ([38283c85](https://github.com/extension-js/extension.js/commit/38283c8579e63dfd7e1c10166003446f04a4c298))
- Fix Chromium content reload: suppress manifest reason, reload extension after reinject, await controller ([015d8910](https://github.com/extension-js/extension.js/commit/015d8910fcbfcf77b068f9abf8c9c1baec5ecc89))
- Resolve hashed content script filenames in CDP controller for reinject ([7cc29886](https://github.com/extension-js/extension.js/commit/7cc29886e34da12659458af8aa4d730f4c48df17))

<details>
<summary>🧹 Other changes (10)</summary>

- Ignore programs/create/.npmrc so local npm tokens are never committed ([9d009481](https://github.com/extension-js/extension.js/commit/9d0094814afa28aab49bd99172919d03ead7136d))
- Normalize Windows drive slashes after backslash replace ([5c8c09fd](https://github.com/extension-js/extension.js/commit/5c8c09fd2a7d904298b6c9579ee17aa8143bbac0))
- Replace in-tree optional-deps installer with isolated-deps package ([d2c48e01](https://github.com/extension-js/extension.js/commit/d2c48e01a561cf581574a57d9c3481650cefcf2b))
- Simplify reload internals before release ([ce391cbd](https://github.com/extension-js/extension.js/commit/ce391cbd17016e9579f2e4a3d2c81ed4dbeeda70))
- Consolidate ci-scripts into scripts and remove dead scripts ([fe89d591](https://github.com/extension-js/extension.js/commit/fe89d591ed2673352450453ad5e4c406e2e189ab))
- Update changelog and companion extension adjustments ([887d4d3a](https://github.com/extension-js/extension.js/commit/887d4d3ac26f5fbdcede6e42f5e02ac2ea8254a1))
- Refactor browser plugins, CDP/RDP inspection, and dev server internals ([cba18cfe](https://github.com/extension-js/extension.js/commit/cba18cfea25859c8504c7d20de09f5152fef1cb5))
- Wrap extension messaging sendMessage in try-catch in chunk loader ([af7a0fb3](https://github.com/extension-js/extension.js/commit/af7a0fb38144e18358aed0ca4411b14bbded712f))
- Hash content script filenames in dev mode to bust browser cache on hard reload ([2ecaa3a1](https://github.com/extension-js/extension.js/commit/2ecaa3a17eccdf47298db4656192fcf53d8a9a4a))
- Rewrite content script wrapper with reinject lifecycle and cleanup registry ([d816450c](https://github.com/extension-js/extension.js/commit/d816450c286c8caf3968ae301e193bdd3a8288a6))
</details>
## 3.10.3 (April 8, 2026)

### 🐛 Fixes

- Fix Windows optional dependency installs and smoke coverage ([2138e1f6](https://github.com/extension-js/extension.js/commit/2138e1f6ef0f296ca7b8a2c27752256c7eed13ef))
- Fix content script CSS fallback restoration ([4d6b35d6](https://github.com/extension-js/extension.js/commit/4d6b35d666d1a282d3b79f89ed2e39f4aeb1e916))

<details>
<summary>🧹 Other changes (1)</summary>

- Offload browser discovery to location libs ([61092854](https://github.com/extension-js/extension.js/commit/61092854f3178c40e518f954549a24bfc392b3f7))
</details>
## 3.10.2 (April 8, 2026)

### 🐛 Fixes

- Fix content script manifest CSS restoration ([4b4f8125](https://github.com/extension-js/extension.js/commit/4b4f81259674365c9412904ca52806d0bbb54394))

<details>
<summary>🧹 Other changes (2)</summary>

- chore: sync build deps tracking manifest ([dee29d47](https://github.com/extension-js/extension.js/commit/dee29d4748cd82cff6781927a9e9e07ef7398013))
- Bump dependency bundle and clear audit alerts ([39cb57fc](https://github.com/extension-js/extension.js/commit/39cb57fc981d0b668b112464e2a9a8a787afbe09))
</details>
## 3.10.1 (April 8, 2026)

<details>
<summary>🧹 Other changes (11)</summary>

- Added -b shortcut to browser option (#430) ([850e95cb](https://github.com/extension-js/extension.js/commit/850e95cb949bfb12bf02a5b27105a22f630eb7ba))
- Stabilize Windows pnpm smoke workspace paths ([c1ed7d25](https://github.com/extension-js/extension.js/commit/c1ed7d25fcd8639bcfb0c5862c6f858a1a8fcfd0))
- Stabilize Windows npm optional dependency preflight ([179a5469](https://github.com/extension-js/extension.js/commit/179a5469c17250f6b8abc278ccc4cb4aa3585f00))
- Handle cross-drive Windows file specifiers in pnpm smoke ([f16d5063](https://github.com/extension-js/extension.js/commit/f16d506339805e96a6cc6bf662bc625804f4f65f))
- Align pnpm optional-deps smoke with source-under-test ([98d78916](https://github.com/extension-js/extension.js/commit/98d78916267a5e27a823a9163c1d60790dc748c7))
- Generalize optional dependency contracts across webpack tooling ([6f1cad9e](https://github.com/extension-js/extension.js/commit/6f1cad9e944b699dc1fcccdbead02b620d8cc1fe))
- Enforce transactional optional dependency installs ([74f48a1c](https://github.com/extension-js/extension.js/commit/74f48a1c7797de36ade3cd6076d64e19665d8ad4))
- Setup internal standalone library for installing and resolving on-demand tooling ([4452bc40](https://github.com/extension-js/extension.js/commit/4452bc40eda54f0eee27b67c52d5ee8b6a72eda3))
- Setup internal standalone library for installing and resolving on-demand tooling ([fb0b9351](https://github.com/extension-js/extension.js/commit/fb0b93515189017d41582bc9e2b5ee7235689bc0))
- Stabilize CI platform-specific optional deps assertions ([64576006](https://github.com/extension-js/extension.js/commit/64576006ed7a26ad350f6307a8f831540acbda20))
- Setup internal standalone library for installing and resolving on-demand tooling ([feb04c92](https://github.com/extension-js/extension.js/commit/feb04c92f7ef86abe3ea306219a1461cc582cb04))
</details>
## 3.10.0 (April 8, 2026)

### 🐛 Fixes

- Fix excludeBrowserFlags forwarding in dev config ([da3794cf](https://github.com/extension-js/extension.js/commit/da3794cfc3999698cac0e0083287db3eb6bed584))
- Fix optional dependency installs across framework tooling ([e425095a](https://github.com/extension-js/extension.js/commit/e425095a0b805cfbddab1cec6ff36763b2c1bd02))
- Fix Discord release not working ([596dca54](https://github.com/extension-js/extension.js/commit/596dca54124fc2cdd2c6f9742b577572192a42cb))
## 3.9.5 (April 8, 2026)

### 🐛 Fixes

- Fix GitHub Actions Node 24 deprecation warnings ([239408be](https://github.com/extension-js/extension.js/commit/239408bedabc7f046d92800201c86fbcc6f7ba2a))

<details>
<summary>🧹 Other changes (1)</summary>

- Preserve Rspack branding in optimization warnings ([07f4363b](https://github.com/extension-js/extension.js/commit/07f4363bdd643d5fe32c3d7c9db1ca8ca35d5be3))
</details>
## 3.9.4 (April 8, 2026)

<details>
<summary>🧹 Other changes (2)</summary>

- Improve managed browser install guidance. ([ce1e0a8b](https://github.com/extension-js/extension.js/commit/ce1e0a8b1c052e4c686bb2278200bb346a48f7d5))
- Prefer the project-local develop runtime during create ([438438e1](https://github.com/extension-js/extension.js/commit/438438e14ded95d764803f4bb9f202eee0d6c302))
</details>
## 3.9.3 (April 8, 2026)

### 🐛 Fixes

- Fix Dependabot alerts ([94ee0090](https://github.com/extension-js/extension.js/commit/94ee0090936cc760573febf05fa8c108421bc145))
- Fix React optional dependency installs for content dev ([6919af7f](https://github.com/extension-js/extension.js/commit/6919af7f0b2b1be1ef605c68abf6d7cfa3210735))
- Harden managed browser profile reuse ([e8794223](https://github.com/extension-js/extension.js/commit/e87942230e0665baedb23dc32f87fbc2619d2637))
## 3.9.1 (April 8, 2026)

### 🐛 Fixes

- Fix Vue optional dependency installs for consumer builds ([a060dfdb](https://github.com/extension-js/extension.js/commit/a060dfdbdde90e5bfdedbb027e33934ed5d20a8d))
## 3.9.0 (April 8, 2026)

### 🚀 Features

- Enhance output data view for performance hints ([5b348ea3](https://github.com/extension-js/extension.js/commit/5b348ea330bc1b03806106cade554b6314410f82))

### 🐛 Fixes

- Fix publish workflow ([577a7082](https://github.com/extension-js/extension.js/commit/577a708292b2286197ff91f96b038a8830450991))

<details>
<summary>🧹 Other changes (2)</summary>

- Generate curated stable release notes ([84264401](https://github.com/extension-js/extension.js/commit/84264401b541f7b5e8e35870b43368c001e0bf8e))
- Richer build output ([8c096506](https://github.com/extension-js/extension.js/commit/8c09650654694f0905ef94814bcb697e5d810854))
</details>
## 3.8.16 (April 8, 2026)

### 🐛 Fixes

- Fix extension.config root resolution with src manifests ([a33dbeb0](https://github.com/extension-js/extension.js/commit/a33dbeb01dc13ef81600268e41046fc6304f6d47))

<details>
<summary>🧹 Other changes (2)</summary>

- Preserve webpackIgnore comments in production builds ([3e558993](https://github.com/extension-js/extension.js/commit/3e55899332e439d1c61fa1f0d6dc0a8d7a4ebfc6))
- Preserve CLI spacer lines in Turbo-prefixed output ([9b1f215d](https://github.com/extension-js/extension.js/commit/9b1f215dbacaeff1c25cbc7538a497c4ee7a4456))
</details>
## 3.8.14 (April 8, 2026)

### 🐛 Fixes

- Fix regression on optional deps install on Windows ([48edb8e6](https://github.com/extension-js/extension.js/commit/48edb8e64962968260af72a384e8e58f03373dc0))
## 3.8.13 (April 8, 2026)

<details>
<summary>🧹 Other changes (1)</summary>

- Improve build warning summaries and remove contradictory success output ([717f1233](https://github.com/extension-js/extension.js/commit/717f123371e74905e0ab518ebdbb555bc853460b))
</details>
## 3.8.12 (April 8, 2026)

### 🚀 Features

- Add banner to --wait output ([30cc9d97](https://github.com/extension-js/extension.js/commit/30cc9d97980edbb5cb84307dbab4f8bbf8ad1506))
- Add staging `monorepo` example as ignored ([fff9224d](https://github.com/extension-js/extension.js/commit/fff9224da9efa123774d2647301e5dd80158053a))
- Add --wait support for superior Playwright DX/AX ([bebe8d4d](https://github.com/extension-js/extension.js/commit/bebe8d4d67077acd08926dad99524768129b7c37))

### 🐛 Fixes

- Fix rebase regression for the --wait output banner ([540c1787](https://github.com/extension-js/extension.js/commit/540c178784c276389cc0cdabcb4b261ff99898f0))
- Patch vulnerable immutable transitive dependency ([bbf6ff94](https://github.com/extension-js/extension.js/commit/bbf6ff946f1764b400ba078d48c30376398df2f8))

<details>
<summary>🧹 Other changes (1)</summary>

- Improve --wait for `start` command ([f944db6a](https://github.com/extension-js/extension.js/commit/f944db6aaab500912814b1b50dbe8b9bb231c8b9))
</details>
## 3.8.11 (April 8, 2026)

<details>
<summary>🧹 Other changes (2)</summary>

- Rename no-runner behavior to no-browser ([5ffadec8](https://github.com/extension-js/extension.js/commit/5ffadec815b6c6b87ddf381da66bfe7f7004aa6c))
- Invalidate optional-deps preflight cache when lockfiles change ([333d4658](https://github.com/extension-js/extension.js/commit/333d4658474774fcd3291239baf080f5634ba589))
</details>
## 3.8.10 (April 8, 2026)

### 🚀 Features

- Support monorepo root env fallback for extension config loading ([98b111cf](https://github.com/extension-js/extension.js/commit/98b111cff613f78e7a3a0d5c466149f9a58f335a))

<details>
<summary>🧹 Other changes (1)</summary>

- No loading for first-time optional deps install ([f584334d](https://github.com/extension-js/extension.js/commit/f584334d17715f33924c973c1a5a0b07bd66b58b))
</details>
## 3.8.9 (April 8, 2026)

### 🐛 Fixes

- Resolve 2 security vulnerabilities (#414) ([49ad4189](https://github.com/extension-js/extension.js/commit/49ad41890901036dd303e647717aad5341f7c782))

<details>
<summary>🧹 Other changes (4)</summary>

- Scope optional peer runtime checks to Vue ([3f417a8a](https://github.com/extension-js/extension.js/commit/3f417a8a21100bfcbff6d7eede64ecb91c69c1fd))
- Remove vulnerable serialize-javascript from build-deps lockfile ([ff7918b1](https://github.com/extension-js/extension.js/commit/ff7918b1c998fe26847f9be787edfd7c22526d76))
- Hotfix for Vue examples not working ([d99a6d22](https://github.com/extension-js/extension.js/commit/d99a6d22978da7a279ba9dde605f000a0a51a733))
- Setup experimental error overlay ([1b186e58](https://github.com/extension-js/extension.js/commit/1b186e589794f70969c10556d0942493602aaa9f))
</details>
## 3.8.8 (April 8, 2026)

### 🚀 Features

- Add deterministic deep content-script reload validation. ([ba2a99c3](https://github.com/extension-js/extension.js/commit/ba2a99c36de3b5b7be863ba7e16e65b008e456a8))
- Add more scripts to default creation projects ([8ec8f556](https://github.com/extension-js/extension.js/commit/8ec8f55653cd33d903f8bac38559b5d922b45d0a))

### 🐛 Fixes

- Fix dependabot alerts ([82293abb](https://github.com/extension-js/extension.js/commit/82293abb0602569afc83d21dccdbdb50cfa118e2))
- Gate first-run canary reload regression ([375f3d5d](https://github.com/extension-js/extension.js/commit/375f3d5d35c434001d7c0a60061acaa0c179c836))
- Harden Chromium CDP startup against short-circuit failures ([918821ec](https://github.com/extension-js/extension.js/commit/918821ecbaf866385ede9944d09d683f3e092783))
- Fix warn-dev-mode spec logger mock typing ([b368a23c](https://github.com/extension-js/extension.js/commit/b368a23c273c81399196e109413cd283fef5e43f))
- Harden CDP extension ownership during first-run startup ([1bd406ab](https://github.com/extension-js/extension.js/commit/1bd406abf81fa7951019626c77460938895bd3a0))
- Fix Chromium hard-reload test ([c1fe9972](https://github.com/extension-js/extension.js/commit/c1fe9972e76761838e61bf50cb7ec679ff300738))
- Fix first-run Chromium extension disable regressions ([d905cb8b](https://github.com/extension-js/extension.js/commit/d905cb8b84bf035be38d891667a8461183cf77e9))
- Fix hard-reload running on first runs and breaking UX ([72fa3913](https://github.com/extension-js/extension.js/commit/72fa3913d39045a0b995e70446afe0ed7dce432f))
- Avoid Chromium extension hard reload on initial dev build ([8fba26b1](https://github.com/extension-js/extension.js/commit/8fba26b151cedc68af00bb79d5499cca578d99d0))

<details>
<summary>🧹 Other changes (4)</summary>

- Improve version resolution during create step ([1b028f5a](https://github.com/extension-js/extension.js/commit/1b028f5a5a7ada166ecc711a6608fc18e2d12c3a))
- Ignore dist output changes in hard reload watch detection ([64deed50](https://github.com/extension-js/extension.js/commit/64deed505f4d36df0d04f6c62da7fa405492f9c2))
- Experimental error overlay ([3be490b5](https://github.com/extension-js/extension.js/commit/3be490b53ff84534b02ffe28f6571f80333514b5))
- Auto-scan top-level ./extensions ([6d6a169e](https://github.com/extension-js/extension.js/commit/6d6a169e5fe3c7bf11e725ecf40e16f4e10fa432))
</details>
## 3.8.7 (April 8, 2026)

### 🐛 Fixes

- Fix .gitignore writing to avoid GC-closed file handles ([214664e1](https://github.com/extension-js/extension.js/commit/214664e1c002ee9d5a94bd1e3b550c2975b19299))
## 3.8.6 (April 8, 2026)

### 🚀 Features

- Add tests to prevent built-in extension not bundling ([e8fb5c70](https://github.com/extension-js/extension.js/commit/e8fb5c70d98b48a8bd7c53fbce3f256c667dc2c1))

### 🐛 Fixes

- Fix Windows path assertions in preview spec ([efdd6aca](https://github.com/extension-js/extension.js/commit/efdd6aca264e094e9129d90f1dd519228842c169))
- Fix extension-create not running through Node.js interface ([95f8986d](https://github.com/extension-js/extension.js/commit/95f8986d6945961dfc8effbc4693019f4f583c1e))

<details>
<summary>🧹 Other changes (1)</summary>

- Follow up on built-in extension overriding user NTP ([ba1c24ac](https://github.com/extension-js/extension.js/commit/ba1c24acdfb1bd6ce51e98739aea60c948ac3b51))
</details>
## 3.8.5 (April 8, 2026)

### 🐛 Fixes

- Fix bundled extensions regression ([7eae3a2b](https://github.com/extension-js/extension.js/commit/7eae3a2b34dfe0e892152cd1da63dac698b3af0e))
- Resolve sass-loader in pnpm dlx one-run builds ([255f13d0](https://github.com/extension-js/extension.js/commit/255f13d03328785fd9b08b5117ad00ca0a42f203))

<details>
<summary>🧹 Other changes (1)</summary>

- Curate changelog entries for public release notes. ([d3d9e8cf](https://github.com/extension-js/extension.js/commit/d3d9e8cf96731de25fb15ade94b186c32820f0e3))
</details>
## 3.8.3 (April 8, 2026)

### 🚀 Features

- Add automated optional-dependency smoke coverage across package managers ([2e109ded](https://github.com/extension-js/extension.js/commit/2e109ded785e489f3061e630a1c8807d1543811a))

### 🐛 Fixes

- Fix Windows file specifiers for local package overrides in smoke matrix ([56fc83ed](https://github.com/extension-js/extension.js/commit/56fc83edef1ce557364aff436bf61cc80d074c83))
- Fix Windows process spawning in optional-deps smoke runner ([81c64a8e](https://github.com/extension-js/extension.js/commit/81c64a8e0808b408124546f8d1ececd158ac53b1))
- Fix optional-deps matrix portability across Windows, Yarn, and Bun ([4301bd75](https://github.com/extension-js/extension.js/commit/4301bd756cdd20ffc97de1763925e1b0065a09ba))
- Fix optional-deps smoke matrix when browser-extension fixture is absent ([5d41e561](https://github.com/extension-js/extension.js/commit/5d41e5610428e9f86ec5714079c98a14992e460c))
- Fix optional module loading fallback in pnpm CI layouts ([c747d6f2](https://github.com/extension-js/extension.js/commit/c747d6f2ed9855fb2fed85d609062e360584e8fc))
- Fix optional dependency resolution in pnpm canary CI ([28ed2ec3](https://github.com/extension-js/extension.js/commit/28ed2ec362af2ce1f1107f2d89cddf7179358269))
- Harden optional dependency runtime resolution deterministically ([659d3410](https://github.com/extension-js/extension.js/commit/659d3410c19972e09e24d2e3d7f1c59e3bbb721a))

<details>
<summary>🧹 Other changes (4)</summary>

- Further simplify install-root entrypoint resolution helpers ([e5986e06](https://github.com/extension-js/extension.js/commit/e5986e06eb9268c7b16e60ee71fc15e1d7253f26))
- Simplify optional dependency resolver control flow ([4293f5fb](https://github.com/extension-js/extension.js/commit/4293f5fb508d280cf72fcae62fb90848e9fa6e53))
- Codify optional-deps runtime contract and lock regressions ([da35c737](https://github.com/extension-js/extension.js/commit/da35c7377ec03361685bba63cc6e7ddfcdbfda18))
- Use registry-mode extension for Windows pnpm smoke lane ([8d9f066a](https://github.com/extension-js/extension.js/commit/8d9f066af52169c1486a18e09e04e669660f1fcd))
</details>

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
