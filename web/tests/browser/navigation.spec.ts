import { test, expect } from "@playwright/test"
for (const path of [
  "/",
  "/transactions",
  "/accounts",
  "/budgets",
  "/cash-flow",
  "/investments",
  "/settings",
]) {
  test(`fixture page ${path} loads without runtime errors`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.name))
    const responses: number[] = []
    page.on("response", (response) => {
      if (response.url().includes("/api/")) responses.push(response.status())
    })
    await page.goto(path)
    await expect(page.locator("h1")).toBeVisible()
    await expect(page.locator("main")).toBeVisible()
    await expect.poll(() => responses.length).toBeGreaterThan(0)
    expect(responses.every((status) => status < 400)).toBe(true)
    expect(errors).toEqual([])
  })
}
