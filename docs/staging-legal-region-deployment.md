# Opt-in staging legal function region

The optional overlay in `config/vercel.staging-legal-region.json` puts only `src/app/api/sales/legal/route.ts` in `fra1`, with `iad1` as the default for every other function. It covers both GET and POST on `/api/sales/legal`. It does not change the route's Node.js runtime, URLs, permissions, application behaviour or the Supabase project.

Normal Vercel Git deployments continue to use the existing root `vercel.json`. This overlay is not automatically loaded by Vercel. Merging these supporting files into `main` therefore does not enable the override in production, staging or a normal PR preview. The helper never deploys or assigns an alias.

For an explicitly approved staging deployment, make the supporting files available on the `staging` branch, and use the CLI linked to the existing `bunnywell-portal` project and its existing team. Pull the **preview environment for the staging branch**; verify the effective Supabase URL is `https://vxkpvdtrldwwqiddoyof.supabase.co`, and that all Supabase credentials are for that same project. Keep sensitive values out of logs.

Generate the configuration from that staging checkout, then deploy from a new isolated branch so the CLI cannot associate the preview with the normal staging branch domain. Use an unused branch name if the example already exists; verify the branch switch succeeded before continuing:

```powershell
node scripts/prepare-staging-legal-region.mjs --check
node scripts/prepare-staging-legal-region.mjs
git switch -c codex/staging-legal-region-preview
git push -u origin codex/staging-legal-region-preview
vercel deploy --target preview --local-config .vercel/staging-legal-region.json --meta githubDeployment=1 --meta githubCommitRef=codex/staging-legal-region-preview
```

The helper merges the overlay into the checkout's current `vercel.json`, preserving cron definitions and other function settings. It writes only an ignored temporary configuration and refuses to generate it from any branch except `staging`. `--check` prints the merged configuration without writing or deploying. The new branch inherits the shared Preview Supabase configuration; verify any required branch-specific staging overrides on that isolated branch before deploying. A Git push may create an additional ordinary preview; it does not enable the optional overlay. Do not use `--prod`, promote this preview, or change project-wide Function Region settings for this experiment. `--skip-domain` is a production-only option and is not a preview isolation mechanism.

Inspect the new immutable preview before considering a separate, authorised staging-alias assignment. Check the full `x-vercel-id` execution region on successful legal GET and POST requests: B must contain `::fra1::`; other sampled functions must contain `::iad1::`. The initial ingress region alone is not the execution region. Confirm browser-to-Supabase requests still target staging. If isolation fails, reject the deployment; do not alter runtime or routing to make it fit.

Keep any later staging alias assignment outside this helper and perform it only after its own approval. The 5 October targeted comparison created immutable previews and left the normal staging alias and production unchanged. Its mutation sample is one authority issue per region; it is insufficient to establish a mutation latency distribution or a production benefit.

Discarding the generated configuration returns subsequent ordinary deployments to the root configuration. Removing or adding the optional overlay has no effect on already deployed functions; region settings take effect on a new deployment.

References: [Vercel per-function regions](https://vercel.com/docs/functions/configuring-functions/region), [Vercel deployment CLI and branch association](https://vercel.com/docs/cli/deploy), [local configuration override](https://vercel.com/docs/cli/global-options#local-config), [preview branch environment pull](https://vercel.com/docs/cli/pull).
