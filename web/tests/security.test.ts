// Data protection: the production server answers only a valid Cloudflare
// Access JWT, wherever the request comes from, and nothing it logs or returns
// in an error carries financial data. These run on invented fixtures only.
import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { createMoneyServer } from "../server/app.ts"
import { openAppDb } from "../server/app-db.ts"
import { detailStore } from "../server/detail.ts"
import { assertProductionPaths, fixturePaths } from "../server/fixture-guard.ts"
import { createModel } from "../server/model.ts"
import { FIXTURE_TODAY, generate } from "../fixtures/generate.ts"

const dir = mkdtempSync(join(tmpdir(), "money-security-"))
const paths = generate(dir)
const model = createModel(
  detailStore(paths.detailPath),
  openAppDb(paths.appPath),
  () => FIXTURE_TODAY
)
const AUDIENCE = "money-test-audience"
const ORIGIN = "https://money.example.test"
let issuer = ""
let jwks: Server
let sign: (claims?: Record<string, unknown>) => Promise<string>
let forge: () => Promise<string>
let signingKey: CryptoKey
const logs: string[] = []
let app: ReturnType<typeof createMoneyServer>

before(async () => {
  const real = await generateKeyPair("RS256")
  const other = await generateKeyPair("RS256")
  const jwk = {
    ...(await exportJWK(real.publicKey)),
    kid: "test",
    alg: "RS256",
  }
  jwks = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((done) => jwks.listen(0, "127.0.0.1", done))
  const port = (jwks.address() as { port: number }).port
  issuer = `http://127.0.0.1:${port}`
  const token = (key: CryptoKey, kid: string, claims = {}) =>
    new SignJWT({ email: "owner@example.test", ...claims })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setExpirationTime("10m")
      .sign(key)
  sign = (claims) => token(real.privateKey, "test", claims)
  signingKey = real.privateKey
  // Same shape, same kid, signed by a key Access never published.
  forge = () => token(other.privateKey, "test")
  app = createMoneyServer(model, {
    issuer,
    audience: AUDIENCE,
    publicOrigin: ORIGIN,
    services: () => [],
    log: (m) => logs.push(JSON.stringify(m)),
  })
})
after(() => jwks.close())

const DATA_ROUTES = [
  "/api/meta",
  "/api/summary",
  "/api/transactions",
  "/api/transactions.csv",
  "/api/search?q=juniper",
  "/api/accounts",
  "/api/budgets",
  "/api/cashflow",
  "/api/reports/build",
  "/api/recurring",
  "/api/goals",
  "/api/investments",
  "/api/categories",
  "/api/rules",
]

/** Strings that would show financial data leaked into a response or log. */
function secrets() {
  const m = model.get()
  const merchants = [
    ...new Set(m.txns.flatMap((t) => (t.merchantEff ? [t.merchantEff] : []))),
  ].filter((x) => x.length > 6)
  const amounts = m.txns
    .slice(0, 50)
    .map((t) => (Math.abs(t.amountCents) / 100).toFixed(2))
    .filter((a) => a.length > 4)
  const accounts = m.accounts.map((a) => a.name).filter((x) => x.length > 4)
  return [...merchants, ...amounts, ...accounts]
}
const leaks = (text: string) =>
  secrets().filter((s) => text.toLowerCase().includes(s.toLowerCase()))

test("loopback requests without a valid Access JWT get 401 and no data", async () => {
  const forged = await forge()
  const expired = await new SignJWT({ email: "owner@example.test" })
    .setProtectedHeader({ alg: "none" } as never)
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .sign(new Uint8Array(32))
    .catch(() => "e30.e30.")
  for (const route of DATA_ROUTES) {
    for (const header of [undefined, forged, expired, "not-a-jwt"]) {
      const res = await app.request(`http://127.0.0.1${route}`, {
        headers: header ? { "Cf-Access-Jwt-Assertion": header } : {},
      })
      assert.equal(
        res.status,
        401,
        `${route} with ${header ? "a bad" : "no"} token`
      )
      assert.deepEqual(leaks(await res.text()), [], route)
    }
  }
  // A token for another audience is refused too.
  const other = await new SignJWT({ email: "owner@example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(issuer)
    .setAudience("someone-else")
    .setExpirationTime("10m")
    .sign(signingKey)
  const res = await app.request("http://127.0.0.1/api/meta", {
    headers: { "Cf-Access-Jwt-Assertion": other },
  })
  assert.equal(res.status, 401)
})

test("a valid Access JWT reaches the API; writes also need the public origin", async () => {
  const good = await sign()
  const ok = await app.request("http://127.0.0.1/api/meta", {
    headers: { "Cf-Access-Jwt-Assertion": good },
  })
  assert.equal(ok.status, 200)
  const write = await app.request("http://127.0.0.1/api/review/start", {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": good,
      "Content-Type": "application/json",
    },
    body: "{}",
  })
  assert.equal(write.status, 403, "a write without the public Origin")
  // Metrics need the scrape token, not a JWT, and carry no data.
  const metrics = await app.request("http://127.0.0.1/metrics")
  assert.ok([401, 403].includes(metrics.status))
})

test("logs and error bodies carry metadata only", async () => {
  const good = await sign()
  const headers = {
    "Cf-Access-Jwt-Assertion": good,
    Origin: ORIGIN,
    "Content-Type": "application/json",
  }
  const merchant = model.get().txns.find((t) => t.merchantEff)!.merchantEff!
  const captured: string[] = []
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  }
  for (const k of Object.keys(original) as (keyof typeof original)[])
    console[k] = (...args: unknown[]) =>
      captured.push(args.map(String).join(" "))
  const errorBodies: string[] = []
  try {
    const calls: [string, string, unknown?][] = [
      ["GET", `/api/search?q=${encodeURIComponent(merchant)}`],
      ["GET", `/api/transactions?q=${encodeURIComponent(merchant)}`],
      ["GET", "/api/transactions/txn_missing"],
      ["PATCH", "/api/transactions/txn_missing", { merchant }],
      [
        "PATCH",
        `/api/transactions/${model.get().txns[0].id}`,
        { category: merchant },
      ],
      [
        "POST",
        "/api/rules",
        {
          match: { merchant_contains: merchant },
          action: { category: merchant },
        },
      ],
      [
        "POST",
        "/api/transactions",
        {
          accountId: merchant,
          date: "2026-11-01",
          amountCents: -4512,
          category: "food",
        },
      ],
      ["POST", "/api/categories", { label: merchant }],
      ["PUT", "/api/budgets/2026-11/food", { amountCents: "4512" }],
      ["GET", "/api/reports/merchants/does-not-exist"],
    ]
    for (const [method, path, body] of calls) {
      const res = await app.request(`http://127.0.0.1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.status >= 400) errorBodies.push(await res.text())
    }
  } finally {
    Object.assign(console, original)
  }
  assert.ok(errorBodies.length >= 6, "the calls above exercise error paths")
  const text = [...captured, ...logs, ...errorBodies].join("\n")
  assert.deepEqual(leaks(text), [])
  assert.ok(!text.includes(merchant), "a search term or input is not echoed")
  // Durations in the metadata are numbers; only bodies and console lines
  // could echo an amount someone sent.
  const echoed = [...captured, ...errorBodies].join("\n")
  assert.ok(!echoed.includes("45.12") && !echoed.includes("4512"), echoed)
  // Request logs are the route pattern, never the URL or its query.
  for (const line of logs) {
    const m = JSON.parse(line) as Record<string, unknown>
    assert.deepEqual(Object.keys(m).sort(), [
      "durationMs",
      "method",
      "route",
      "status",
    ])
    assert.ok(!String(m.route).includes("?"))
  }
})

test("dev and test tooling refuse the production databases", () => {
  assert.throws(() =>
    assertProductionPaths({
      MONEY_DETAIL_DB: "/var/lib/money-detail/detail.sqlite",
      MONEY_APP_DB: join(dir, "app.sqlite"),
    })
  )
  assert.throws(() =>
    assertProductionPaths({
      NODE_ENV: "production",
      MONEY_DETAIL_DB: paths.detailPath,
      MONEY_APP_DB: paths.appPath,
    })
  )
  assert.doesNotThrow(() =>
    assertProductionPaths({
      NODE_ENV: "production",
      MONEY_DETAIL_DB: "/var/lib/money-detail/detail.sqlite",
      MONEY_APP_DB: "/var/lib/money-app/app.sqlite",
    })
  )
  assert.throws(() =>
    fixturePaths({ MONEY_FIXTURE_DIR: "/var/lib/money-detail" }, dir)
  )
})

// CI guards: small static checks that fail when a change would widen what is
// reachable or logged.
const server = resolve(import.meta.dirname, "../server")
const sources = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(join(d, e.name))
      : e.name.endsWith(".ts")
        ? [join(d, e.name)]
        : []
  )

test("guard: only the shell's authenticated app and /metrics serve requests", () => {
  const app = readFileSync(join(server, "app.ts"), "utf8")
  // Routes outside the shell: exactly the token-gated /metrics and the
  // pass-through to the shell.
  const outside = [
    ...app.matchAll(
      /\bapp\.(get|post|put|patch|delete|all|use|route)\(\s*"([^"]+)"/g
    ),
  ].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(outside.sort(), ["all *", "get /metrics"])
  // The API mounts on the shell, after its Access middleware.
  assert.match(app, /shell\.route\("\/api", createApi\(model\)\)/)
  const main = readFileSync(join(server, "main.ts"), "utf8")
  assert.match(main, /createMoneyServer\(/)
  assert.doesNotMatch(main, /new Hono\(|\.get\(|\.route\(/)
  // API modules register on the api instance they are given, never a new app.
  for (const file of sources(join(server, "api")))
    assert.doesNotMatch(readFileSync(file, "utf8"), /new Hono\(/, file)
})

test("guard: server code does not log, except fixed startup lines", () => {
  const allowed = new Map([
    ["fixture-server.ts", 1],
    ["migrate.ts", 1],
    ["main.ts", 1],
  ])
  for (const file of sources(server)) {
    const text = readFileSync(file, "utf8")
    const calls = [
      ...text.matchAll(/console\.(log|error|warn|info|debug)\(([^)]*)\)/g),
    ]
    const name = file.split("/").at(-1)!
    assert.ok(
      calls.length <= (allowed.get(name) ?? 0),
      `${name} logs; logs carry metadata only`
    )
    for (const c of calls)
      assert.doesNotMatch(
        c[2],
        /txn|amount|merchant|description|note|account|tag|search|query|\bq\b|body/i,
        `${name} logs a financial field`
      )
  }
})

test("guard: fixture tooling resolves only inside the fixture directory", () => {
  const fixture = readFileSync(join(server, "fixture-server.ts"), "utf8")
  assert.match(fixture, /assertLoopback\(/)
  assert.match(fixture, /fixturePaths\(/)
  assert.doesNotMatch(fixture, /\/var\/lib|MONEY_DETAIL_DB|MONEY_APP_DB/)
})
