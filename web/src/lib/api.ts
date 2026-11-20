import { parseJson } from "@zsrobinson/shell/lib/api"
export { ApiError, getJson, errorMessage } from "@zsrobinson/shell/lib/api"

export type Params = Record<string, string | number | undefined | null | false>

export function query(params: Params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params))
    if (
      value !== undefined &&
      value !== null &&
      value !== false &&
      value !== ""
    )
      search.set(key, String(value))
  const s = search.toString()
  return s ? `?${s}` : ""
}

export async function send<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return parseJson<T>(response)
}
