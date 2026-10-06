import { test, expect } from "@playwright/test";
import { salesFixture } from "./helpers/sales-fixture";
import { saleFilePath } from "../src/lib/portal-url";

test("a signed-out sale-email recipient reaches the same sale after normal sign-in", async ({page}) => {
  const path=saleFilePath({building_id:"10000000-0000-4000-8000-000000000001",unit_id:"20000000-0000-4000-8000-000000000001",sale_attempt_id:"40000000-0000-4000-8000-000000000001"});
  await salesFixture(page,path);
  await expect(page.getByRole("list",{name:"Reservation tasks",exact:true})).toBeVisible();
  await expect(page).toHaveURL(/conversation=40000000-0000-4000-8000-000000000001/);
});
