# Changelog

## Unreleased

### Features

- Allow reserved _locales and _metadata dirs past the dev name guard ([131388ac](https://github.com/extension-js/extension.js/commit/131388ac9aa006956875b4fc4d48e0ca52326a1d))

<details>
<summary>Other changes (6)</summary>

- Override adm-zip to 0.6.0 to fix the memory-exhaustion advisory ([a7e2c27a](https://github.com/extension-js/extension.js/commit/a7e2c27ae884458a26e26c32e421bb977960443c))
- Warn when a dev reload reaches no page (service worker not attached) ([ed08f41f](https://github.com/extension-js/extension.js/commit/ed08f41fc24251b422424e688217717b4d7cd406))
- Stamp runtime attachment in ready.json; doctor grace + unify distPath ([24935327](https://github.com/extension-js/extension.js/commit/2493532768e98a295e0487377ebbb00c65b5bb6c))
- Target eval/inspect by tab or url and add inspect --list-tabs ([a8747be9](https://github.com/extension-js/extension.js/commit/a8747be9942ec7d9b8e44789bf5312e64f9f31c4))
- Evict stale unpacked loads and open the newtab override tab ([22ea5039](https://github.com/extension-js/extension.js/commit/22ea503916933d16029ed68a0ecdbb2cee8496e7))
- Unify scaffold package-manager and expose it on CreateResult ([611c09fd](https://github.com/extension-js/extension.js/commit/611c09fdcc1d529c3c04b5111dacaf1c8921db8f))
</details>

## 4.0.13 (July 19, 2026)

### Features

- Add --no-polyfill, emit extension-develop dts, fix stale --source help ([79683f72](https://github.com/extension-js/extension.js/commit/79683f72da1adb3e1a7c1001dc5ff991327bc92b))
- Add --parent-pid watchdog so leaked dev servers die with their owner ([63be66fa](https://github.com/extension-js/extension.js/commit/63be66fa100422571b93fed30415ffd439ee1041))

### Fixes

- Resolve HMR runtime from @rspack/core so Yarn PnP resolves it (#486) ([58ffa0ae](https://github.com/extension-js/extension.js/commit/58ffa0ae299b21a3e44ad3ba38bba9a643c1f012))
- Resolve browser-prefixed world keys before MAIN-world bridge compilation ([6a5ba99f](https://github.com/extension-js/extension.js/commit/6a5ba99fbccf4d590adbd320568c986143a120b5))
- Sweep reload-era dead code from browsers; trim README deno note ([edcd00ac](https://github.com/extension-js/extension.js/commit/edcd00acb9f5060803add991b9c4211962d3162d))

<details>
<summary>Other changes (4)</summary>

- Prune superseded hot-update generations from the loadable dev dist ([28602698](https://github.com/extension-js/extension.js/commit/28602698699a7384a82c8384f1983b2c3fc2e9fc))
- Stamp real command + versions in ready.json; per-run events.ndjson ([4147cda9](https://github.com/extension-js/extension.js/commit/4147cda9e3cf11685759125bd2c38b4f62cc00f9))
- Slim feature-scripts: drop dead shims, unify compilation issue reporting ([032909df](https://github.com/extension-js/extension.js/commit/032909df1664d88a17756dc9b6eb6645ed4f5ea1))
- Extract reload/HMR into plugin-reload; hoist content-script wrapper ([c702350b](https://github.com/extension-js/extension.js/commit/c702350b798a7842e91dfbcd19b394f59de24640))
</details>

## 4.0.12 (July 17, 2026)

- **`extension doctor`** — one command that walks a dev session's control-channel legs (ready contract, server process, ports, token, executor, browser) and names the first failing one with a fix. Agents get `--output json`.
- **Fork-browser fixes** — waterfox/librewolf now get Firefox-shaped `web_accessible_resources`, and brave/opera/vivaldi/yandex now get the MV2-deprecation warning Chromium targets already had.
- **Clearer control-channel errors** — "no executor connected" and eval "Forbidden" now say *why* (stale service worker mid-resync, browser still launching, missing/mismatched eval token) instead of a catch-all.

### Fixes

- Fix control-port spec: resolve() adds drive letter on Windows ([d4bc93b9](https://github.com/extension-js/extension.js/commit/d4bc93b940f8c375eeb87e967046a60c6c70e282))
- Prevent #484 class: per-browser token, doctor verb, session smoke CI ([68511174](https://github.com/extension-js/extension.js/commit/685111743b7ebcd6da3d8d5b2a62ff7d6abcd3a1))
- Fix deno smoke lane: deno install ignores file: deps; use links field ([0a753eae](https://github.com/extension-js/extension.js/commit/0a753eae905c6a02fe582f06cba4c5431cd3e9fe))
- Stop claiming Preact HMR in author-mode summary and dev help ([e0c0c26e](https://github.com/extension-js/extension.js/commit/e0c0c26e4e2f2ff2eadc70f9203d4659463340b2))
- Fix npm README logo rewrite regex; resync generated mirror ([8038d0d5](https://github.com/extension-js/extension.js/commit/8038d0d58b5fcbb7be2df7ad1e8843c3ea3f757b))
- Repair named commands missing descriptions Chrome refuses to load ([047e2209](https://github.com/extension-js/extension.js/commit/047e22091e556e3e6ac2a6099dadaadc9668cf6d))

<details>
<summary>Other changes (16)</summary>

- Extract inline script by string index, not regex (CodeQL #73) ([e788ecee](https://github.com/extension-js/extension.js/commit/e788eceef30af88b5ce32bd700908b2bbff502d4))
- Trace webpack numeric chunks + runtime-set HTML surfaces into dist ([29489317](https://github.com/extension-js/extension.js/commit/29489317159d4d9e9566cdb65982e3db08f46db8))
- Normalize folder ASCII banners: add 113 missing, fix 20 wrong ([e1a5b0d2](https://github.com/extension-js/extension.js/commit/e1a5b0d2bba79cdb5cfd76ed77dbe129420ec7a0))
- Remove resolved docs/followups and dead vitest.workspace.ts ([965a9043](https://github.com/extension-js/extension.js/commit/965a90434d67c891b50cf8079802404c4503e563))
- Log Firefox RDP connect retries and name the port on give-up ([e3d3b799](https://github.com/extension-js/extension.js/commit/e3d3b7993d808e3f346f273f185181b3b9b0103b))
- Repo hygiene: drop dead files, fix docs drift, sync test workspace ([96ef5038](https://github.com/extension-js/extension.js/commit/96ef5038e23d4d788e19be58f021201170652934))
- Bridge classic page-script globals to window for inline consumers ([9ffaa3e6](https://github.com/extension-js/extension.js/commit/9ffaa3e6d56dfc1f0c679ca8496e8ac134c86312))
- Root-absolute refs: ship JS import closure, fix manifest page targets ([fd820dca](https://github.com/extension-js/extension.js/commit/fd820dca3b10de19fdb825950933e7408624402a))
- Resync generated npm README mirror (Safari status Alpha) ([5105e379](https://github.com/extension-js/extension.js/commit/5105e37992a0a6ca65617ee390e9f3e7c86dc2b4))
- Resync bundled javascript template: top-level setPanelBehavior fix ([58d6a8f2](https://github.com/extension-js/extension.js/commit/58d6a8f2cc44bed98eb3858eba4b3f6c43bc8117))
- Reject failed builds as promises; process.exit(1) only via CLI opt-in ([f5c3c649](https://github.com/extension-js/extension.js/commit/f5c3c64958d0249f6715684bd3839bdf02a1d764))
- Leave unresolvable bare require() verbatim instead of failing the build ([c5ca4225](https://github.com/extension-js/extension.js/commit/c5ca4225fe7a7a7dcecf1650848dbc78279a2616))
- Canonicalize supported-surface lists; promote deno to full peer ([2a78f2ed](https://github.com/extension-js/extension.js/commit/2a78f2edd58ebb9b6c547f4201a24e7b9fc58334))
- CI: promote Deno to PR-gating smoke lane (validated locally) ([d50b5ecf](https://github.com/extension-js/extension.js/commit/d50b5ecf231d177f954ad09351e560f3a15857dd))
- CI: smoke fork build targets; add non-blocking nightly Deno lane ([0d5a6cbb](https://github.com/extension-js/extension.js/commit/0d5a6cbbf1e42e35a8afecfee4f75e16bbd9d176))
- README: note Deno support alongside npm/pnpm/yarn/bun ([aaed6e47](https://github.com/extension-js/extension.js/commit/aaed6e47a2afe19d83ff6a0bd50151b9d95fee72))
</details>

## 4.0.11 (July 17, 2026)

### Features

- Add nightly macOS smoke for the real Safari toolchain pipeline ([3ce254d4](https://github.com/extension-js/extension.js/commit/3ce254d4dddb91306389987b63284483497c6e30))
- Surface Safari xcrun/xcodebuild output; build skips packaging off-macOS ([ed40d809](https://github.com/extension-js/extension.js/commit/ed40d809f459ba1a2b209f1469c229f2ad85d5f6))

### Fixes

- Guard bundled javascript template against examples drift ([dc729329](https://github.com/extension-js/extension.js/commit/dc72932947d84a12ff2c0c873bab5854930eaa97))
- Resolve safari:/webkit: manifest prefixes; warn before project regen ([72a5da8d](https://github.com/extension-js/extension.js/commit/72a5da8dcab9aacdb2f1ad0825340668ca3e5a79))
- Repair missing version and CSP unsafe-inline; diagnose unsupported MV ([dd9845b4](https://github.com/extension-js/extension.js/commit/dd9845b45188e9a05551476730d945caf516d2d9))

<details>
<summary>Other changes (6)</summary>

- Resync bundled javascript template with examples repo ([1fc0f7fb](https://github.com/extension-js/extension.js/commit/1fc0f7fba3b2977c72632333961372d1ab7f7be7))
- Align Safari app/appex bundle ids to --bundle-id after conversion ([b0e86e4f](https://github.com/extension-js/extension.js/commit/b0e86e4f1ada60647b2ef0e1899867f6254a052b))
- Safari status to Alpha; install explains Xcode instead of a binary ([9fad813b](https://github.com/extension-js/extension.js/commit/9fad813b4dc579c7770a393c17c6b3a1cd8ea55c))
- Wire Safari identity options: --bundle-id/--app-name + config support ([311967f6](https://github.com/extension-js/extension.js/commit/311967f6e0045dc39ddbde104b812c811e8d9d59))
- Record Safari converter as a non-surface for manifest refusals ([3036e779](https://github.com/extension-js/extension.js/commit/3036e77967324b6938db9773a8a6c1e5031dc553))
- Diagnose live-verified Chrome manifest refusals; repair bad names ([8315a492](https://github.com/extension-js/extension.js/commit/8315a4922eaf3f96c85bdaa96bebd51b63f70c3e))
</details>

## 4.0.10 (July 15, 2026)

### Fixes

- Stop emitting assets on errored compiles so dist keeps last-good ([57a18b1c](https://github.com/extension-js/extension.js/commit/57a18b1c5b490274b18efa4a021d4170241e9c57))

<details>
<summary>Other changes (5)</summary>

- Strip emojis from generated release notes ([1c3f4be8](https://github.com/extension-js/extension.js/commit/1c3f4be83ea4df17152edb83f194652c5a729115))
- Ship real compile-error text in ready.json and events.ndjson ([8f7bd584](https://github.com/extension-js/extension.js/commit/8f7bd5846e2e78e354132b169e9e1830f6e74b3b))
- Print dev command failures cleanly without a stack trace ([f8433602](https://github.com/extension-js/extension.js/commit/f84336022810e2a0355fc32d47d9cadb90f0954a))
- Latch content-script reloads until the SW acks, replay on hello ([a194db39](https://github.com/extension-js/extension.js/commit/a194db398e743027493a23bc70a45d3419c78812))
- Warn per file when scss/less ship uncompiled without their compiler ([53c68dba](https://github.com/extension-js/extension.js/commit/53c68dba70f4324fd5a8cec8141afbb84f9e606f))
</details>

## 4.0.9 (July 13, 2026)

### 🐛 Fixes

- Stop killing the dev browser on CDP stalls; surface its death ([6cb4c8b7](https://github.com/extension-js/extension.js/commit/6cb4c8b7b36dd4179bd6a4ea57a06ae00fafb8ee))
- Stop flagging wildcard ports in match patterns as launch refusals ([e3b26c2f](https://github.com/extension-js/extension.js/commit/e3b26c2fbc7ed6b294fd55287014029544a15d59))
- Resolve root-absolute CSS url() from the extension root ([a86e86c6](https://github.com/extension-js/extension.js/commit/a86e86c67fcebe0bf82ecd080ffe4826c6616491))
- Resolve root-absolute refs and TS NodeNext .js import specifiers ([aeb6c6fc](https://github.com/extension-js/extension.js/commit/aeb6c6fc420c4df130167bd90b0dedefb467ca6f))
- Stop flagging query strings and fragments as launch refusals ([ed30159b](https://github.com/extension-js/extension.js/commit/ed30159bfabf28f45b06eb79b9be252696fe12a3))

<details>
<summary>🧹 Other changes (8)</summary>

- Loosen dev connect-src for the resolved connectable host ([3c5474d0](https://github.com/extension-js/extension.js/commit/3c5474d0e3a70e807059a5c69dcea2db09293797))
- Tolerate dead CSS url() refs; type-strip TS in classic-concat ([268a23d7](https://github.com/extension-js/extension.js/commit/268a23d7aa18e90a96b09cbb1b41bda64d9af9b8))
- Ship console-relay logs over a named Port to kill message loops ([6a148b4b](https://github.com/extension-js/extension.js/commit/6a148b4bbbd01ef0d9691744825f9c97ce873d26))
- Auto-install with --ignore-scripts; warn on dead HTML refs ([fb24279c](https://github.com/extension-js/extension.js/commit/fb24279cfdf8a903136ce82df62f142bbb6f82b2))
- Isolate devtools overlay shadow host from page styles ([639e1c53](https://github.com/extension-js/extension.js/commit/639e1c53cf4d1b6f167b2324b97a0ac9fd8d1b1f))
- Raise RUST_MIN_STACK to 256MB so deep ASTs do not SIGILL rspack ([8d05d544](https://github.com/extension-js/extension.js/commit/8d05d5444a25a13e3a62664d776f53ac0104781a))
- Dedupe files listed twice in one content_scripts js array ([b2cfc1e5](https://github.com/extension-js/extension.js/commit/b2cfc1e5886983cbb94d49395fdc0d4e7d4c8f4b))
- Content-hash dev asset names to stop same-basename collisions ([78c2dce6](https://github.com/extension-js/extension.js/commit/78c2dce6a0853171279c2baa213d234ea3f80b21))
</details>

## 4.0.8 (July 12, 2026)

### 🚀 Features

- Add EXTENSION_BROWSER_FLAGS env pass-through for launch flags ([9d574295](https://github.com/extension-js/extension.js/commit/9d5742953c6d9680df2a0c2717a1d5a98484e30f))
- Add getURLDependencyMissing to the messages-catalog snapshot ([ea8a8859](https://github.com/extension-js/extension.js/commit/ea8a885927c2c4b125902a867f157453037eaf71))

### 🐛 Fixes

- Stop flagging explicit ports in match patterns as launch refusals ([b62b33b8](https://github.com/extension-js/extension.js/commit/b62b33b830dc8a0fdb9e636548d16288c4735625))
- Repair 0-byte manifest icons and diagnose unloadable icons at launch ([5776ac7e](https://github.com/extension-js/extension.js/commit/5776ac7ee9a9c8f32e714b77a3f23f0519c220b4))
- Repair non-numeric manifest version strings at emission ([0d3f3aff](https://github.com/extension-js/extension.js/commit/0d3f3afff54992a8ae25806687d2f6fef65ac50d))
- Resolve root-URL HTML refs against the manifest root, not dist ([d2c92f74](https://github.com/extension-js/extension.js/commit/d2c92f74db3c00001c8ce52861fbdd1b803aed07))
- Repair manifest shapes Chrome refuses and diagnose MV2 on Chromium ([7c8399df](https://github.com/extension-js/extension.js/commit/7c8399df855636c54ec292e3a7142c5422a063b5))
- Harden dev reload delivery: empty background, CSP origins, load errors ([3b06ccef](https://github.com/extension-js/extension.js/commit/3b06ccef09535529aaa0f9bcec63fc488ee427ee))

<details>
<summary>🧹 Other changes (27)</summary>

- Fan shared SW+content module edits to both reload paths and heal tabs ([8e833828](https://github.com/extension-js/extension.js/commit/8e833828922b24af2ebfc6032b1ccc09c130da40))
- Pick the HTML HMR API by the source's own module syntax ([17a6b852](https://github.com/extension-js/extension.js/commit/17a6b852785b95d3629849902b1bbb8fb9ba4b36))
- Name the manifest shapes Chrome silently refuses at launch ([ce14782a](https://github.com/extension-js/extension.js/commit/ce14782a39690f4efa1f540963f65c4035ec55bc))
- Strip the UTF-8 BOM before the manifest read in emit-html-file ([020715a2](https://github.com/extension-js/extension.js/commit/020715a24383d0b899c3dd4a2e0436cf894c97e0))
- Ignore watch paths by segment instead of substring ([d19d070b](https://github.com/extension-js/extension.js/commit/d19d070b107719b5f0eb3a2646dbae32d957e791))
- Warn at launch on match patterns with query, fragment, or port ([85e2669d](https://github.com/extension-js/extension.js/commit/85e2669d827f4a884a709391f7bf925c4a11b471))
- Diagnose Firefox-style MV3 background.scripts at Chromium launch ([665d8cb2](https://github.com/extension-js/extension.js/commit/665d8cb2fb92208a40aa71e3c9b78cdd4ec570d0))
- Inject module.hot into script-parsed page scripts, not import.meta ([41f23d2f](https://github.com/extension-js/extension.js/commit/41f23d2fa9c6589e5566f284010887b169694592))
- Keep import(chrome.runtime.getURL(...)) native in emitted bundles ([cfb61f27](https://github.com/extension-js/extension.js/commit/cfb61f278bb8f0a1256feb3b1082732ff3e6c2d3))
- Ship the static import closure of runtime-traced modules ([1f6043df](https://github.com/extension-js/extension.js/commit/1f6043df299d96f5c8667916cfeeeee47aef5f44))
- Update messages-catalog snapshot for fatalManifestShapeFixed ([4c05318c](https://github.com/extension-js/extension.js/commit/4c05318ccd2f49abe0cd9c523e9ba4b560a7c9c1))
- Fail the build when an emitted content script does not parse ([7d5ad766](https://github.com/extension-js/extension.js/commit/7d5ad7662e8dc7bb8f87de273b9875ac287683ad))
- Honor exclude_matches in dev reinjection and re-registration ([7120bf70](https://github.com/extension-js/extension.js/commit/7120bf7085ce353d7e9d7073ff22c16f04a075c5))
- Keep dev reloads deliverable to idle MV3 service workers ([1d8fb08e](https://github.com/extension-js/extension.js/commit/1d8fb08e97f2b16ea8cd353d612111ba577acf37))
- Point css-only content_scripts groups at the emitted entry chunk ([76552107](https://github.com/extension-js/extension.js/commit/765521073b95a5adbb85994dffe459272979abeb))
- Compare requested vs resolved dev-server ports numerically ([e3cf24cd](https://github.com/extension-js/extension.js/commit/e3cf24cd874cc5b76aa9dd9f900b4618ece68a64))
- Name the resolved browser binary and stop stale snapshot outranking ([1e6fa66f](https://github.com/extension-js/extension.js/commit/1e6fa66f37a25cdc4741aa4ed6bc86c6f8a5a552))
- Survive Chromium 152 dev reloads and merge repeated feature switches ([4d3dd33a](https://github.com/extension-js/extension.js/commit/4d3dd33a1dae1166957a0dc6b763fbc737f32b4b))
- Bound the telemetry audit log with a size-cap rotation ([538c5cb3](https://github.com/extension-js/extension.js/commit/538c5cb3947aa144f53b39bcc87f053abbe8ae09))
- Scaffold deno.jsonc and make the toolchain manifest-agnostic (#482) ([70385b8c](https://github.com/extension-js/extension.js/commit/70385b8cfb07d17ad293fda764f28a451ce8cef0))
- Persist the dev control port outside dist for SW resync (#484) ([7bb0d820](https://github.com/extension-js/extension.js/commit/7bb0d820267db50240a8081a00a2854e39add1b6))
- Classify dev reloads by chunk graph and clamp asset names to output dir ([860201f0](https://github.com/extension-js/extension.js/commit/860201f039e499bca3dc01d02e29a258d5666299))
- Identify dev-server runtime modules by content, not require position ([e3a17b60](https://github.com/extension-js/extension.js/commit/e3a17b607d75893ac93f03666b60d10b60a30c12))
- Fall back to manifest directory when a project has no package.json ([0e836d08](https://github.com/extension-js/extension.js/commit/0e836d08377f6f1047a6c4994facefa8a886f86a))
- Always rebuild bundled companion extensions; fix CDP port from --port 0 ([b6c4ff3e](https://github.com/extension-js/extension.js/commit/b6c4ff3ef8c78cc9add40ae6b733127b219aef91))
- Qualify content-script wrapper ownership by extension id ([cb16fcf6](https://github.com/extension-js/extension.js/commit/cb16fcf659d257a69cdc0e1ed78f14ae12db5bd3))
- Trace chrome.runtime.getURL literal targets into dist ([9c1fcad1](https://github.com/extension-js/extension.js/commit/9c1fcad1854dfafd33be28a6c986903360abb7c0))
</details>

## 4.0.7 (July 11, 2026)

### 🐛 Fixes

- Resolve PostCSS config string plugins project-first so CLI installs outside the project can load them ([2d13a9dc](https://github.com/extension-js/extension.js/commit/2d13a9dc18ff1155580d4c918bb7b59be4d9731e))
- Resolve .env files family-wide and make undefined env vars safe ([2c449344](https://github.com/extension-js/extension.js/commit/2c449344ef1518ffae54c9962a5f57a16025727c))

<details>
<summary>🧹 Other changes (8)</summary>

- Fail the build when manifest page surfaces (popup, options, overrides, devtools) point at missing files ([8f59a72e](https://github.com/extension-js/extension.js/commit/8f59a72e7b88c6c1e752c32ecb4b07f15274b551))
- Trace runtime-fetched package files into dist and keep executeScript tracing alive past multi-KB template literals ([648d23f2](https://github.com/extension-js/extension.js/commit/648d23f2f01b6b17396ab9e8ffe7e850098c1413))
- Confine project auto-install to the project dir and fall back to npm when the resolved package manager fails ([65f671af](https://github.com/extension-js/extension.js/commit/65f671af9c85efa14a3b572ed17519f0ad969cca))
- Type ?inline stylesheet imports as asset/source so Vue custom-element styles resolve to CSS strings ([8bff845b](https://github.com/extension-js/extension.js/commit/8bff845baf58c465d2021c02443988b8c3d45a35))
- Match link rel as a token list so shortcut icon assets stay static instead of becoming phantom stylesheet modules ([dd7d1aae](https://github.com/extension-js/extension.js/commit/dd7d1aae378ae9875c87e41fbb42f1b3ce8f90ab))
- Update all *-location dependencies ([72533594](https://github.com/extension-js/extension.js/commit/72533594399c3c497a997db45b5be7ea94b6aebf))
- Concatenate classic multi-script HTML pages into one shared scope ([8af0b2fb](https://github.com/extension-js/extension.js/commit/8af0b2fb5fbbdebc4c051d3a9a98cef40287bcb8))
- Trace importScripts deps and executeScript file payloads into dist ([2cc9c9a9](https://github.com/extension-js/extension.js/commit/2cc9c9a97a85e7c3da7f9add275f5612063ccda1))
</details>

## 4.0.6 (July 7, 2026)

<details>
<summary>🧹 Other changes (3)</summary>

- Fall back to any managed chromium-family binary when the requested chrome/chromium is missing ([a13b6aaf](https://github.com/extension-js/extension.js/commit/a13b6aafa52a9009ef6449819e834df8e42b44bc))
- Cover chromium in install all and fall back to managed chromium-family binaries when dev's default chromium is missing ([e5956fda](https://github.com/extension-js/extension.js/commit/e5956fda4dcafc6502404f31e455d92ec63c4623))
- Update README.md ([3985a105](https://github.com/extension-js/extension.js/commit/3985a10556608112fbf13660876b3632ee2f6169))
</details>

## 4.0.5 (July 5, 2026)

### 🐛 Fixes

- Fix Safari extension-URL scheme in CSS url() and import.meta minification in vendored ESM chunks ([6246eed3](https://github.com/extension-js/extension.js/commit/6246eed3ece1fa1c10b60e5ed43238d4e34a1815))
- Fix classic-concat content-script CSS/MV2 background emission and vendored UMD require build break ([3950253e](https://github.com/extension-js/extension.js/commit/3950253e01f947765ebe6815c7da256c6528b54d))

<details>
<summary>🧹 Other changes (16)</summary>

- Compare path sets against rspack resources through one resolved toResourceKey ([8469e2c9](https://github.com/extension-js/extension.js/commit/8469e2c9eeab83edf9fe435ccbb9f17222acb089))
- Pin swc rules to explicit javascript/auto so the project package.json type field cannot override browser-parity script-vs-module detection ([419748fe](https://github.com/extension-js/extension.js/commit/419748fe64d7067398e40ed81a76cdebe7fe1874))
- Tolerate UTF-8 BOM in all extension JSON parses and route preprocessor stylesheets as plain CSS when the preprocessor is not installed, matching Chrome loading ([dd8439e7](https://github.com/extension-js/extension.js/commit/dd8439e7e19e440bfaae6c50e3bb558d37f89b96))
- Announce dev reloads with one server-built context label across CLI stdout, the page devtools console, and the devtools pill, and self-heal stale cached service workers via a persisted control port and broker resync ([f5e3d846](https://github.com/extension-js/extension.js/commit/f5e3d846cff58f21adcc370f4324b534688563a4))
- Lead npm and README metadata with the cross-browser extension framework positioning ([85f8c057](https://github.com/extension-js/extension.js/commit/85f8c057feb7245770e0c4dbc5dc086b0103ef53))
- Emit HTML static assets at their source paths so runtime references resolve like Chrome serves them ([56922215](https://github.com/extension-js/extension.js/commit/569222150b3a94ffcda777ef9d24cd55efa56679))
- Accept web_accessible_resources match patterns with ports and port wildcards that Chrome loads instead of failing the build ([582e3b45](https://github.com/extension-js/extension.js/commit/582e3b45ae2b989ab8249f1b116df5cb4cfc538b))
- Parse page scripts as javascript/auto and force ESM only where the platform declares it (script type=module, module service workers) ([8f5deca8](https://github.com/extension-js/extension.js/commit/8f5deca8337c94baced8b6172cc573b03dfb0af7))
- Auto-detect script vs module in swc-loader so classic sloppy-mode content scripts build like Chrome loads them ([6c0fc548](https://github.com/extension-js/extension.js/commit/6c0fc5483f91765848c30ad2f3056732d3514754))
- Skip PWA web-app manifests when resolving manifest.json and re-resolve to the real extension manifest instead of crashing on PWA-shaped fields ([f0d3f45f](https://github.com/extension-js/extension.js/commit/f0d3f45faaeedb6539aebf8501300eaeda35fa56))
- Warn and ship invalid CSS verbatim instead of failing the build, matching browser error recovery ([4af5697d](https://github.com/extension-js/extension.js/commit/4af5697d65270b70943769c0ead7e45521507e33))
- Preserve in-project icon paths in the output instead of flattening to icons/<basename> so same-name icons stop colliding ([ab99df87](https://github.com/extension-js/extension.js/commit/ab99df875538738174314b967548efc094c1f713))
- Emit a directory web_accessible_resources entry as its files plus a glob instead of crashing on EISDIR ([967f6b39](https://github.com/extension-js/extension.js/commit/967f6b39f344e5dc49d56ba1ecc8f9c2d4e2a4fe))
- Drop scripts/ files the extension never references so data and generator helpers stop breaking builds ([cd5848ef](https://github.com/extension-js/extension.js/commit/cd5848efded62cb0437bc5b001e5f2e882e0fd79))
- Emit both background keys when a manifest declares service_worker and scripts together instead of clobbering one to its raw path ([3dc6ac68](https://github.com/extension-js/extension.js/commit/3dc6ac683716bc5658ee42c437bfed3c17bddba2))
- Exclude Node build/dev tooling from the scripts/ special folder so it stops breaking builds ([36be9dd7](https://github.com/extension-js/extension.js/commit/36be9dd734ce0b76858c2947ae56655da639bf31))
</details>

## 4.0.4 (July 4, 2026)

### 🐛 Fixes

- Resolve bundled sass-loader and less-loader hoisted beside extension-develop so npx and exec builds find them ([0355b4a4](https://github.com/extension-js/extension.js/commit/0355b4a491078669246418b1f355be15a2544440))

<details>
<summary>🧹 Other changes (1)</summary>

- Disable Preact fast-refresh so the rspack 2.x prefresh runtime stops crashing dev with module is not defined ([4f6380cc](https://github.com/extension-js/extension.js/commit/4f6380cc1f100be5e67727f40eaeb4f2a80467b2))
</details>

## 4.0.3 (July 1, 2026)

### 🚀 Features

- Support named browser forks via engine-family manifest keys and build/launch path ([d7c903f4](https://github.com/extension-js/extension.js/commit/d7c903f44d91e9b83006ca1a7eff7bf7bd7bde31))

### 🐛 Fixes

- Harden Firefox banner add-on id fallback to refuse ambiguous guesses ([d776e4d9](https://github.com/extension-js/extension.js/commit/d776e4d98200c42926747953bd1dac4632f47cb3))
- Resolve bundled CSS preprocessor loaders via rspack resolveLoader.modules instead of manual path resolution ([8059fc62](https://github.com/extension-js/extension.js/commit/8059fc62fa016f4382220ae1e29adf6579174771))

<details>
<summary>🧹 Other changes (10)</summary>

- Drop four dead develop exports and rename the firefox follow-up to match its content ([ca49dd54](https://github.com/extension-js/extension.js/commit/ca49dd54403a679e716c7f28707dd9a9fed173e9))
- Rename the source-inspection dirs to cdp/ and rdp/, upgrade the firefox id follow-up ([c3dabd31](https://github.com/extension-js/extension.js/commit/c3dabd31be17727ce404b4c36e047768703fff3e))
- Remove dead controller methods left by source-inspection and pair up chromium/firefox ([53331d86](https://github.com/extension-js/extension.js/commit/53331d86bd72753fa609faa5f0c0410dbacaa623))
- Remove the unwired source-inspection feature ([a2afe400](https://github.com/extension-js/extension.js/commit/a2afe400a320764693cfd4f5967c9b881186271e))
- Remove dead code across create, develop, and extension ([6b8c47dc](https://github.com/extension-js/extension.js/commit/6b8c47dcf85d3c0ddfffb4b802e1b9671cf77e65))
- Single-source optional-dependency install hints from bundled versions and drop dead signature helper ([4e6da9a7](https://github.com/extension-js/extension.js/commit/4e6da9a751c5d76eb504e4f5c6c9a2a38b815f4c))
- Make the not-emitted manifest guard version-aware instead of blaming incremental builds ([df9c51d3](https://github.com/extension-js/extension.js/commit/df9c51d38fcbe8450ee11a28a0498858c4750c38))
- Bump bundled less to 4.6.7 to drop the errant 4.5.1 postinstall that trips build-script warnings ([f4cc754a](https://github.com/extension-js/extension.js/commit/f4cc754a575196fd5f5438b0300a6dd6aaf44a44))
- Detect the Deno runtime so scaffolds suggest deno install and deno task commands ([fd9f869b](https://github.com/extension-js/extension.js/commit/fd9f869b4c4ee3fc45d5c95a761e03160e66b4c7))
- Pre-approve dependency build scripts in scaffolds so install-once just works ([7218b099](https://github.com/extension-js/extension.js/commit/7218b099691aeaefca320c11524ae33c86666958))
</details>

## 4.0.2 (July 1, 2026)

### 🚀 Features

- Add ci:test:create job so create specs run in CI ([f677cd93](https://github.com/extension-js/extension.js/commit/f677cd93e492ccbe2bdf8c722b7fa4765d8f3284))

### 🐛 Fixes

- Resolve chromium manifest keys for Safari and unify the browser-key resolver ([76a43795](https://github.com/extension-js/extension.js/commit/76a43795b7d6a0a1f6f1c7cb7421bbf58a17157b))

<details>
<summary>🧹 Other changes (5)</summary>

- Explain where there other templates are hosted (#477) ([6eda9f84](https://github.com/extension-js/extension.js/commit/6eda9f8400fd0a6add237b9be7233bd138e15ffd))
- Register a default background entry for Safari and version-less manifests ([a1f38e1c](https://github.com/extension-js/extension.js/commit/a1f38e1c0dc7541b1fb2e0425b253bf0acf09e0f))
- Compile create before its tests and gate env-fragile install specs under CI ([f54baeda](https://github.com/extension-js/extension.js/commit/f54baeda6c11f2aa847da9fe4175663a0034e5cd))
- Complete the init-alias create test so it actually imports the template ([a34fda8a](https://github.com/extension-js/extension.js/commit/a34fda8a643f8c4a84e2ff35794c34bba12fca64))
- Strip examples-repo scaffolding files from scaffolded projects ([54f0f4f1](https://github.com/extension-js/extension.js/commit/54f0f4f1e7d78a54e9671562ad0dcd21d0e3a25e))
</details>

## 4.0.1 (June 30, 2026)

- **Extension.js v4 — now on Node.js 22+.** Node 20 is no longer supported. There are no API changes: upgrade Node and your project keeps working.
- **Multi-file content scripts just work in dev.** Split a content script across plain files (a base class in one, the rest in another) — saves now hot-reload without a restart, and a thrown error traces back to your real file and line instead of an inlined blob.
- **Snappier Safari dev.** `extension dev --browser=safari` resyncs in the background instead of blocking on a full Xcode build every save, and a burst of saves collapses into a single rebuild.
- **No leaked browsers.** A dev session that exits on its own now reliably shuts the browser down — no more Chrome or Firefox processes lingering after you're finished.

### 🚀 Features

- Add regression test for @rspack/plugin-react-refresh named export resolution ([8a1b50e0](https://github.com/extension-js/extension.js/commit/8a1b50e07b2b59b22c9d6d0c10925c50404eae92))
- Expose FileConfig type at package level for extension.config.js (#468) ([93577be9](https://github.com/extension-js/extension.js/commit/93577be97d1e135c700b363fcde3abf68ca8711e))
- Support @rspack/plugin-react-refresh v2 export shape and align the contract to 2.0.2 ([3290e85b](https://github.com/extension-js/extension.js/commit/3290e85b43c354ac0ef18480e8013f4f28d41d9d))
- Add v4 release highlights ([57c333d0](https://github.com/extension-js/extension.js/commit/57c333d0b381c5b6a619f4d7d5d50409aa03bddc))
- Surface swallowed Chromium source-inspection failures through author-mode diagnostics ([e0f74b69](https://github.com/extension-js/extension.js/commit/e0f74b69b4c82f7822c504e4df86daaa80d66fb6))
- Surface swallowed locale-validation failures through author-mode diagnostics ([3caf5029](https://github.com/extension-js/extension.js/commit/3caf5029ad9d69ed89a3d887b082a52afa815b12))
- add Brave, Opera, Vivaldi, Yandex, Waterfox and LibreWolf as browser targets ([fdb3f2ed](https://github.com/extension-js/extension.js/commit/fdb3f2ed47563fb0be29b612b62ac0e6422396c4))
- Forward profile keep/copy options through the firefox launch request ([2cbf9d8d](https://github.com/extension-js/extension.js/commit/2cbf9d8da165b1fce1e05bb954eafd0cc9adc030))
- Forward copyFromProfile/keepProfileChanges from config through to the chromium and firefox launchers ([b214f23c](https://github.com/extension-js/extension.js/commit/b214f23c3be1fff50d2a53e88971df78feb84a97))

### 🐛 Fixes

- Override js-yaml, form-data, vite and read-yaml-file to clear dependabot security advisories ([3930424e](https://github.com/extension-js/extension.js/commit/3930424e1c1c0892c5df34290cc1c70158963ccc))
- Resolve CDP/RDP port per browser instance so a second instance cannot capture the first's port ([921fdc1f](https://github.com/extension-js/extension.js/commit/921fdc1fd0743f63531d4d721b443e82a4356dd6))
- Fix theme additional_backgrounds array crash and chrome-extension:// CSS URLs ([ad86c34c](https://github.com/extension-js/extension.js/commit/ad86c34cda4b40ba7eaaabe7f483942ddbe84a1d))
- Fix page-script top-level await and stop wrapping vendored *.min.js ([19189abb](https://github.com/extension-js/extension.js/commit/19189abb923f12212953e59aa9791239121d0bd0))
- Fix WAR parity gaps w/ extension compiler ([851c47d1](https://github.com/extension-js/extension.js/commit/851c47d1805b71d26cccb868cbf39cf696bc7223))

<details>
<summary>🧹 Other changes (44)</summary>

- Route isSubPath through the shared resource-path helper for cross-platform consistency ([900071dc](https://github.com/extension-js/extension.js/commit/900071dc24cb0618f9d4df05bf595dbb37947dbb))
- Centralize resource-path canonicalization in a shared, cross-platform helper ([4b938754](https://github.com/extension-js/extension.js/commit/4b93875456d335e70c02661f970956ef2170bd83))
- Match content-script loader include via canonicalized resource path for Windows ([9300fb30](https://github.com/extension-js/extension.js/commit/9300fb300d803cc79cbdaf5ae76776c9f3f0c56b))
- Canonicalize content-script resourcePath so wrapping works on Windows ([e878bf64](https://github.com/extension-js/extension.js/commit/e878bf643afc72d0b58544bd0d63c15aa7e0b87e))
- Emit prefixed manifest entries for engine-family browser targets ([b4fd0431](https://github.com/extension-js/extension.js/commit/b4fd0431f95fd25f59523e34307904a0f5f73321))
- Drop the duplicated command name from CLI usage strings ([eba667e1](https://github.com/extension-js/extension.js/commit/eba667e1142ee98653a0b38fae8652770e6a0ba4))
- Use the launched Firefox RDP port verbatim instead of re-deriving it ([4398fc80](https://github.com/extension-js/extension.js/commit/4398fc80440ccb1edcde88754a901e1c9205b30d))
- Run launched Firefox headless when MOZ_HEADLESS is set ([e8fed0d4](https://github.com/extension-js/extension.js/commit/e8fed0d40257c8829064f963770f3f858e8c8240))
- Unify reload through the extension service worker for launched and `--no-browser` browsers ([7a330aa7](https://github.com/extension-js/extension.js/commit/7a330aa7356388fafcc132e42ea0ad0159a710b3))
- Reload content scripts under `extension dev --no-browser` and add a connectable host ([a55444f8](https://github.com/extension-js/extension.js/commit/a55444f896e245cc7513185371bbea1bf0db3802))
- Probe the dev server port on the configured host ([0faa8342](https://github.com/extension-js/extension.js/commit/0faa834275e66464b9b1423bc8b3fcda571832fa))
- Inherit chrome:/firefox: manifest keys for browser forks ([c9280248](https://github.com/extension-js/extension.js/commit/c9280248e099c5ca818af3fbbbab44a52ddd6806))
- Parse optional-boolean CLI flags so --flag false disables them ([0b50bd3e](https://github.com/extension-js/extension.js/commit/0b50bd3e335c361708eb938f06fa0f20f7ca3124))
- Update dependencies for Node 22 ([7a4a269c](https://github.com/extension-js/extension.js/commit/7a4a269c07fc05ac6483a1892689051b260fd091))
- Drop Node 20: bump CI and engines.node to 22 so yarn installs resolve which@7 ([ea1c978b](https://github.com/extension-js/extension.js/commit/ea1c978b5b9c359c2ad1e401dbed43296a658852))
- Update message-catalog snapshot for the new firefox-reinject and chromium source-inspection messages ([80a88df6](https://github.com/extension-js/extension.js/commit/80a88df692fecf5a25040dc82a288056d9538846))
- Coalesce Safari dev packaging so saves resync in the background and bursts collapse to one rebuild ([34c11c8f](https://github.com/extension-js/extension.js/commit/34c11c8f132829bc164e6ca59334405ea1382559))
- Type the Firefox RDP wire boundary and client so wrong shapes fail the compile ([4be1701f](https://github.com/extension-js/extension.js/commit/4be1701f119831a76c541139ec93363d8ba5f43e))
- Type the Chromium runner's CDP wire boundary so wrong-shaped protocol data fails the compile ([0af6f5b1](https://github.com/extension-js/extension.js/commit/0af6f5b18023df78d5192c9b605d013181227b62))
- Force-kill the browser synchronously on process exit via a shared teardown module ([66b79e08](https://github.com/extension-js/extension.js/commit/66b79e088efde5b43469e26019788dab9ab0524a))
- Watch and source-map classic multi-file content scripts via a dedicated concat loader ([553d9dbd](https://github.com/extension-js/extension.js/commit/553d9dbdd74320f030252cf67ad6cb54334d3ca4))
- Route Firefox runtime-reinjection failures through the messages convention with author-mode diagnostics ([fc852022](https://github.com/extension-js/extension.js/commit/fc852022f6d02e235607f24e1a71d60bc73244f0))
- Exclude TypeScript declaration files from script entries ([e94bef25](https://github.com/extension-js/extension.js/commit/e94bef250d37b57a7c87311e8b5672183c74892f))
- Warn when building a Manifest V2 extension for a Chromium target ([8df0d895](https://github.com/extension-js/extension.js/commit/8df0d895db8fd14b2603945e8b43bf5fce536239))
- Concatenate and dedupe MV2 background.scripts output ([22b8a732](https://github.com/extension-js/extension.js/commit/22b8a73266e9ec222d6d958e330931104f3307d1))
- Concatenate classic multi-file content scripts so they share one scope ([d8b15336](https://github.com/extension-js/extension.js/commit/d8b15336c00e8bb04335e85d2a1f7702de7c253a))
- Pin which to ^4 so browser-location packages stay Node 20 compatible under yarn ([554e9161](https://github.com/extension-js/extension.js/commit/554e91612446eb84bc3501a44cac18fa9f7cc6a4))
- Declare keepProfileChanges/copyFromProfile on BrowserConfig so the dev config typechecks ([90b97113](https://github.com/extension-js/extension.js/commit/90b971139d9291af88c8a13cf501e7adf51e9970))
- reuse wsl-support package for generic WSL primitives ([0d5c4cf2](https://github.com/extension-js/extension.js/commit/0d5c4cf2e5a374a6d6a2faa82f47be639243ab73))
- Warn (don't fail) on missing CSS url() assets and pass the url through ([8bf09fec](https://github.com/extension-js/extension.js/commit/8bf09fec610621898dd7252dbe48bd6d6579fe81))
- reuse prefers-yarn helpers in develop package manager ([66477cdc](https://github.com/extension-js/extension.js/commit/66477cdcfd2ba7ee61fd1fa0a5f2a8e84b351509))
- import Compiler type explicitly in rspack config ([216a71ed](https://github.com/extension-js/extension.js/commit/216a71ed6e6d2e2127033aeb18aad537472d479e))
- reuse prefers-yarn for package manager detection in create ([dbb29ccb](https://github.com/extension-js/extension.js/commit/dbb29ccbc87e849b2dbedac413902753f3f54092))
- Relocate leading-slash icon paths to icons/ so the manifest matches the emitted files ([b65a4af2](https://github.com/extension-js/extension.js/commit/b65a4af23386da0e6502da094f40a3f4d8afe0a6))
- Seed copyFromProfile once so kept profiles are not clobbered on later runs ([6fb4375d](https://github.com/extension-js/extension.js/commit/6fb4375d4c822f6978f4c1f822e7d72ad1a929c1))
- Update message-catalog snapshot for the new Safari resync messages ([bfe4f8cd](https://github.com/extension-js/extension.js/commit/bfe4f8cdcd49abf423666dfc0c2f02acf053ea31))
- Type 41 manifest-shape casts to drop any so wrong-shaped manifests fail the compiler ([69c522e7](https://github.com/extension-js/extension.js/commit/69c522e714e0e47b488116d95de116cbcfef24d8))
- Throw a readable PM-aware install hint for missing optional deps instead of a raw JSON blob ([c6c9a97b](https://github.com/extension-js/extension.js/commit/c6c9a97b745240b89ce8344d306f2975fa4db498))
- Honor profile:false, copyFromProfile and keepProfileChanges via shared resolve-profile ([135349df](https://github.com/extension-js/extension.js/commit/135349df1d447db3e3372517558e27a355e7db5b))
- Treat unknown chromium extension ownership as not-owned to avoid adopting foreign extensions ([65ab2dbd](https://github.com/extension-js/extension.js/commit/65ab2dbd6bca0b0c74cc7aef2218b26c8ec1209f))
- Re-run Safari converter on manifest changes and preserve Xcode user settings on --force ([89510a40](https://github.com/extension-js/extension.js/commit/89510a40d71c5fe84cf9956e7bbeb8c273f63eac))
- Bump browser-extension-manifest-fields to ^2.2.5 ([8c9ea9d8](https://github.com/extension-js/extension.js/commit/8c9ea9d8f4576fad0b20ba6b77d8e8f3a3ccd577))
- Emit theme image files (theme/images/<basename>) ([d553ebf1](https://github.com/extension-js/extension.js/commit/d553ebf19510bdc7c81c9c824aef2ad768d79b12))
- Exit non-zero when compilation errors prevent output ([ef662f9f](https://github.com/extension-js/extension.js/commit/ef662f9fbc59d13dd978f50d40cb8a1147c24e85))
</details>

## 4.0.0 (June 30, 2026)

### 🚀 Features

- Add open action/command bridge triggers and fix Firefox extension loading (RDP addons actor cache, background producer injection, service_worker→scripts) ([a3c0b8aa](https://github.com/extension-js/extension.js/commit/a3c0b8aa15268405c968ff05bd268e4a27dc282f))

### 🐛 Fixes

- Fix smoke:npx for workspace specifiers and wire it into CI as a packed-tarball guardrail ([0a8a0963](https://github.com/extension-js/extension.js/commit/0a8a096342da3d0caf4e7966e8f7248a152a6213))

<details>
<summary>🧹 Other changes (3)</summary>

- Delete dormant feature-resolve and drop @swc/core and magic-string ([2fe00f58](https://github.com/extension-js/extension.js/commit/2fe00f589ed95b05834b323028976e45ad706ab3))
- Use es-module-lexer instead of @swc/core for content-script default-export detection ([1142eb11](https://github.com/extension-js/extension.js/commit/1142eb113d28a717bf6cba269e684adae903be21))
- Remove dead dependencies from extension-develop (cross-spawn, unique-names-generator, loader-utils, @swc/helpers) ([4514eae6](https://github.com/extension-js/extension.js/commit/4514eae6ef6fb64996d1824d963c8741587a02cc))
</details>

## 3.18.0 (May 28, 2026)

### 🚀 Features

- Surface real CDP port into ready.json for out-of-process source inspect ([f2236401](https://github.com/extension-js/extension.js/commit/f2236401add8f1679bd3af4bed37550fced9f726))
- Add the extension publish command for a shareable url ([af6769c3](https://github.com/extension-js/extension.js/commit/af6769c32eeb3c92e21db15e90ab5ed44cc79dbe))
- Inspect extension surface dom through the in bundle relay ([dd152b9a](https://github.com/extension-js/extension.js/commit/dd152b9aeacebc8d12df9d4c8392199ed7beae61))
- Add the agent bridge act and inspect slices with multi context logs ([e9009e3a](https://github.com/extension-js/extension.js/commit/e9009e3aa4b58c168a09bd2af631bcf721a645b0))
- Add the extension logs command to read and stream the bridge ([2444e38e](https://github.com/extension-js/extension.js/commit/2444e38ec9f734191c80e6f7e457491c24c956b7))
- Add the agent bridge consumer client and ready contract reader ([54666257](https://github.com/extension-js/extension.js/commit/54666257644884a96c98c028878c7706957a6e3b))
- Forward background console output over the control websocket ([1455e882](https://github.com/extension-js/extension.js/commit/1455e88244b64ae375e567377c10d9d18eee35b5))
- Add the agent bridge slice 1 control websocket broker and log file ([bbc964bc](https://github.com/extension-js/extension.js/commit/bbc964bc8cb0371ae1f4ddc076b2c37f6fd02ae5))
- Add CI lint/typecheck gate, readiness schema, producer tests, and reload-matrix smoke ([cd3ada54](https://github.com/extension-js/extension.js/commit/cd3ada54315e787566058bee997df7b9e772a996))
- Enhance zip download mechanism ([78bcbeb9](https://github.com/extension-js/extension.js/commit/78bcbeb9d448525c23a0c63a628f3bb3ad210aea))
- Bundle default `create` template, fix package-manager detection and network timeouts ([038756dc](https://github.com/extension-js/extension.js/commit/038756dc6625215eeeaf4c5f8c6514df396fb102))
- Add (alpha) Safari target support and Chromium/Firefox runner hardening ([a2ea122f](https://github.com/extension-js/extension.js/commit/a2ea122f930c0f10b881cb77885f80913708abd4))

### 🐛 Fixes

- Bump ws to ^8.20.1 to patch GHSA-58qx-3vcg-4xpx ([cb2a6268](https://github.com/extension-js/extension.js/commit/cb2a626890fd79b7ed965c70f708345d4396f844))
- Restore the @rspack/dev-server@2.0.2 SCAFFOLD_OVERRIDES workaround ([c5fad156](https://github.com/extension-js/extension.js/commit/c5fad1565446da3754446b732788fecd7f5600ae))
- Ensure `build` also produces the extension.d.ts file ([c5725a23](https://github.com/extension-js/extension.js/commit/c5725a236f9e75aed32e8c876125618605e70a86))
- Fix the three CI failures revealed once the lockfile was synced ([464d7c81](https://github.com/extension-js/extension.js/commit/464d7c81f328542483062eb82485ddb7d4d5cae0))

<details>
<summary>🧹 Other changes (11)</summary>

- Raise perf-budget defaults to 512/512/1024 KiB ([df09459e](https://github.com/extension-js/extension.js/commit/df09459e0d6caaaa873818e0990c776f1661c977))
- Drop the scaffold-overrides workaround for the @rspack/dev-server 2.0.2 break ([50ddc5af](https://github.com/extension-js/extension.js/commit/50ddc5af1b69bb64fc7cc63e90e8a2baa34d8c5d))
- Remove the implemented readiness design docs ([8420f830](https://github.com/extension-js/extension.js/commit/8420f83051d3eaad85b78e40f23af582fb5bd9a1))
- Snapshot the 21 messages.ts catalogs (readiness item 5c) ([c4403d7b](https://github.com/extension-js/extension.js/commit/c4403d7b5d7bbef18c589359a14a18f1fca1af9c))
- Remove the implemented agent bridge and distribution design docs and fix code comments ([38227bc0](https://github.com/extension-js/extension.js/commit/38227bc077172d2ec28b8f4ddd6be3f3797219c6))
- Pierce closed shadow roots in dev source deep dom ([f4db965d](https://github.com/extension-js/extension.js/commit/f4db965d32324d76d2bd5d2862e19e09c6751709))
- Declare the ws dependency for the control bridge ([a0777eab](https://github.com/extension-js/extension.js/commit/a0777eabedeb135436c3bac5ae2f617e1a6220b4))
- Declare webpack devDep in develop so typecheck gate resolves the vendored HMR fork ([f1300126](https://github.com/extension-js/extension.js/commit/f13001262757704e8ba104d92534e8374cc3ae16))
- Unify package-manager detection across yarn and bun ([736e1c08](https://github.com/extension-js/extension.js/commit/736e1c082263e3ba54713da36f68526408486d7c))
- Review cleanup of extension package ([f5c6ae92](https://github.com/extension-js/extension.js/commit/f5c6ae9247f3995349e3fc8188087d047ae99902))
- Develop plugin review cleanup, hardening, and browser process shim ([74de1bdd](https://github.com/extension-js/extension.js/commit/74de1bdd7198ba6d95f2aa1b5d43c8974199b9b5))
</details>
## 3.17.0 (May 21, 2026)

### 🐛 Fixes

- Bump svelte to 5.55.9 to clear Dependabot XSS advisories ([4cc441cd](https://github.com/extension-js/extension.js/commit/4cc441cd6034f55a94329316d28af0bf85e83c5d))

<details>
<summary>🧹 Other changes (2)</summary>

- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash ([ea94d73a](https://github.com/extension-js/extension.js/commit/ea94d73a917ddd4d4717dd816c68a72bd8820871))
- Write dev manifest.json in afterEmit and switch content-script hashing to contenthash ([d8c17912](https://github.com/extension-js/extension.js/commit/d8c17912e41d6c0a3b285fa8e820c0237d2a5af6))
</details>
## 3.16.1 (May 14, 2026)

### 🐛 Fixes

- Bump fast-uri to ^3.1.2 to clear Dependabot path-traversal + host-confusion advisories ([b49c9b13](https://github.com/extension-js/extension.js/commit/b49c9b1307c02ff9308da9348f1ce6e720fe1b51))
- Sweep orphan content-script roots and ignore current-build roots in cleanupKnownRoots ([ecfce860](https://github.com/extension-js/extension.js/commit/ecfce8601b7b2ccf02505ff881ac2d33310d7b02))
- Gate devtools overlay at content-script entry and harden launcher UX ([a0c745f9](https://github.com/extension-js/extension.js/commit/a0c745f9d2527d2a4b5df8fd017f163c31d1958e))
- Gate devtools overlay at content-script entry and harden launcher UX ([5300edc8](https://github.com/extension-js/extension.js/commit/5300edc8cb27e2f4968bab7c2da7659cd1fce084))

<details>
<summary>🧹 Other changes (5)</summary>

- Replay programmatic chrome.scripting.executeScript calls on /scripts/* edits ([ede537be](https://github.com/extension-js/extension.js/commit/ede537be61cc3e1ee99e87b362d6dfe192319169))
- Only warn for genuinely new files in pages/ and scripts/, not modifications ([ee26b765](https://github.com/extension-js/extension.js/commit/ee26b765421d1cf23462497a72120d4fc2ed6025))
- Auto-resolve workspace subpackage when extension dev is given the monorepo root ([32e06114](https://github.com/extension-js/extension.js/commit/32e061146f23d1f18fe8d63873e4e821fdac0cb9))
- Honor namespaced manifest_version in SetupBackgroundEntry default background entry ([28533531](https://github.com/extension-js/extension.js/commit/28533531a6fda04f27112bfbb4ab455828b5d707))
- Derive Chromium extension ID from load path when no manifest key + no runtime target ([03ffef5b](https://github.com/extension-js/extension.js/commit/03ffef5b905ffd97abdef49190795b6a30a1b127))
</details>
## 3.16.0 (May 7, 2026)

<details>
<summary>🧹 Other changes (6)</summary>

- Ignore benign socket teardown errors in browser process handlers (Templates Nightly Edge ECONNRESET) ([385c955e](https://github.com/extension-js/extension.js/commit/385c955e114f52771d7888f57a356be532f0eb39))
- Force-exit optional-deps smoke after main() so Linux orphans don't hang the CI step ([ddfaeed9](https://github.com/extension-js/extension.js/commit/ddfaeed9aaf3c29fe58ad17b21084710e33dc80c))
- Compile extension-develop before vitest so dist-shape spec has artifacts ([10b87eb7](https://github.com/extension-js/extension.js/commit/10b87eb783cf3d358a98b24b9dd8698166e5fe3f))
- Scope ESM banner to Node-side bundles and add regression gates ([57b14c87](https://github.com/extension-js/extension.js/commit/57b14c8789ae606ad9fa7c46feb7f83fad7f4a3e))
- Flip extension-develop to ESM output for @rspack/core@2 compatibility ([a589d63e](https://github.com/extension-js/extension.js/commit/a589d63e792635ae129cc1b1c77a2523ba24bd9a))
- Update WASM example link in README ([e9caf210](https://github.com/extension-js/extension.js/commit/e9caf210ad432acb4240b4ff365ef149db970faa))
</details>
## 3.15.1 (May 5, 2026)

### 🚀 Features

- Add regression test for PreactRefreshPlugin preactPath option ([a0d1fa98](https://github.com/extension-js/extension.js/commit/a0d1fa98886662ffe8796bd908f39c39cd0a1266))
- Add regression tests for module-context-resolve project-package fallback ([b2e6911b](https://github.com/extension-js/extension.js/commit/b2e6911bf0c11a022e3426236dab04c76ec78474))
- Add remote-mode and template-name fixture resolution to reload-matrix harness ([017ce0fe](https://github.com/extension-js/extension.js/commit/017ce0fe6f3aec29056a53ea6c3e67fe28779faf))

### 🐛 Fixes

- Stop firing chrome.runtime.reload for page-only edits in non-content-script extensions ([76add731](https://github.com/extension-js/extension.js/commit/76add731cd65ce4e77ff1ca5262c8b4c3e9bfaca))

<details>
<summary>🧹 Other changes (14)</summary>

- Update preact.spec assertions to match package-directory preactPath ([80047082](https://github.com/extension-js/extension.js/commit/800470827334bd9dcc7bfaa403280bdcef26c1ff))
- Pass preact package directory to PreactRefreshPlugin (not entry file) ([2e235377](https://github.com/extension-js/extension.js/commit/2e235377a45b0afc14f24408244fb69e05f40358))
- Pass project preact path to PreactRefreshPlugin for pnpm strict layouts ([5580a757](https://github.com/extension-js/extension.js/commit/5580a757035aaf1a53bccd083206990f16d19791))
- Raise content-script perf budget to 256 KiB for framework templates ([1812a011](https://github.com/extension-js/extension.js/commit/1812a01141b7341c0773640ee5625c2e691c25da))
- Apply project-package fallback to module-context-resolve rules ([4b6b329e](https://github.com/extension-js/extension.js/commit/4b6b329ed35a49ac40c1ff0283ef6f384aec9801))
- Trust project package.json when pnpm symlinks hide the contract dep ([5e0a0f79](https://github.com/extension-js/extension.js/commit/5e0a0f79b1915e53460619b058dca094b78e1501))
- Suppress executionContextCreated burst on watched-session attach ([05d9195a](https://github.com/extension-js/extension.js/commit/05d9195a5898f73632e827b9d35c660f37e9b479))
- Preserve sibling content_scripts entries during dev reinject ([78a2c1fb](https://github.com/extension-js/extension.js/commit/78a2c1fb1758e66d938bbbf8926d633f1f2d46ff))
- Inline content-script CSS as data URLs to close the WAR gap on rspack 2.x ([0120b2db](https://github.com/extension-js/extension.js/commit/0120b2dbbaa55ece2343b77328564973daaab895))
- Relocate reload-matrix harness to _FUTURE/examples per workspace convention ([a5706d7c](https://github.com/extension-js/extension.js/commit/a5706d7c4c698b4320f7dffc81c6ffbfe64c8418))
- Extend reload-matrix harness with multi-scenario runner and 5-row matrix ([ed3c294e](https://github.com/extension-js/extension.js/commit/ed3c294eaf7f98b6476efa7818f816a052f41ca9))
- Scaffold reload-matrix CDP harness for ground-truth reload measurement ([65df59c1](https://github.com/extension-js/extension.js/commit/65df59c1b2067f9bfc0c0e4797982a5340506ae4))
- Revert "Serialize and coalesce reload requests at the controller boundary" ([07c16fd7](https://github.com/extension-js/extension.js/commit/07c16fd7a24c0fa0b3f8ef7ad201d063f9baa4a5))
- Serialize and coalesce reload requests at the controller boundary ([daf8e451](https://github.com/extension-js/extension.js/commit/daf8e451fc8d308bcec4fe5f45ea1b2fe82f42a7))
</details>
## 3.15.0 (May 4, 2026)

### 🚀 Features

- Add per-category perf budgets tuned for browser-extension workloads ([546664d0](https://github.com/extension-js/extension.js/commit/546664d080b2181800500198ec5186a23de8a885))
- Add script to inventory perf warnings across _FUTURE example builds ([5d5478b5](https://github.com/extension-js/extension.js/commit/5d5478b592a4db8cd51b36478319cbf270568d7c))

### 🐛 Fixes

- Prevent companion extension duplication ([c0e710cd](https://github.com/extension-js/extension.js/commit/c0e710cd77591dd8ecab660ca368682628f62892))
- Stop installing unused firefox/chromium in cli CI suite to dodge snap hang ([19103082](https://github.com/extension-js/extension.js/commit/19103082a81c2dc357fb5ddcb5409d4057614ce1))
- Fix nightly CI template builds and the playwright-core resolution ([21d0dde5](https://github.com/extension-js/extension.js/commit/21d0dde5c5914d54210c238a6e3937b9a4ebe7ab))
- Stop devtools companion from toggling user extension via chrome.management ([2716143f](https://github.com/extension-js/extension.js/commit/2716143f07bb728b668c8dab11441247eccc6ba6))
- Resolve _locales at the project root and reject manifest-dir layout ([8f5f655d](https://github.com/extension-js/extension.js/commit/8f5f655df0f2a1776e4f31c1e866e10e46f84cf2))
- Fix manifest/SW/locale reload classifier and lock companion-targeting in tests ([e90ee3e9](https://github.com/extension-js/extension.js/commit/e90ee3e90acfea3c88a490bb1d53c5b83cc4e76d))
- Stop passing chromium-only flags to Firefox launch ([d2d20aaa](https://github.com/extension-js/extension.js/commit/d2d20aaa95bdcde564cc539339479c6b29c23101))
- Gate chromium-only background listeners in extension-js-devtools ([0e172667](https://github.com/extension-js/extension.js/commit/0e1726678553c4f21ab3d1c0b0cd39fafccd266c))
- Stop manifest icons diff from firing spuriously on every rebuild ([c56a175b](https://github.com/extension-js/extension.js/commit/c56a175ba3181aeefb8e67869144908e6449772c))
- Fix bad output of the (re)compilation banner ([b67a444e](https://github.com/extension-js/extension.js/commit/b67a444eccb93c81a9e0507d89c0979b3962c3c9))
- Stop extension-develop resolver from escaping node_modules into outer monorepo ([2ddfc9b9](https://github.com/extension-js/extension.js/commit/2ddfc9b9d9195c79ec1ff4872d8a5be23d5b9f67))
- Fix HTML live-reload regression on rspack 2.x and lock the contract in tests ([65d38ee5](https://github.com/extension-js/extension.js/commit/65d38ee5b7a2679ecafdff58e723db563e0c50d6))
- Restore content-script wrapper in production to keep mount call alive ([6220725c](https://github.com/extension-js/extension.js/commit/6220725c19e5f2158bcce1b8deccf6c09d536306))

<details>
<summary>🧹 Other changes (21)</summary>

- Fire chrome.runtime.reload() once per save instead of N times racing on the eval response ([60745b23](https://github.com/extension-js/extension.js/commit/60745b23380544a6a4398754718fe60ad95af97b))
- Anchor relative profile paths to the rspack context so sequential examples do not share one profile ([727d9b29](https://github.com/extension-js/extension.js/commit/727d9b2963c765ff17b3996b3fed8cc07f7ce28e))
- Bump browser-extension-manifest-fields ([4b37af31](https://github.com/extension-js/extension.js/commit/4b37af316fbc0b370a67fc9a0681ae24a04e974a))
- Pick user extension over companion when version + manifest_version tie ([0705456d](https://github.com/extension-js/extension.js/commit/0705456d67dafd367c50f76985648209c7384b8f))
- Compile extension CLI on demand from companion Firefox MV3 spec ([f0200792](https://github.com/extension-js/extension.js/commit/f02007920bb55dbeecb3d1b2b6cdff91db31ca8e))
- Update README.md ([43042601](https://github.com/extension-js/extension.js/commit/43042601e84b852cce2133dc5284b73532bef3e1))
- Dedupe extension load list and ignore companion shadows of built-in packages ([021d789e](https://github.com/extension-js/extension.js/commit/021d789e36a7a38bfaebe21505bf6659d582fc98))
- Skip dependency install in web-only mode to fix extension dev crash on Chrome samples ([70d41a67](https://github.com/extension-js/extension.js/commit/70d41a678a8af912ea9982963b0d8001bf8a3992))
- Rework README with growth-oriented hero, comparison table, and ship-to-store guide ([6e292dfa](https://github.com/extension-js/extension.js/commit/6e292dfae0f17d71128847e81c8c3eb9f7593df7))
- Lock in companion-extension Firefox bundle as MV3-API-free ([c72dadab](https://github.com/extension-js/extension.js/commit/c72dadab9b976d00fa759084b6851b0ebbbeea1b))
- Force single Playwright worker to eliminate content-reload spec race ([b5f4b85f](https://github.com/extension-js/extension.js/commit/b5f4b85f7119266a85a53c872cb577d30142bc2f))
- Hold firefox apt package so --with-deps does not trigger snap install ([bb4c6f28](https://github.com/extension-js/extension.js/commit/bb4c6f2871a3aa1ec27623f1df5452897ab11326))
- Soften strict _locales layout policy from build error to warning ([4cc4f82d](https://github.com/extension-js/extension.js/commit/4cc4f82dd310b73b82040b3bae1c10d4a5674555))
- Mark generated templates/package.json as ESM to keep spec imports working ([19ceeb99](https://github.com/extension-js/extension.js/commit/19ceeb99755828c498d3e988c7e506cd0d67a08e))
- Teach perf-warning inventory to parse the new PerfBudgetWarning block ([ada3b652](https://github.com/extension-js/extension.js/commit/ada3b65264cb970812dc7d2595ba2bc1571dc197))
- Discriminate page vs content errors in devtools dialog by script origin ([599fc7dd](https://github.com/extension-js/extension.js/commit/599fc7dd542bf0518f7dd48fc63a66590343b841))
- Pick newest content-script bundle by mtime so reload reflects latest rebuild ([f38f3060](https://github.com/extension-js/extension.js/commit/f38f3060c25f4332067fb9f2fab6e9e697282641))
- Make Firefox welcome tab open reliably on first run ([9cf4dae8](https://github.com/extension-js/extension.js/commit/9cf4dae84f667ba5ca5d66f888a921799d3debc9))
- Normalize watch path separators in dev-server config spec for Windows CI ([c50d2b8e](https://github.com/extension-js/extension.js/commit/c50d2b8eaa230a8161936db6c99f65744de71989))
- Normalize watch path separators in dev-server config spec for Windows CI ([27400eb2](https://github.com/extension-js/extension.js/commit/27400eb29fe49f980a6fbd0ccd9c7519a29f9abd))
- Drop dist-build dependency from minimum-script-file/preact-refresh-shim specs ([415f505f](https://github.com/extension-js/extension.js/commit/415f505fd5bca842a522a219bec36a81ee660b87))
</details>
## 3.14.5 (April 25, 2026)

### 🐛 Fixes

- Resolve CJS requires via the `require` exports condition (#445) ([c4e85e43](https://github.com/extension-js/extension.js/commit/c4e85e43fe0bd2e445f57eff3d61df815ddd5a71))
## 3.14.3 (April 24, 2026)

### 🚀 Features

- Add content-script reload regression tests ([0ff04cf7](https://github.com/extension-js/extension.js/commit/0ff04cf7cf483d4ab496144c368e33bce149223c))

### 🐛 Fixes

- Restore the per-rebuild "compiled successfully" stdout line in browser-launch mode ([271297e7](https://github.com/extension-js/extension.js/commit/271297e784371e011d5b64cd022883570c87cdf5))
- Fix content-script hot reload ([47a067a0](https://github.com/extension-js/extension.js/commit/47a067a0f8ab98e922cab9b80d7e672dce2b219d))

<details>
<summary>🧹 Other changes (3)</summary>

- Pin uuid >=14 to close Dependabot alert 143 ([2a6fb8d8](https://github.com/extension-js/extension.js/commit/2a6fb8d8b4cab748c997b6216cfdee862b66dc13))
- Cover fresh tabs and page reloads for content-script edits ([55c80040](https://github.com/extension-js/extension.js/commit/55c80040a5de2be1b883fbbff118c893478213d8))
- Scope browser-root auto-attach to extension targets, silence debugger infobar ([e31853fa](https://github.com/extension-js/extension.js/commit/e31853fabb7adc2a4a710f337f241e01de9ae885))
</details>
## 3.14.2 (April 22, 2026)

### 🚀 Features

- Forward extension.config.js browser/command fields to the browser launcher ([28b585b0](https://github.com/extension-js/extension.js/commit/28b585b0d41b47d58c5b03045fccbb7988401fbe))
## 3.14.1 (April 22, 2026)

### 🚀 Features

- Surface reserved-folder diagnostic for Node.js scripts dropped into scripts/ ([7bac8509](https://github.com/extension-js/extension.js/commit/7bac8509d1b7bdb824f25f590d936dd0fad5352b))

<details>
<summary>🧹 Other changes (1)</summary>

- Disable module concatenation in dev to fix react-refresh __webpack_module__ clash ([c2b2b66f](https://github.com/extension-js/extension.js/commit/c2b2b66f71043259b411a1c2fa0aaec759cd1ab9))
</details>
## 3.14.0 (April 21, 2026)

<details>
<summary>🧹 Other changes (4)</summary>

- Drop ?url query bypass in CSS loaders, add end-to-end regression spec ([eda750a2](https://github.com/extension-js/extension.js/commit/eda750a274aef85b0dba0041a6fff5261cfae00d))
- Pin @rspack/dev-server to ^1.2.1 until @rspack/core 2.x ships stable ([794e400c](https://github.com/extension-js/extension.js/commit/794e400c71945a8b557edc160f6cfb6921a5d794))
- Default --install to off on extension create ([135c58cc](https://github.com/extension-js/extension.js/commit/135c58cc5a4799a7abc3ffa5fb007698887aefcb))
- Collapse CLI telemetry to 2 events with sampling, cap, and dedup ([c87ef941](https://github.com/extension-js/extension.js/commit/c87ef9413c75ee4f7b81969121a8024a0b3a3924))
</details>
## 3.13.5 (April 11, 2026)

### 🐛 Fixes

- Fix --port 0 (OS-assigned port) crashing the dev server ([eb729298](https://github.com/extension-js/extension.js/commit/eb72929828e459a6e077265c4f5f45b2bcf99a6b))
## 3.13.4 (April 11, 2026)

### 🐛 Fixes

- Fix user project dependency resolution for pnpm dlx and npx builds ([a0b44bfa](https://github.com/extension-js/extension.js/commit/a0b44bfa3d3d0814216c12deaec2505dd42ab519))

<details>
<summary>🧹 Other changes (1)</summary>

- Respect --install flag to skip dependency install in build/dev commands ([298dd072](https://github.com/extension-js/extension.js/commit/298dd0720a99dee56c44299d131ddc585f602d8d))
</details>
## 3.13.3 (April 11, 2026)

### 🚀 Features

- Add browser spec tests for CDP and RDP transport layers ([ce48d811](https://github.com/extension-js/extension.js/commit/ce48d811a9150af8bbc2d12d1c0bb74a4c1ea7cb))

### 🐛 Fixes

- Fix release pipeline changelog filters and apply lint formatting ([9a7c5d58](https://github.com/extension-js/extension.js/commit/9a7c5d5871fdabb5c87e2dbd7608735c68be7fb1))
- Fix stale programs/cli path in first-dev smoke script ([40c54ff8](https://github.com/extension-js/extension.js/commit/40c54ff84e91f668d1ab205f5737cc108f2a58b0))
- Harden browser CDP/RDP reliability and observability ([8b29b85d](https://github.com/extension-js/extension.js/commit/8b29b85d3b7e1b8e5867f16db956f7e8a8191694))

<details>
<summary>🧹 Other changes (2)</summary>

- Remove dead code, extract shared utilities, fix signal race, simplify core plugins ([ddaabbd0](https://github.com/extension-js/extension.js/commit/ddaabbd0287f579b01c6f6d04f8d912bb20e22e6))
- Make extensionCreate API/AI-friendly with injectable logger and structured result ([9508cbfd](https://github.com/extension-js/extension.js/commit/9508cbfd04859a20109dc1ad36cce926b59ecbe4))
</details>
## 3.13.0 (April 9, 2026)

### 🚀 Features

- Add Linux CI Chromium sandbox flags for CDP dev tooling ([0181e730](https://github.com/extension-js/extension.js/commit/0181e7306cac0440b86572d53008bac6c64d041a))
- Add BuildEmitter event API to extension-develop ([6c4b9927](https://github.com/extension-js/extension.js/commit/6c4b99277d2845a88e9a5b2cb283431bfdba65db))
- Add lightweight preview entry to develop for fast extension preview ([a4cfb862](https://github.com/extension-js/extension.js/commit/a4cfb862a4fc1d8e9f7a518a89bf356000336104))

### 🐛 Fixes

- Resolve release notes range when stable tag is off current branch ([34ce0187](https://github.com/extension-js/extension.js/commit/34ce01878e8a3871ae5b6ec6a93a1bb253a9ae14))

<details>
<summary>🧹 Other changes (3)</summary>

- Remove extensionStart from develop — CLI now orchestrates build + preview ([cc329680](https://github.com/extension-js/extension.js/commit/cc3296808408cc34da8156edad3b3c5934a62e7c))
- Orchestrate start command with separate build + preview calls ([b9ad1987](https://github.com/extension-js/extension.js/commit/b9ad198795d2e3ff26211172c97e1a6598fd62b4))
- Optimize GitHub Actions workflows for faster CI ([a6c08068](https://github.com/extension-js/extension.js/commit/a6c080682cf3cb9ae25c8038c965a2a15badb22d))
</details>
## 3.12.1 (April 9, 2026)

### 🐛 Fixes

- Fix CDP race condition, log leak, globalThis state, and MAIN world manifest persistence ([1b220bb9](https://github.com/extension-js/extension.js/commit/1b220bb91d2bd6bc5e2645a4b55fe5142113f48c))
## 3.12.0 (April 9, 2026)

### 🐛 Fixes

- Fix CVE-2026-22028 preact VNode injection and CodeQL code sanitization alert ([5b1bd6da](https://github.com/extension-js/extension.js/commit/5b1bd6da5b6dcd49f90736252332fa9b4721731f))
- Fix CodeQL Firefox inspection and harden dev-server client resolution ([8b82011d](https://github.com/extension-js/extension.js/commit/8b82011d036ae76fd2ed1126454d3270e571613c))
- Resolve HMR client paths from extension-develop at injection time ([c2650714](https://github.com/extension-js/extension.js/commit/c26507149304ff627b6d000e28afcd650117650d))

<details>
<summary>🧹 Other changes (8)</summary>

- Default create template to javascript and make template option optional ([cd457fe1](https://github.com/extension-js/extension.js/commit/cd457fe1a51a00fa2285c13d53ee80ee11850db4))
- Use workspace:* for extension dev dependency ([ea7982da](https://github.com/extension-js/extension.js/commit/ea7982da3afaae8dfd5a801df4cf0befff833557))
- Remove isolated-deps and bundle extension-develop toolchain ([ed284849](https://github.com/extension-js/extension.js/commit/ed284849ae575e354171176b062f91643219622b))
- Use geometric triangle prefix for signature log lines across CLI and webpack ([70d5d95b](https://github.com/extension-js/extension.js/commit/70d5d95b89e70327a803d83a1d86c4219cc71e15))
- Update Vite/Vitest ([81f3e250](https://github.com/extension-js/extension.js/commit/81f3e25099d412efa9f1315f519435615588a88a))
- Normalize path separators in HMR entry assertions for Windows ([e4a7f83e](https://github.com/extension-js/extension.js/commit/e4a7f83e6c315b603e4878e7c831db3e561ab842))
- Bump go-git-it to 5.1.5 ([0ec2602e](https://github.com/extension-js/extension.js/commit/0ec2602e455cea395a4fa1ece88a43cd4bd2ca77))
- Show Firefox add-on ready line in dev and align ready copy ([10067e85](https://github.com/extension-js/extension.js/commit/10067e850f9bac8aab32f7680e0c8786a7aa6323))
</details>
## 3.11.1 (April 8, 2026)

### 🚀 Features

- Add strip and remove dev server runtime from content script bundles ([d3e10aac](https://github.com/extension-js/extension.js/commit/d3e10aace378af3292e9348b2b55812cc981e8a7))
- Add canonical content script naming contracts and entry helpers ([aa8f4b17](https://github.com/extension-js/extension.js/commit/aa8f4b17f36f4a8f2d18b7d8d68605e64fcd5772))

### 🐛 Fixes

- Fix CI workflow script name and Windows path double-slash normalization ([3e4bd2ca](https://github.com/extension-js/extension.js/commit/3e4bd2ca1e8edcde9aa32dadf79165c1b631ef0a))
- Fix pre-existing test failures in dev-server and update-manifest specs ([eb35a151](https://github.com/extension-js/extension.js/commit/eb35a151eee962c2fb9ce48f4930fc3233a17630))
- Fix Firefox content reload parity with Chromium ([80eb7fde](https://github.com/extension-js/extension.js/commit/80eb7fde55084a477632b4efdd2b896063a238f1))
- Fix Chromium content reload: suppress manifest reason, reload extension after reinject, await controller ([200d1576](https://github.com/extension-js/extension.js/commit/200d1576da1aa0a4f94708f3e53e330bfdae51c6))
- Resolve hashed content script filenames in CDP controller for reinject ([95d09c87](https://github.com/extension-js/extension.js/commit/95d09c87564b84dcca01208b72017dfe802ebd3b))

<details>
<summary>🧹 Other changes (10)</summary>

- Ignore programs/create/.npmrc so local npm tokens are never committed ([97576321](https://github.com/extension-js/extension.js/commit/9757632127929006d087e1e36803e0f5e90abf3a))
- Normalize Windows drive slashes after backslash replace ([c3478484](https://github.com/extension-js/extension.js/commit/c3478484142706251553fb45a6f2cd5827a6752a))
- Replace in-tree optional-deps installer with isolated-deps package ([821c6b22](https://github.com/extension-js/extension.js/commit/821c6b224108b0740008da28ad7bc326256e4914))
- Simplify reload internals before release ([4b574838](https://github.com/extension-js/extension.js/commit/4b57483810bb673c536cd7da8c1be24555e558d3))
- Consolidate ci-scripts into scripts and remove dead scripts ([21e04fac](https://github.com/extension-js/extension.js/commit/21e04fac368beb3f882dfa135c03c96a62204cde))
- Update changelog and companion extension adjustments ([30262963](https://github.com/extension-js/extension.js/commit/3026296323000723b3a84f9b3ead62d39d4c6a11))
- Refactor browser plugins, CDP/RDP inspection, and dev server internals ([97ec810d](https://github.com/extension-js/extension.js/commit/97ec810dd4e5d69d3ad149e2b4cede90f3b5cfbe))
- Wrap extension messaging sendMessage in try-catch in chunk loader ([a8d6e2a0](https://github.com/extension-js/extension.js/commit/a8d6e2a0db672abc8e8fe34861e93cac5b99acca))
- Hash content script filenames in dev mode to bust browser cache on hard reload ([ba3e497d](https://github.com/extension-js/extension.js/commit/ba3e497d26d584ffd778f860fe8102aa84c4c807))
- Rewrite content script wrapper with reinject lifecycle and cleanup registry ([89f5ae4a](https://github.com/extension-js/extension.js/commit/89f5ae4a2f0d0bdc5e030100cbd1aa6e01185a91))
</details>
## 3.10.3 (April 8, 2026)

### 🐛 Fixes

- Fix Windows optional dependency installs and smoke coverage ([f675ad54](https://github.com/extension-js/extension.js/commit/f675ad5413bc192bcf230cd4f2783f6554e5f581))
- Fix content script CSS fallback restoration ([7c3321f2](https://github.com/extension-js/extension.js/commit/7c3321f26510e8f1045d3815c3dbca5dc08a60fd))

<details>
<summary>🧹 Other changes (1)</summary>

- Offload browser discovery to location libs ([6e5746df](https://github.com/extension-js/extension.js/commit/6e5746dfea7eaa09122dfad11de04b53136d7a79))
</details>
## 3.10.2 (April 8, 2026)

### 🐛 Fixes

- Fix content script manifest CSS restoration ([3f7517cc](https://github.com/extension-js/extension.js/commit/3f7517cc0cf86bac4787d7c6745e12c136a22c5e))

<details>
<summary>🧹 Other changes (2)</summary>

- chore: sync build deps tracking manifest ([c5622538](https://github.com/extension-js/extension.js/commit/c56225387f586e92e36fb935e49b9581b9f350aa))
- Bump dependency bundle and clear audit alerts ([6b01a343](https://github.com/extension-js/extension.js/commit/6b01a343153930c9693e83111e7218e73981f16d))
</details>
## 3.10.1 (April 8, 2026)

<details>
<summary>🧹 Other changes (11)</summary>

- Added -b shortcut to browser option (#430) ([cca28133](https://github.com/extension-js/extension.js/commit/cca281338a24ac0ba57085f6fba68d89813d256f))
- Stabilize Windows pnpm smoke workspace paths ([aa09acb5](https://github.com/extension-js/extension.js/commit/aa09acb53f777fd27c93d4ded61032fd5e5dcb7e))
- Stabilize Windows npm optional dependency preflight ([daaca4e0](https://github.com/extension-js/extension.js/commit/daaca4e06e71513788dd2a132568dc99c35ef0e9))
- Handle cross-drive Windows file specifiers in pnpm smoke ([df7f9d5f](https://github.com/extension-js/extension.js/commit/df7f9d5fb861932a0bab291c6bfd3de65e5522b8))
- Align pnpm optional-deps smoke with source-under-test ([1aad9776](https://github.com/extension-js/extension.js/commit/1aad97765d145e950babb5c76077b7967f4aaf9e))
- Generalize optional dependency contracts across webpack tooling ([3cb55980](https://github.com/extension-js/extension.js/commit/3cb559801408b7413b91ea5a416d6fb87c5c60f4))
- Enforce transactional optional dependency installs ([de00809c](https://github.com/extension-js/extension.js/commit/de00809c3ab4a7c390a1f468b427178d4cac5018))
- Setup internal standalone library for installing and resolving on-demand tooling ([f57cd715](https://github.com/extension-js/extension.js/commit/f57cd715437ff60c97ed8369d29592667493def5))
- Setup internal standalone library for installing and resolving on-demand tooling ([20c0b6b9](https://github.com/extension-js/extension.js/commit/20c0b6b9a35fa658dd9a84cda937a4e90e94e4cd))
- Stabilize CI platform-specific optional deps assertions ([8735e20c](https://github.com/extension-js/extension.js/commit/8735e20c4dfe05e59a6215d212cb88cf974c8710))
- Setup internal standalone library for installing and resolving on-demand tooling ([dfe59ce2](https://github.com/extension-js/extension.js/commit/dfe59ce2599cbb4a88fd845f5cedf1aaedede4c1))
</details>
## 3.10.0 (April 8, 2026)

### 🐛 Fixes

- Fix excludeBrowserFlags forwarding in dev config ([40eba59c](https://github.com/extension-js/extension.js/commit/40eba59cabbfaa29e50f138c3984519a9246019e))
- Fix optional dependency installs across framework tooling ([c88e7b62](https://github.com/extension-js/extension.js/commit/c88e7b62760af7a3ff25866790af83598b2d727e))
- Fix Discord release not working ([1f332396](https://github.com/extension-js/extension.js/commit/1f3323960b446e7b6abccec6bcff64cd5ea306a6))
## 3.9.5 (April 8, 2026)

### 🐛 Fixes

- Fix GitHub Actions Node 24 deprecation warnings ([3e4f07f4](https://github.com/extension-js/extension.js/commit/3e4f07f41abd947e3d0483bc018d9d28126815aa))

<details>
<summary>🧹 Other changes (1)</summary>

- Preserve Rspack branding in optimization warnings ([bd7874a4](https://github.com/extension-js/extension.js/commit/bd7874a4ad68d7a56760f8100495703d31e94837))
</details>
## 3.9.4 (April 8, 2026)

<details>
<summary>🧹 Other changes (2)</summary>

- Improve managed browser install guidance. ([d7bcbcd8](https://github.com/extension-js/extension.js/commit/d7bcbcd870a34d3baaf1eaa161109c3f64f5ab5e))
- Prefer the project-local develop runtime during create ([41f2b912](https://github.com/extension-js/extension.js/commit/41f2b91290c5888ac4951e67cf9d7f631a748530))
</details>
## 3.9.3 (April 8, 2026)

### 🐛 Fixes

- Fix Dependabot alerts ([3791de9f](https://github.com/extension-js/extension.js/commit/3791de9ff9c2eeb7ea3c7a7d21cbd0da7e095928))
- Fix React optional dependency installs for content dev ([1840b091](https://github.com/extension-js/extension.js/commit/1840b091cc48631f807d2eba6f56b0d7fe0ec20a))
- Harden managed browser profile reuse ([b2aeb980](https://github.com/extension-js/extension.js/commit/b2aeb980d2b3ca02adf086742b58f23ef097ea3c))
## 3.9.1 (April 8, 2026)

### 🐛 Fixes

- Fix Vue optional dependency installs for consumer builds ([a402a25f](https://github.com/extension-js/extension.js/commit/a402a25f4eb44f051882bcdd670e21aef7a68430))
## 3.9.0 (April 8, 2026)

### 🚀 Features

- Enhance output data view for performance hints ([107da296](https://github.com/extension-js/extension.js/commit/107da29612499ddc54e5203a77b7354c413d83c5))

### 🐛 Fixes

- Fix publish workflow ([42243496](https://github.com/extension-js/extension.js/commit/4224349610695198acfac9e3d34f67a876ececfb))

<details>
<summary>🧹 Other changes (2)</summary>

- Generate curated stable release notes ([7771574e](https://github.com/extension-js/extension.js/commit/7771574e19c478ca87c2fefef6c007e5c57ad488))
- Richer build output ([bef3ffc8](https://github.com/extension-js/extension.js/commit/bef3ffc86cd96021807c99bfda02c5e56c45b440))
</details>
## 3.8.16 (April 8, 2026)

### 🐛 Fixes

- Fix extension.config root resolution with src manifests ([3d9d65d1](https://github.com/extension-js/extension.js/commit/3d9d65d1261e78154faf93d1897fad4c0ec0d35d))

<details>
<summary>🧹 Other changes (2)</summary>

- Preserve webpackIgnore comments in production builds ([49d81f16](https://github.com/extension-js/extension.js/commit/49d81f1639ba3f8eba81cf2fceba3594461beeaa))
- Preserve CLI spacer lines in Turbo-prefixed output ([511b0e23](https://github.com/extension-js/extension.js/commit/511b0e23b8ecaadf318e5bff66b84dfc97432ca7))
</details>
## 3.8.14 (April 8, 2026)

### 🐛 Fixes

- Fix regression on optional deps install on Windows ([6a0af460](https://github.com/extension-js/extension.js/commit/6a0af4600a6c703e63345b3921ce4bd10867c910))
## 3.8.13 (April 8, 2026)

<details>
<summary>🧹 Other changes (1)</summary>

- Improve build warning summaries and remove contradictory success output ([d2a9583b](https://github.com/extension-js/extension.js/commit/d2a9583b4bc777eeb72ca8f3c40bcaf884c1925f))
</details>
## 3.8.12 (April 8, 2026)

### 🚀 Features

- Add banner to --wait output ([c317a32e](https://github.com/extension-js/extension.js/commit/c317a32e58f3fed731c657bbcd4b6437c923e4eb))
- Add staging `monorepo` example as ignored ([0e090593](https://github.com/extension-js/extension.js/commit/0e09059339dbe1d8d5683f6143429d173ffdfa20))
- Add --wait support for superior Playwright DX/AX ([26300d30](https://github.com/extension-js/extension.js/commit/26300d3038fddec59d422b0bb2a7efba93ce51ed))

### 🐛 Fixes

- Fix rebase regression for the --wait output banner ([76abe121](https://github.com/extension-js/extension.js/commit/76abe121662cf1596bf4b2e76407cadd8a9de7c1))
- Patch vulnerable immutable transitive dependency ([1e67066d](https://github.com/extension-js/extension.js/commit/1e67066d60557ae8e919a17c9f442302ca76aba8))

<details>
<summary>🧹 Other changes (1)</summary>

- Improve --wait for `start` command ([df1eb61d](https://github.com/extension-js/extension.js/commit/df1eb61ddd3b89b2c9920fd58c52f548babb0f77))
</details>
## 3.8.11 (April 8, 2026)

<details>
<summary>🧹 Other changes (2)</summary>

- Rename no-runner behavior to no-browser ([1a4c845a](https://github.com/extension-js/extension.js/commit/1a4c845afb3502635a9fb3eba7908106b0560e4b))
- Invalidate optional-deps preflight cache when lockfiles change ([c76331bd](https://github.com/extension-js/extension.js/commit/c76331bd2f0a98baec0455836d69991039fada12))
</details>
## 3.8.10 (April 8, 2026)

### 🚀 Features

- Support monorepo root env fallback for extension config loading ([25cd214e](https://github.com/extension-js/extension.js/commit/25cd214e8099054244bc7f7080eb3bd40e5afe2d))

<details>
<summary>🧹 Other changes (1)</summary>

- No loading for first-time optional deps install ([1d6fb8a2](https://github.com/extension-js/extension.js/commit/1d6fb8a2e5289cef404341dc27ea600fe961d5dd))
</details>
## 3.8.9 (April 8, 2026)

### 🐛 Fixes

- Resolve 2 security vulnerabilities (#414) ([98ab23b4](https://github.com/extension-js/extension.js/commit/98ab23b4008b9b45296b29f4e15c4e6ba087d163))

<details>
<summary>🧹 Other changes (4)</summary>

- Scope optional peer runtime checks to Vue ([43b84c70](https://github.com/extension-js/extension.js/commit/43b84c7031b660d9ed80067a4c6863782a212317))
- Remove vulnerable serialize-javascript from build-deps lockfile ([93c4be40](https://github.com/extension-js/extension.js/commit/93c4be401dec80ef626bb74aac0bb2e383e9902c))
- Hotfix for Vue examples not working ([68e27a4d](https://github.com/extension-js/extension.js/commit/68e27a4d431e9f2d0ad2a2343fea1c2f699d3622))
- Setup experimental error overlay ([f2dbdbe2](https://github.com/extension-js/extension.js/commit/f2dbdbe2696465aa4e27b2280dae86d08bf66bc9))
</details>
## 3.8.8 (April 8, 2026)

### 🚀 Features

- Add deterministic deep content-script reload validation. ([e40f2072](https://github.com/extension-js/extension.js/commit/e40f20728d37b20c8cf339cbc39b577ae04558d7))
- Add more scripts to default creation projects ([750f14f8](https://github.com/extension-js/extension.js/commit/750f14f82222317d48845e76fcf003012ed10658))

### 🐛 Fixes

- Fix dependabot alerts ([0819f9a7](https://github.com/extension-js/extension.js/commit/0819f9a74f8bc57d505f57cc0d026ad19ad490d9))
- Gate first-run canary reload regression ([3fb0c8a1](https://github.com/extension-js/extension.js/commit/3fb0c8a1baab5422fc3ef613a4b94bc4d0441df6))
- Harden Chromium CDP startup against short-circuit failures ([1be8a0b5](https://github.com/extension-js/extension.js/commit/1be8a0b555d708bacc9d949ce25cf1177f7bf504))
- Fix warn-dev-mode spec logger mock typing ([6d8c396c](https://github.com/extension-js/extension.js/commit/6d8c396c4823419dd2c6743e49fcf5722adb7e67))
- Harden CDP extension ownership during first-run startup ([e244ca42](https://github.com/extension-js/extension.js/commit/e244ca425c570ec45084db5f996e8e552b56b563))
- Fix Chromium hard-reload test ([a55e2d51](https://github.com/extension-js/extension.js/commit/a55e2d51bd5e2d2f635f362e942e41ab4d6cf11f))
- Fix first-run Chromium extension disable regressions ([52128ca8](https://github.com/extension-js/extension.js/commit/52128ca8a5e1caad55586f8c407583968777f6cb))
- Fix hard-reload running on first runs and breaking UX ([70fd0f5e](https://github.com/extension-js/extension.js/commit/70fd0f5ef3905c188c9c1f98798ed7c324f5ba9e))
- Avoid Chromium extension hard reload on initial dev build ([13de5c11](https://github.com/extension-js/extension.js/commit/13de5c11ecb8ca8c8de72d7a5c3580620b27a09e))

<details>
<summary>🧹 Other changes (4)</summary>

- Improve version resolution during create step ([bca90b1b](https://github.com/extension-js/extension.js/commit/bca90b1bad82a8f460a0f56f075c252cc510996e))
- Ignore dist output changes in hard reload watch detection ([b5bfe8c0](https://github.com/extension-js/extension.js/commit/b5bfe8c05fc8b7440442917e0dd74509f1f5ff84))
- Experimental error overlay ([f1b66998](https://github.com/extension-js/extension.js/commit/f1b6699876c883df9318ce9679ffe9204289f6b8))
- Auto-scan top-level ./extensions ([49ccad57](https://github.com/extension-js/extension.js/commit/49ccad570f5a814992b671d346b66e179c2da644))
</details>
## 3.8.7 (April 8, 2026)

### 🐛 Fixes

- Fix .gitignore writing to avoid GC-closed file handles ([d4f814a8](https://github.com/extension-js/extension.js/commit/d4f814a8e960dfcaa7584a0157aec11c2910344f))
## 3.8.6 (April 8, 2026)

### 🚀 Features

- Add tests to prevent built-in extension not bundling ([e5b54eef](https://github.com/extension-js/extension.js/commit/e5b54eef94334c48403b286df51969a7fdab320d))

### 🐛 Fixes

- Fix Windows path assertions in preview spec ([4cd39ac6](https://github.com/extension-js/extension.js/commit/4cd39ac605f123d8417ae7822605725294ef2131))
- Fix extension-create not running through Node.js interface ([1210602b](https://github.com/extension-js/extension.js/commit/1210602b9ba9c267f15e8af85879035a0c909dc2))

<details>
<summary>🧹 Other changes (1)</summary>

- Follow up on built-in extension overriding user NTP ([5f4b4af3](https://github.com/extension-js/extension.js/commit/5f4b4af3fd98a7743e4104c085ffacef51b37a4d))
</details>
## 3.8.5 (April 8, 2026)

### 🐛 Fixes

- Fix bundled extensions regression ([10028589](https://github.com/extension-js/extension.js/commit/1002858926ca5633f83428beb7d76a27e072f2e1))
- Resolve sass-loader in pnpm dlx one-run builds ([3df92e47](https://github.com/extension-js/extension.js/commit/3df92e477fbd922cbaa6e20e40c6b169c1ac7928))

<details>
<summary>🧹 Other changes (1)</summary>

- Curate changelog entries for public release notes. ([8bdd39b8](https://github.com/extension-js/extension.js/commit/8bdd39b8b7484be20be19c2983643eee772dc63f))
</details>
## 3.8.3 (April 8, 2026)

### 🚀 Features

- Add automated optional-dependency smoke coverage across package managers ([edacdc47](https://github.com/extension-js/extension.js/commit/edacdc47d863bfa0db4851fb3455a3fa24e6e0b1))

### 🐛 Fixes

- Fix Windows file specifiers for local package overrides in smoke matrix ([f1636b60](https://github.com/extension-js/extension.js/commit/f1636b6065db58acd11b2d842d8aa8c57b234a9c))
- Fix Windows process spawning in optional-deps smoke runner ([58b798c4](https://github.com/extension-js/extension.js/commit/58b798c409d75bf88e2d69d966a139b7698ebd21))
- Fix optional-deps matrix portability across Windows, Yarn, and Bun ([ed0ce77e](https://github.com/extension-js/extension.js/commit/ed0ce77e5ba90be7805e1ea1013953a9ff149404))
- Fix optional-deps smoke matrix when browser-extension fixture is absent ([2aee5550](https://github.com/extension-js/extension.js/commit/2aee555061567c8952f9bc39b014d19e57dad20d))
- Fix optional module loading fallback in pnpm CI layouts ([3e42a165](https://github.com/extension-js/extension.js/commit/3e42a1650a02c57856f634b426005395c2f73054))
- Fix optional dependency resolution in pnpm canary CI ([81bac7bc](https://github.com/extension-js/extension.js/commit/81bac7bc487d0e63fc7c6944fc653c5294446dff))
- Harden optional dependency runtime resolution deterministically ([74297000](https://github.com/extension-js/extension.js/commit/74297000e50c405c8ad7a9ac60c9fe8236d7fd20))

<details>
<summary>🧹 Other changes (4)</summary>

- Further simplify install-root entrypoint resolution helpers ([88f5b19d](https://github.com/extension-js/extension.js/commit/88f5b19db7efc31b13ff971d9e04fefb4913db1c))
- Simplify optional dependency resolver control flow ([941947e9](https://github.com/extension-js/extension.js/commit/941947e91e5c977f6e04e0270135e7953d50078b))
- Codify optional-deps runtime contract and lock regressions ([0f885a33](https://github.com/extension-js/extension.js/commit/0f885a3381e70d917e4386ccf650cfa796acc46a))
- Use registry-mode extension for Windows pnpm smoke lane ([e40e9568](https://github.com/extension-js/extension.js/commit/e40e9568cdb5281232173461bf008007497b1645))
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
