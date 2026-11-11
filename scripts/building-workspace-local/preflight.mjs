// Read-only prerequisite check. Never starts, resets, links, seeds or queries a database.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = name => JSON.parse(readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, ""));
const hash = name => createHash("sha256").update(readFileSync(name)).digest("hex");
const run = (exe, args) => spawnSync(exe, args, { cwd: root, encoding: "utf8", timeout: 10000, windowsHide: true });
const blockers = [];
const schema = readJson("artifacts/building-contracts-stage1/schema-baseline.json");
const baseline = readJson("artifacts/building-workspace-stage2/accepted-ui-baseline.json");
const schemaMismatches = schema.migrations.filter(m => !existsSync(path.join(root, "supabase/migrations", m.name)) ||
  hash(path.join(root, "supabase/migrations", m.name)) !== m.sha256).map(m => m.name);
const acceptedUiMismatches = baseline.files.filter(f => !existsSync(path.join(root, f.path)) ||
  hash(path.join(root, f.path)) !== f.sha256).map(f => f.path);
if (schemaMismatches.length) blockers.push("Recorded schema baseline has changed.");
if (acceptedUiMismatches.length) blockers.push("Accepted UI snapshot has changed.");
const currentBranch = run("git", ["branch", "--show-current"]).stdout?.trim();
if (currentBranch !== "codex/building-workspace-contracts") blockers.push("Not in the approved integration branch.");
// Refuse remote Docker overrides before any daemon operation. No secret values are logged.
const remoteOverride = Boolean(process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT);
if (remoteOverride) blockers.push("Clear Docker target overrides before checking the isolated local runtime.");
const dockerCandidates = ["docker",
  path.join(process.env.ProgramFiles || "C:/Program Files", "Docker/Docker/resources/bin/docker.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Programs/DockerDesktop/resources/bin/docker.exe")];
const docker = dockerCandidates.find(candidate => run(candidate, ["--version"]).status === 0);
let localDockerDaemon = false;
if (!docker) blockers.push("A local Docker-compatible runtime is not installed or available.");
else if (!remoteOverride) {
  const context = run(docker, ["context", "inspect"]);
  let endpoint = "";
  try { endpoint = JSON.parse(context.stdout)[0]?.Endpoints?.docker?.Host || ""; } catch {}
  if (!endpoint.startsWith("npipe://") && !endpoint.startsWith("unix://")) {
    blockers.push("Docker context is not a local named pipe or Unix socket; no daemon contacted.");
  } else {
    const info = run(docker, ["info", "--format", "{{.OSType}}"]);
    localDockerDaemon = info.status === 0 && info.stdout.trim() === "linux";
    if (!localDockerDaemon) blockers.push("The local Linux container engine is not running.");
  }
}
const report = {
  date: new Date().toISOString(), projectId: "bunnywell-workspace-stage2",
  environmentApproval: "approved", branch: currentBranch,
  recordedMigrations: schema.migrationCount, schemaMismatches,
  acceptedUiFiles: baseline.files.length, acceptedUiMismatches,
  localDockerExecutable: Boolean(docker), localDockerDaemon,
  blockers, prerequisiteChecksPassed: blockers.length === 0,
  safeToSeed: false,
  remainingBeforeSeed: ["Verify project-specific empty volumes and loopback binding.", "Install and verify default-deny container and browser egress.", "Verify local mail sink; disable delivery jobs and external hooks.", "Replay and verify the recorded schema in the new empty project."],
  businessServicesContacted: false,
  note: "Prerequisites only. Even a pass is not isolation, RLS, schema replay or integration proof."
};
const output = path.join(root, "artifacts/building-workspace-stage2");
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, "preflight.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exitCode = blockers.length ? 1 : 0;


