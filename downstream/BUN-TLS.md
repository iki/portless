# Portless 0.15.12 Bun TLS package patch

This branch exports the Bun TLS fix from PR #470 for the published Portless 0.15.12
package. It builds on signed contribution head
`0c0ff893a5a481d3d1b53d0b4766e32cd35dd5e3`, based on upstream
`674c2de57723b51e99c1db9366d09f214c901697`. The source proposal and its standalone
regression remain intact; this addition only exports the current package diff.

Install `portless@0.15.12` and apply `portless-0.15.12-bun-tls.patch` to the package
root through your package manager's patch facility. Pin the resulting lockfile.
With pnpm, use `pnpm patch portless@0.15.12`, apply this diff in the returned edit
directory, then `pnpm patch-commit` that directory. Do not edit the store directly.

The patch prepares hostname TLS contexts before serving under Bun, handles reloads,
deduplicates certificate work, retries failures and exposes the optional refresh
method in declarations. Bun serves HTTP/1.1 here; keep the independent HTTP redirect.
No plain HTTP on its TLS listener or unregistered wildcard names are supported.
Node behavior is unchanged. The Windows OpenSSL subprocess fix is already shipped
in 0.15.12 and is deliberately absent from this patch.

Tested in Trigon on Windows x64 and Bun 1.4.2: verified certificates and nested
names, route changes, concurrent refresh, failure recovery, CLI reuse and full
browser/Worker preview acceptance. In the Trigon checkout run:

```sh
bun run test test/preview.test.ts
```

The source-level standalone regression is
`packages/portless/scripts/test-bun-tls.ts`; use its checked-in runner
instructions when testing a built source checkout. This publication does not claim
a fresh full Portless monorepo test run or testing the source branch as 0.15.12.

Upstream proposal: https://github.com/vercel-labs/portless/pull/470.
Retire after an unpatched published release passes the same verified TLS tests.

