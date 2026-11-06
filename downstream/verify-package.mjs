import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import console from "node:console";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";
import * as tls from "node:tls";
import { pathToFileURL } from "node:url";

assert.ok(process.versions.bun, "Run with Bun 1.4.2");
assert.ok(process.argv[2], "Usage: bun downstream/verify-package.mjs /path/to/patched/portless");
const packageRoot = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "portless");
assert.equal(manifest.version, "0.16.0");
const { createProxyServer } = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
assert.equal(typeof createProxyServer, "function");
const directory = mkdtempSync(join(tmpdir(), "portless-package-tls-"));
const backend = http.createServer((_request, response) => response.end("patched package"));
const sockets = new Set();
let connections = 0;
let proxy;
backend.on("connection", (socket) => {
  connections++;
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});
try {
  const certificate = (name, names) => {
    const config = join(directory, name + ".cnf");
    const certPath = join(directory, name + ".pem");
    const keyPath = join(directory, name + "-key.pem");
    writeFileSync(
      config,
      "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=" +
        names[0] +
        "\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign\nextendedKeyUsage=serverAuth\nsubjectAltName=" +
        names.map((hostname) => "DNS:" + hostname).join(",") +
        "\n"
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "1",
        "-config",
        config,
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { windowsHide: true, timeout: 30000, stdio: ["ignore", "ignore", "pipe"] }
    );
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  };
  const defaults = certificate("default", ["localhost"]);
  const selected = certificate("selected", ["nested.app.localhost", "custom.preview"]);
  assert.throws(
    () =>
      createProxyServer({ getRoutes: () => [], proxyPort: 443, loopbackOnly: true, tls: defaults }),
    /Bun HTTPS cannot use loopbackOnly/
  );
  const cliState = join(directory, "cli-state");
  const cli = spawnSync(
    process.execPath,
    [
      join(packageRoot, "dist/cli.js"),
      "proxy",
      "start",
      "--foreground",
      "--unprivileged",
      "--https",
      "--port",
      "44439",
    ],
    {
      env: {
        ...process.env,
        CI: "1",
        PORTLESS_STATE_DIR: cliState,
        PORTLESS_LAN: "0",
        PORTLESS_SYNC_HOSTS: "0",
      },
      windowsHide: true,
      timeout: 10000,
      encoding: "utf8",
    }
  );
  assert.equal(cli.status, 1, cli.stderr || String(cli.error));
  assert.match(cli.stderr, /Bun cannot start loopback-only HTTPS/);
  assert.equal(existsSync(join(cliState, "ca.pem")), false);
  assert.equal(existsSync(join(cliState, "proxy.pid")), false);
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const backendAddress = backend.address();
  assert.ok(backendAddress && typeof backendAddress !== "string");
  const routes = [{ hostname: "nested.app.localhost", port: backendAddress.port }];
  let prepared = 0;
  let failNext = false;
  proxy = createProxyServer({
    getRoutes: () => routes,
    proxyPort: 443,
    tlds: ["localhost", "preview"],
    tls: {
      ...defaults,
      SNICallback(_name, callback) {
        prepared++;
        if (failNext) {
          failNext = false;
          callback(new Error("injected preparation failure"));
        } else callback(null, tls.createSecureContext(selected));
      },
    },
  });
  assert.equal(typeof proxy.refreshTlsContexts, "function");
  await Promise.all([proxy.refreshTlsContexts(), proxy.refreshTlsContexts()]);
  assert.equal(prepared, 1);
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  assert.ok(address && typeof address !== "string");
  const request = (hostname) =>
    new Promise((resolve, reject) => {
      const req = https.get(
        {
          hostname: "127.0.0.1",
          port: address.port,
          servername: hostname,
          ca: selected.cert,
          agent: false,
          headers: { Host: hostname },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => resolve(body));
        }
      );
      req.setTimeout(5000, () => req.destroy(new Error("TLS request timeout")));
      req.on("error", reject);
    });
  assert.equal(await request("nested.app.localhost"), "patched package");
  assert.equal(await request("nested.app.localhost"), "patched package");
  assert.equal(connections, 1, "front-end connections reuse the upstream pool");
  routes.push({ hostname: "custom.preview", port: backendAddress.port });
  failNext = true;
  await assert.rejects(proxy.refreshTlsContexts(), /injected preparation failure/);
  await proxy.refreshTlsContexts();
  assert.equal(await request("custom.preview"), "patched package");
  await new Promise((resolve) => proxy.close(resolve));
  const deadline = Date.now() + 2000;
  while (sockets.size && Date.now() < deadline) await wait(10);
  assert.equal(sockets.size, 0, "closing the proxy closes its pooled upstream sockets");
  console.log(
    "Portless 0.16.0 package: verified TLS names, refresh/retry, pool reuse/cleanup, and loopback-only HTTPS rejection passed"
  );
} finally {
  if (proxy?.listening) await new Promise((resolve) => proxy.close(resolve));
  backend.closeAllConnections();
  if (backend.listening) await new Promise((resolve) => backend.close(resolve));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep + "portless-package-tls-"));
  rmSync(directory, { recursive: true, force: true });
}
