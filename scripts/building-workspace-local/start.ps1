$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectRoot
$projectName = 'bunnywell-workspace-stage2'
$dockerExe = 'C:\Users\carlg\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$env:PATH = (Split-Path $dockerExe) + ';' + $env:PATH
$env:DOCKER_CONTEXT = 'desktop-linux'
$dockerContext = (& $dockerExe context inspect desktop-linux | ConvertFrom-Json)[0]
if (-not $dockerContext.Endpoints.docker.Host.StartsWith('npipe://')) { throw 'Local Docker context required.' }
$networkName = "$projectName-internal"
& $dockerExe network inspect $networkName *> $null
if ($LASTEXITCODE -ne 0) {
    & $dockerExe network create --internal --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 --label bunnywell.purpose=approved-local-stage2 $networkName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated network.' }
}
$ingressName = "$projectName-ingress"
& $dockerExe container inspect $ingressName *> $null
if ($LASTEXITCODE -ne 0) {
    $relaySource = Join-Path $projectRoot 'local-runtime/ingress.cjs'
    & $dockerExe run -d --name $ingressName --network bridge --network $networkName --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 128m --user 1000:1000 -p 127.0.0.1:54321:54321 -p 127.0.0.1:54322:54322 -p 127.0.0.1:54324:54324 --mount "type=bind,source=$relaySource,target=/ingress.cjs,readonly" --entrypoint node public.ecr.aws/supabase/storage-api:v1.88.0 /ingress.cjs | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the fixed local relay.' }
} else {
    & $dockerExe start $ingressName | Out-Null
}
# Remove only this relay's route. Database/Auth/Storage remain solely on the internal network.
$relayRoutes = & $dockerExe exec $ingressName ip route
if ($relayRoutes -match '^default ') {
    & $dockerExe exec --privileged --user 0 $ingressName ip route del default
    if ($LASTEXITCODE -ne 0) { throw 'Could not block relay egress.' }
}
& npx --yes supabase@3.0.0 start --workdir local-runtime --network-id $networkName --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor --agent yes --output json 2>&1 | Out-File -Encoding utf8 artifacts/building-workspace-stage2/runtime-start.log
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase startup failed. Inspect the private runtime log.' }
& npx --yes supabase@3.0.0 status --workdir local-runtime --output json | Out-File -Encoding utf8 local-runtime/status.json
if ($LASTEXITCODE -ne 0) { throw 'Could not read local connection settings.' }
& node scripts/building-workspace-local/runtime.mjs --verify
if ($LASTEXITCODE -ne 0) { throw 'Isolation verification failed.' }
$env:NODE_ENV = 'development'
$env:BUILDING_WORKSPACE_LOCAL = '1'
$env:BUILDING_COMPLETION_LOCAL = '1'
$localSettings = Get-Content -Raw local-runtime/status.json | ConvertFrom-Json
if ($localSettings.API_URL -ne 'http://127.0.0.1:54321') { throw 'Unexpected local API origin.' }
$env:NEXT_PUBLIC_SUPABASE_URL = $localSettings.API_URL
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $localSettings.ANON_KEY
$env:SUPABASE_SERVICE_ROLE_KEY = $localSettings.SERVICE_ROLE_KEY
$env:RESEND_API_KEY = ''
$env:CRON_SECRET = ''
$env:NODE_OPTIONS = '--import=' + ([uri](Join-Path $projectRoot 'scripts/building-workspace-local/network-guard.mjs')).AbsoluteUri

$env:STAGING_WEB_VITALS = '0'
$env:SALES_PERF_LOCAL = '0'
$env:NEXT_TELEMETRY_DISABLED = '1'
$nodeExe = (Get-Command node).Source
try { $uiReady = (Invoke-WebRequest 'http://127.0.0.1:3032/dev/building-workspace' -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $uiReady = $false }
if (-not $uiReady) {
    Start-Process -FilePath $nodeExe -ArgumentList @('node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3032') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput 'artifacts/building-workspace-stage2/ui-background.log' -RedirectStandardError 'artifacts/building-workspace-stage2/ui-background-error.log' | Out-Null
}
try { $gateway = Invoke-RestMethod 'http://127.0.0.1:3031/local-config' -TimeoutSec 3 } catch { $gateway = $null }
if ($gateway -and ($gateway.projectId -ne $projectName -or -not $gateway.completionReview)) { throw 'Review port is occupied by a different project.' }
if (-not $gateway) {
    Start-Process -FilePath $nodeExe -ArgumentList @('scripts/building-workspace-local/gateway.mjs') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput 'artifacts/building-workspace-stage2/gateway-background.log' -RedirectStandardError 'artifacts/building-workspace-stage2/gateway-background-error.log' | Out-Null
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $liveConfig = Invoke-RestMethod 'http://127.0.0.1:3031/local-config' -TimeoutSec 2
        $livePage = Invoke-WebRequest 'http://127.0.0.1:3031/dev/building-workspace' -UseBasicParsing -TimeoutSec 2
        if ($liveConfig.projectId -eq $projectName -and $livePage.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'The local interface did not become ready. Check the UI and gateway logs; no data has been reset.' }
# Verify that an already running UI has the new action guard and local configuration.
& node --input-type=module -e "const q=new URLSearchParams({building:'b1700000-0000-4000-8000-000000000001',unit:'b1700000-0000-4000-8000-000000000001',sale:'b1700000-0000-4000-8000-000000000001',kind:'comments'});const http=await import('node:http');const r=await new Promise((resolve,reject)=>http.get('http://127.0.0.1:3031/dev/building-workspace/completion?'+q,resolve).on('error',reject));let body='';for await(const chunk of r)body+=chunk;const b=JSON.parse(body);if(r.statusCode!==400||b.error!=='Sign in to the local workspace.')process.exit(1);"
if ($LASTEXITCODE -ne 0) { throw 'The running UI does not have the guarded Completion route ready. Stop only this worktree UI and restart; no data has been reset.' }
Write-Output 'Review: http://127.0.0.1:3031/dev/building-workspace'
Write-Output 'Synthetic test sign-ins: local-runtime/test-access.json'
Write-Output 'This command never replays the schema or reseeds existing data.'




