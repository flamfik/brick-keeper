import { expect, test } from "@playwright/test";

test("loads the English interface and reference catalogs", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#language-select")).toHaveValue("en");
  await expect(page.locator(".app-version")).toHaveText("v1.0b");
  await expect(page.locator("#stat-parts")).not.toHaveText("0");

  await page.locator("#add-brick-button").click();
  await page.locator("#brick-part-number").fill("3001");
  await expect(page.locator("#catalog-status")).toContainText("Catalog match");
  await expect(page.locator("#brick-name")).toHaveValue("Brick 2 x 4");

  await page.locator("#close-dialog").click();
  await page.locator("#sets-button").click();
  await page.locator("#set-search").fill("75192");
  await expect(page.locator(".set-result")).toContainText("Millennium Falcon");

  expect(pageErrors).toEqual([]);
});
