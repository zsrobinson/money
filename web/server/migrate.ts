// Create or upgrade the app database only. Never opens the detail snapshot,
// so an installer can run it before the first sync.
import { openAppDb, SCHEMA_VERSION } from "./app-db.ts"

const path = process.env.MONEY_APP_DB
if (!path) throw new Error("Missing MONEY_APP_DB")
openAppDb(path).close()
console.log(JSON.stringify({ migrated: true, schemaVersion: SCHEMA_VERSION }))
