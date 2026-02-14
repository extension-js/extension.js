# Svelte + Optional Dependencies Incident Dossier (for another AI to fix)

This document is a complete handoff to reproduce, diagnose, implement, and verify the current failure mode.

## Executive conclusion

- Svelte templates are **not inherently broken** with `extension@3.6.0`.
- There are **two distinct issues**:
  1. **Old remote CI runner issue** (`setup-pnpm` shim executed as JS) in `extension-js/examples` run `22002486471`.
  2. **Local optional-dependency installer execution bug** in `extension.js` package-manager command construction, which can make many templates fail (including Svelte) with false negatives.

When package manager execution is forced to a safe path, Svelte passes on Node 20 in all target browsers.

---

## Scope and validated environment

- Repo under test (consumer): `extension-js/examples`
- Commit under test: `796542f28e201f7a882a80544825f0a2cbe8bb0d`
- Toolchain:
  - Node: `20.20.0`
  - pnpm: `10.10.0`
  - extension package tested: `3.6.0`

---

## Part A - Confirm old remote CI issue (not a Svelte regression)

Run:

```bash
gh run view 22002486471 -R extension-js/examples
gh run view 22002486471 -R extension-js/examples --log-failed
```

Expected indicators:

- `/home/runner/setup-pnpm/node_modules/.bin/pnpm`
- `SyntaxError: missing ) after argument list`
- Node `20.20.0` in the same failing job logs

Interpretation: this run is failing for the known pnpm shim execution issue on runner, not for Svelte template code.

---

## Part B - Fresh repro in examples

```bash
git clone https://github.com/extension-js/examples.git /tmp/examples-svelte-validate
cd /tmp/examples-svelte-validate
git checkout 796542f28e201f7a882a80544825f0a2cbe8bb0d

export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20.20.0

CI= pnpm install
CI= pnpm add -D extension@3.6.0
```

### Repro path that can produce false negatives

```bash
CI=true node ci-scripts/build-all.mjs --filter="new-svelte,svelte"
```

Observed failure pattern in this mode:

- `ERROR [Svelte] Failed to install dependencies.`
- `Install failed with exit code 1`
- `/Users/.../Library/pnpm/pnpm:1` followed by binary bytes
- `SyntaxError: Invalid or unexpected token`

This is **installer execution-path failure**, not template semantics.

### Authoritative Svelte health assertion

```bash
EXTENSION_JS_PACKAGE_MANAGER=npm CI=true node ci-scripts/build-all.mjs --filter="new-svelte,svelte"
```

Expected summary:

- `[OK] new-svelte [chrome]`
- `[OK] new-svelte [edge]`
- `[OK] new-svelte [firefox]`
- `[OK] svelte [chrome]`
- `[OK] svelte [edge]`
- `[OK] svelte [firefox]`

Must not appear:

- `Reading from "node:async_hooks" is not handled by plugins`
- `Reading from "node:crypto" is not handled by plugins`
- `Unexpected token ( ... static #render(component, options) ... )`

---

## Root-cause hypothesis to fix in `extension.js`

### Symptom

On non-Windows platforms, command resolution may return a native executable path for `pnpm` (for example `/Users/<user>/Library/pnpm/pnpm`), but the installer executes it as:

- `node /path/to/pnpm ...`

That causes Node to parse binary bytes as JS and throws `SyntaxError: Invalid or unexpected token`.

### Likely problematic code

In `extension.js`:

- `programs/develop/webpack/webpack-lib/package-manager.ts`
  - `resolvePackageManager()` may return `{name: 'pnpm', execPath: '/path/to/pnpm'}`
  - `buildInstallCommand()` currently does:
    - if `pm.execPath` and not Windows `.cmd/.bat/.exe` -> `command: process.execPath`, `args: [pm.execPath, ...args]`
  - this behavior is safe for JS entrypoints (like `npm-cli.js`) but unsafe for native binaries

- `programs/develop/webpack/plugin-css/css-lib/integrations.ts`
  - optional dependency install path calls `buildInstallCommand(...)` via:
    - `getOptionalInstallCommand()`
    - `execInstallWithFallback()`
  - this is where failures fan out across React/Svelte/Vue/Sass/Less optional tooling

---

## Fix strategy (implementation guidance)

### Primary fix

Update `buildInstallCommand()` in `package-manager.ts` to distinguish native executables from JS scripts:

- If `pm.execPath` is a native executable or a shebang script that is directly runnable:
  - execute directly: `{command: pm.execPath, args}`
- If `pm.execPath` is a JS file (`.js`, `.cjs`, `.mjs`) or known npm CLI script:
  - execute with node: `{command: process.execPath, args: [pm.execPath, ...args]}`

Practical rule that is usually enough:

- On non-Windows:
  - use direct execution unless extension is in `{.js,.cjs,.mjs}`
- Keep existing Windows `.cmd/.bat/.exe` handling

### Optional hardening

- If command exits with syntax parse error at first byte and `pm.execPath` exists:
  - retry by direct execution when initially executed through node
- Add clearer error message with detected `pm` and command form used

---

## Tests to add in `extension.js`

Add/extend unit tests around `package-manager.ts`:

1. When `pm.execPath` is `/usr/local/bin/pnpm` on darwin/linux:
   - `buildInstallCommand()` returns `command=/usr/local/bin/pnpm`, not `node`.
2. When `pm.execPath` is `/path/to/npm-cli.js`:
   - `buildInstallCommand()` returns `command=node`, `args=[npm-cli.js,...]`.
3. Windows `.cmd`/`.bat` behavior remains unchanged.

If test harness exists for optional preflight/deps execution, add one regression test asserting no node-wrapping for binary pnpm path.

---

## End-to-end acceptance criteria

After fix in `extension.js` and release/canary consumption in `extension-js/examples`:

1. `CI=true node ci-scripts/build-all.mjs --filter="new-svelte,svelte"` passes **without** `EXTENSION_JS_PACKAGE_MANAGER=npm`.
2. No `SyntaxError: Invalid or unexpected token` from `/Users/.../pnpm/pnpm:1`.
3. Optional dependency installation succeeds for Svelte integration.
4. Full matrix failures (if any) are unrelated to package-manager execution wrapping.

---

## Quick command block for the implementing AI

```bash
# examples repo
git clone https://github.com/extension-js/examples.git /tmp/examples-svelte-validate
cd /tmp/examples-svelte-validate
git checkout 796542f28e201f7a882a80544825f0a2cbe8bb0d
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20.20.0
CI= pnpm install
CI= pnpm add -D extension@3.6.0

# should currently fail due to exec-path wrapping bug
CI=true node ci-scripts/build-all.mjs --filter="new-svelte,svelte"

# control check (should pass)
EXTENSION_JS_PACKAGE_MANAGER=npm CI=true node ci-scripts/build-all.mjs --filter="new-svelte,svelte"
```

If first fails and second passes, fix should be targeted to `extension.js` package-manager execution path logic, not Svelte template code.
