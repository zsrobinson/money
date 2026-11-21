import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "@zsrobinson/shell"
import { errorMessage, send } from "./api"

type Method = "POST" | "PATCH" | "PUT" | "DELETE"

/**
 * One API write. Every edit can change totals anywhere (rules, overrides and
 * splits feed every report), so success refreshes all money queries.
 */
export function useSend<TVars = void, TResult = unknown>(
  method: Method,
  url: string | ((vars: TVars) => string),
  {
    success,
    body,
    onSuccess,
  }: {
    success?: string | ((result: TResult, vars: TVars) => string)
    body?: (vars: TVars) => unknown
    onSuccess?: (result: TResult, vars: TVars) => void
  } = {}
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) =>
      send<TResult>(
        method,
        typeof url === "function" ? url(vars) : url,
        body ? body(vars) : method === "DELETE" ? undefined : vars
      ),
    onSuccess: (result, vars) => {
      if (success)
        toast.success(
          typeof success === "function" ? success(result, vars) : success
        )
      onSuccess?.(result, vars)
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => client.invalidateQueries({ queryKey: ["money"] }),
  })
}
