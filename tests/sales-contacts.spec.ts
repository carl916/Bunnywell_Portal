import { test, expect } from "@playwright/test";
import { salesFixture } from "./helpers/sales-fixture";

test("building sales contacts filter existing types and store references without changing access", async ({page}) => {
  const f=await salesFixture(page);
  f.rows.organisations=[{id:"legal-org",name:"Legal Team",type:"conveyancer",shared_system_email:null},{id:"agent-org",name:"Agent Team",type:"sales_agent",shared_system_email:"sales@example.test"},{id:"contractor-org",name:"Contractor Team",type:"contractor"}];
  Object.assign(f.rows.buildings[0],{conveyancer_organisation_id:"legal-org",sales_agent_organisation_id:"agent-org",seller_name:"Fixture Seller Ltd"});
  const writes: {table:string;body:Record<string,unknown>}[]=[];
  await page.route("**/rest/v1/**",async route=>{
    if(route.request().method()!=="PATCH"){await route.fallback();return;}
    const table=new URL(route.request().url()).pathname.split("/").at(-1)!;const body=route.request().postDataJSON();writes.push({table,body});Object.assign(f.rows.buildings[0],body);await route.fulfill({json:null});
  });
  await page.goto(`/?screen=setup_buildings&building=${f.unit.building_id}`);
  const section=page.locator("#sales-contacts");await expect(section).toContainText("Shared system email missing");
  await expect(section.getByRole("link",{name:"Edit organisation"})).toHaveAttribute("href",/organisation-legal-org/);
  await section.getByRole("button",{name:"Edit",exact:true}).click();
  const conveyancer=section.getByRole("combobox",{name:"Conveyancer organisation",exact:true});const agent=section.getByRole("combobox",{name:"Sales agent organisation",exact:true});
  await expect(conveyancer.locator("option")).toHaveText(["Not selected","Legal Team"]);await expect(agent.locator("option")).toHaveText(["Not selected","Agent Team"]);
  await agent.selectOption("");await section.getByRole("button",{name:"Save changes"}).click();
  await expect(section.getByRole("button",{name:"Edit",exact:true})).toBeVisible();
  expect(writes).toEqual([{table:"buildings",body:{conveyancer_organisation_id:"legal-org",sales_agent_organisation_id:null,seller_name:"Fixture Seller Ltd",completion_information:null}}]);
  await section.screenshot({path:"artifacts/legal-building-contacts.png"});
});

test("organisation shared inbox is visible, editable and validated", async({page})=>{
  const f=await salesFixture(page);f.rows.organisations=[{id:"legal-org",name:"Legal Team",type:"conveyancer",shared_system_email:"legal@example.test"}];
  await page.goto("/?screen=setup_people#organisation-legal-org");
  const organisation=page.locator("#organisation-legal-org");await expect(organisation).toContainText("legal@example.test");
  await organisation.getByRole("button",{name:"Edit Legal Team"}).click();
  const email=organisation.getByLabel("Shared system email",{exact:false});await email.fill("not-an-email");await organisation.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByText("Enter a valid shared system email.",{exact:true})).toBeVisible();
  let saved:Record<string,unknown>|undefined;
  await page.route("**/rest/v1/organisations?*",async route=>{if(route.request().method()!=="PATCH"){await route.fallback();return;}saved=route.request().postDataJSON();Object.assign(f.rows.organisations[0],saved);await route.fulfill({json:null});});
  await email.fill("conveyancing-team@example.test");await organisation.getByRole("button",{name:"Save",exact:true}).click();
  await expect(organisation).toContainText("conveyancing-team@example.test");expect(saved?.shared_system_email).toBe("conveyancing-team@example.test");
});
