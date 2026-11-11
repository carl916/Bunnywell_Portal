import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import ts from "typescript";
import { loadTypescriptModule } from "../../tests/helpers/load-typescript-module.mjs";
const out="artifacts/building-contracts-stage1";
const original="C:/Users/carlg/.codex/worktrees/sales-workspace-redesign/Bunnywell_Portal";
const sha=b=>createHash("sha256").update(b).digest("hex");
const write=(name,data)=>writeFileSync(out+"/"+name,JSON.stringify(data,null,2)+"\n");
const previous=JSON.parse(readFileSync(out+"/accepted-prototype-hashes.json","utf8"));
const changed=previous.filter(f=>sha(readFileSync(path.join(original,f.Path))).toUpperCase()!==f.SHA256);
const migrationDir="supabase/migrations";
const migrations=readdirSync(migrationDir).filter(n=>n.endsWith(".sql")).sort().map(name=>({name,sha256:sha(readFileSync(migrationDir+"/"+name))}));
write("schema-baseline.json",{baselineCommit:"0a1ee76a18c17c4466b1031efe52b22e9959abe3",migrationCount:migrations.length,
 latest:migrations.at(-1)?.name,manifestSha256:sha(migrations.map(x=>x.name+" "+x.sha256+"\n").join("")),replayExecuted:false,migrations});
const fixture=loadTypescriptModule("src/lib/experiments/building-contracts/fixtures.ts");
write("stage2-seed-proposal.json",{status:"PROPOSED ONLY; not an executable database seed; no accounts or records created",projectId:"bunnywell-workspace-stage2",
 appOrigin:"http://127.0.0.1:3031",apiOrigin:"http://127.0.0.1:54321",mailCaptureOrigin:"http://127.0.0.1:54324",
 baselineCommit:"0a1ee76a18c17c4466b1031efe52b22e9959abe3",idPolicy:"Proposed synthetic UUIDs only; not identifiers of existing remote records.",
 accounts:Object.entries(fixture.accounts).map(([alias,a])=>({alias,proposedEmail:"bw-stage2-"+alias+"@example.invalid",...a})),
 buildings:fixture.buildings,
 scopedFacts:[1,2].map(n=>{const f=fixture.facts("developer",fixture.id(n));return{building:f.building,proposedFacts:f.input,buyerLabels:f.buyers};}),
 extraControlledCases:["Remove appointment then restore it","Revoke a test user's building access then restore it","Deny the inaccessible third building","Inject incomplete sources and transport errors locally","Add a separate superseded attempt to verify exact-attempt denial; no legacy opening until approved"],
 outbound:"Install deny-egress and local-only SMTP capture before setup. No remote credentials, delivery keys, external webhooks, cron deliveries or copied production data."});
function graph(entry) {
 const seen=new Set(),externals=new Set();
 function walk(file){if(seen.has(file))return;seen.add(file);
 const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 for(const m of code.matchAll(/require\(["']([^"']+)["']\)/g)){const id=m[1];
 if(!id.startsWith(".")&&!id.startsWith("@/")){externals.add(id);continue;}
 if(id.endsWith(".css"))continue;
 const base=id.startsWith("@/")?path.resolve("src",id.slice(2)):path.resolve(path.dirname(file),id);
 const target=[base,base+".ts",base+".tsx",path.join(base,"index.ts")].find(p=>existsSync(p));if(!target)throw new Error("Unresolved "+id);walk(target);
 }}
 walk(path.resolve(entry));return{files:[...seen].map(p=>path.relative(process.cwd(),p).replaceAll("\\","/")).sort(),externals:[...externals].sort()};
}
const client=graph("src/components/experiments/building-contracts/ContractWorkspace.tsx");
if(client.files.some(f=>/fixtures|projection|components\/portal|supabase/i.test(f))||client.externals.some(f=>/supabase/.test(f)))throw new Error("Client graph is not isolated");
const server=graph("src/app/dev/building-workspace-contracts/fixtures/route.ts");
const git=(args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
const trackedDiff=git(["diff","--name-only"]);
write("isolation-verification.json",{checkedAt:new Date().toISOString(),branch:git(["branch","--show-current"]),baseline:git(["rev-parse","HEAD"]),
 acceptedPrototypeFilesHashed:previous.length,acceptedPrototypeChanged:changed,trackedProductionDiff:trackedDiff,
 clientGraph:client,fixtureServerGraph:server,
 inspectedMixedModule:{file:"src/lib/sales/fee-portfolio-data.ts",usedExport:"feePortfolioFromSales (pure)",unusedExport:"readAgentFeePortfolio (RPC; never invoked or imported by the client)",supabaseImport:"type-only, erased"},
 remoteConfigurationCopied:false,remoteServicesConnected:false,existingSaleFileOpened:false,
 note:"Static import inspection plus browser request logs and no-network fixture tests. Not database/RLS/authentication integration proof."});
if(changed.length||trackedDiff)throw new Error("Isolation baseline changed");
console.log(JSON.stringify({prototypeFilesVerified:previous.length,migrationCount:migrations.length,latest:migrations.at(-1)?.name,manifestSha256:sha(migrations.map(x=>x.name+" "+x.sha256+"\n").join("")),clientModules:client.files.length,serverModules:server.files.length}));
