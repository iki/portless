# Portless 0.16.0 Bun TLS adaptation

This branch adapts [PR 470](https://github.com/vercel-labs/portless/pull/470)
to the [Portless 0.16.0 release](https://github.com/vercel-labs/portless/releases/tag/v0.16.0),
base `d6326eff87e3f377050cfb8b8aaeba07e5378564`. It contains one TLS compatibility
fix, its source regression, and an exported patch for the released npm package.
The existing PR retains its original branch and history.

Bun does not invoke the SNI callback, and prepared contexts do not take effect on
sockets passed through Portless's protocol-sniffing wrapper. This adaptation lets
the TLS listener accept sockets directly, prepares registered hostnames before
startup and route refresh, deduplicates concurrent preparation, and retries failed
certificate generation. A failed hostname does not prevent healthy routes from
starting. The optional `refreshTlsContexts` method is included in declarations.

Portless 0.16.0 pools upstream connections. Closing the Bun TLS listener now also
destroys that pool. Its new loopback-only peer filter lives in the wrapper that
Bun cannot use, so Bun HTTPS rejects `loopbackOnly`, including CLI startup with
`--unprivileged --https` outside LAN mode, before allocating a listener or writing
certificates. Use the default loopback bind without that option, use Node.js, or
choose plain HTTP with `--no-tls`. Reusing an already-running compatible proxy
remains available.

Bun serves HTTP/1.1 and secure WebSockets in this path. Plain HTTP on the TLS port
and unregistered wildcard TLS names remain unsupported; keep the separate HTTP
redirect. Node retains the existing wrapper, HTTP/2 behavior, and peer filtering.

## Apply the package patch

Pin `portless@0.16.0` in the consuming project. Apply
[`portless-0.16.0-bun-tls.patch`](portless-0.16.0-bun-tls.patch) to the package root
through the project's package manager, then commit its patch registration and
lockfile. Do not edit the dependency store directly.

For pnpm in a Git project, run the following from the consuming project's Git
root. Replace the example checkout path with this checkout's absolute path:

```sh
pnpm patch portless@0.16.0 --edit-dir .cache/portless-0.16.0-patch
git apply --directory=.cache/portless-0.16.0-patch "/path/to/this/checkout/downstream/portless-0.16.0-bun-tls.patch"
pnpm patch-commit .cache/portless-0.16.0-patch
bun "/path/to/this/checkout/downstream/verify-package.mjs" "./node_modules/portless"
```

The package verifier requires Bun 1.4.2 and OpenSSL on `PATH`. It uses private
temporary certificates, ephemeral loopback listeners, and a private CLI state
directory. It does not install a CA or modify a shared proxy. It checks the
package version, verified TLS names, concurrent refresh, failure retry, pool reuse
and cleanup, and rejection of unsupported loopback-only HTTPS.

For the source checkout, run:

```sh
bun packages/portless/scripts/test-bun-tls.ts
```

That regression additionally exercises secure WebSocket upgrades and detection of
an existing Bun TLS proxy.

The package verifier fails on the unpatched 0.16.0 package at the unsupported-mode
boundary. After the pnpm workflow above, it passes against the patched package.
The three modified installed files match the previously tested package candidate
byte for byte.

## Validation environment

The Bun source regression passes on Windows x64 with Bun 1.4.2. Source build,
declarations, TypeScript checking, and ESLint use an isolated resolution of the
development-tool ranges declared by this release: Node 26.13.0, TypeScript 5.9.3,
Vitest 4.1.12, ESLint 9.39.5, typescript-eslint 8.72.1, tsup 8.5.1, and Prettier 3.9.10.

Build, declarations, type checking, and lint pass. The Node package run reports
1,135 passed tests, 17 skips, and 15 failures, all in `cli.test.ts`. The exact same
15 CLI cases fail on the unmodified release base with the same tools and Windows
worktree setup; its remaining 133 CLI tests pass and 10 are skipped. The failures
include worktree-prefixed hostname expectations, child-process timeouts, and
package-manager shim capture. No full green Node-suite result is claimed.

The original monorepo frozen install, including a filtered attempt, is blocked by
pnpm trust-downgrade checks for five locked entries: `jose@4.15.9`,
`radix-ui@1.6.4`, `reselect@5.1.1`, `semver@6.3.1`, and `undici-types@6.21.0`.
The isolated tool install retains pnpm's trust checks and the upstream 2880-minute
release-age policy. The upstream manifests and lockfile are unchanged. This does
not establish a successful frozen monorepo install or a docs/end-to-end CI run.

## Upgrade coordination

This is an optional candidate for a coordinated upgrade. Trigon remains on
Portless 0.15.12 because its shared proxy owner still imports and asserts that
installed version. Give the owner an independent pinned installation or agree on
an owner upgrade with every project using the service before changing that pin.
Preserve the existing CA, state directory, running owner, and other projects' routes.

Retire the patch only after an unpatched published release passes the same
certificate-verified regressions. A merged PR alone is insufficient.
