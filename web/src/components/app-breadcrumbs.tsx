import { Fragment } from "react"
import { Link, useMatches } from "@tanstack/react-router"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@zsrobinson/shell/ui/breadcrumb"
import { useCrumbLabel } from "@/lib/crumb"

/** Section › page › detail, from the leaf route's static data and the open detail page. */
export function AppBreadcrumbs() {
  const leaf = useMatches({ select: (m) => m.at(-1)?.staticData.crumbs })
  const detail = useCrumbLabel()
  const crumbs: { label: string; to?: string }[] = [...(leaf ?? [])]
  if (detail) crumbs.push({ label: detail })
  if (!crumbs.length) return null
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator className="max-sm:hidden" />
              ) : null}
              <BreadcrumbItem className={last ? "min-w-0" : "max-sm:hidden"}>
                {last || !crumb.to ? (
                  <BreadcrumbPage className="truncate">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link to={crumb.to} />}>
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
