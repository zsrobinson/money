import { existsSync, realpathSync } from "node:fs"
import { isAbsolute, dirname, relative, resolve, sep } from "node:path"

const LOOPBACK = ["127.0.0.1", "::1", "localhost"]
// Deployment and system locations never hold fixtures.
const SYSTEM = [
  "/var",
  "/opt",
  "/etc",
  "/srv",
  "/usr",
  "/run",
  "/root",
  "/boot",
  "/mnt",
  "/media",
  "/proc",
  "/sys",
]

/** Validate even a not-yet-created fixture directory before any writes. */
export function assertFixtureDirectory(path: string) {
  const requested = resolve(path)
  let parent = requested
  while (!existsSync(parent)) parent = dirname(parent)
  const canonical = resolve(realpathSync(parent), relative(parent, requested))
  if (
    SYSTEM.some(
      (root) => canonical === root || canonical.startsWith(root + sep)
    )
  )
    throw new Error(
      "Fixture directory cannot be a system or deployment directory"
    )
  return canonical
}

export function assertLoopback(host: string) {
  if (!LOOPBACK.includes(host)) throw new Error("Bind to a loopback address")
}

/**
 * Resolve fixture database paths canonically. Rejects system directories and
 * any database whose real path (after symlinks) leaves the fixture directory.
 * Checked before any database is opened.
 */
export function fixturePaths(
  env: Record<string, string | undefined>,
  fallbackDir: string,
  requireDetail = true
) {
  const requested = resolve(env.MONEY_FIXTURE_DIR || fallbackDir)
  if (!existsSync(requested))
    throw new Error("Fixture directory does not exist")
  const dir = realpathSync(requested)
  if (SYSTEM.some((root) => dir === root || dir.startsWith(root + sep)))
    throw new Error(
      "Fixture directory cannot be a system or deployment directory"
    )
  const inside = (path: string) => {
    const rel = relative(dir, path)
    return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel)
  }
  const file = (name: string, mustExist: boolean) => {
    const path = resolve(dir, name)
    if (!inside(path))
      throw new Error("Fixture databases must be inside the fixture directory")
    if (existsSync(path)) {
      const real = realpathSync(path)
      if (!inside(real))
        throw new Error(
          "Fixture database resolves outside the fixture directory"
        )
      return real
    }
    if (mustExist)
      throw new Error(
        "Fixture detail database is missing; run npm run fixtures"
      )
    return path
  }
  return {
    dir,
    detail: file(env.MONEY_FIXTURE_DETAIL || "detail.sqlite", requireDetail),
    app: file(env.MONEY_FIXTURE_APP || "app.sqlite", false),
  }
}

const PRODUCTION_PATHS = ["/var/lib/money-detail/", "/var/lib/money-app/"]
const isProduction = (path: string | undefined) => {
  if (!path) return false
  const absolute = resolve(path)
  const canonical = existsSync(absolute) ? realpathSync(absolute) : absolute
  return PRODUCTION_PATHS.some((root) => canonical.startsWith(root))
}

/**
 * The real databases open only under NODE_ENV=production (the systemd unit),
 * and production refuses anything else, so development or test tooling can
 * never point at real data by accident.
 */
export function assertProductionPaths(env: Record<string, string | undefined>) {
  const paths = [env.MONEY_DETAIL_DB, env.MONEY_APP_DB]
  if (env.NODE_ENV === "production") {
    if (!paths.every(isProduction))
      throw new Error("Production uses only the production databases")
  } else if (paths.some(isProduction))
    throw new Error("Development and tests cannot open production databases")
}
