$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $projectRoot
$projectName = 'bunnywell-backend-foundation'
New-Item -ItemType Directory -Force -Path 'tmp/backend-foundation','artifacts/backend-foundation' | Out-Null
$dockerExe = 'C:\Users\carlg\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$env:PATH = (Split-Path $dockerExe) + ';' + $env:PATH
$env:DOCKER_CONTEXT = 'desktop-linux'
$dockerContext = (& $dockerExe context inspect desktop-linux | ConvertFrom-Json)[0]
if (-not $dockerContext.Endpoints.docker.Host.StartsWith('npipe://')) { throw 'Local Docker context required.' }
$networkName = "$projectName-internal"
$ErrorActionPreference = 'Continue'
& $dockerExe network inspect $networkName *> $null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) {
    & $dockerExe network create --internal --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 --label bunnywell.purpose=approved-local-stage2 $networkName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated network.' }
}
$ingressName = "$projectName-ingress"
$ErrorActionPreference = 'Continue'
& $dockerExe container inspect $ingressName *> $null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -ne 0) {
    $relaySource = Join-Path $projectRoot 'backend-local/ingress.cjs'
    & $dockerExe run -d --name $ingressName --network bridge --network $networkName --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 128m --user 1000:1000 -p 127.0.0.1:55321:55321 -p 127.0.0.1:55322:55322 -p 127.0.0.1:55324:55324 --mount "type=bind,source=$relaySource,target=/ingress.cjs,readonly" --entrypoint node public.ecr.aws/supabase/storage-api:v1.88.0 /ingress.cjs | Out-Null
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
$ErrorActionPreference = 'Continue'
& npx --yes supabase@3.0.0 start --workdir backend-local --network-id $networkName --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor --agent yes --output json 2>&1 | Out-File -Encoding utf8 tmp/backend-foundation/runtime-start.log
if ($LASTEXITCODE -ne 0) { throw 'Local Supabase startup failed. Inspect the private runtime log.' }
& npx --yes supabase@3.0.0 status --workdir backend-local --output json | Out-File -Encoding utf8 backend-local/status.json
if ($LASTEXITCODE -ne 0) { throw 'Could not read local connection settings.' }
& node scripts/backend-foundation/runtime.mjs --verify
if ($LASTEXITCODE -ne 0) { throw 'Isolation verification failed.' }
