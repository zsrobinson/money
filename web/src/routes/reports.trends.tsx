import { createFileRoute, redirect } from "@tanstack/react-router"

/** Trends became the report builder; old links land there. */
export const Route = createFileRoute("/reports/trends")({
  beforeLoad: () => {
    throw redirect({ to: "/reports/builder", replace: true })
  },
})
