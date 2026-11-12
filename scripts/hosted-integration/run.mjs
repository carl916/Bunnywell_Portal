import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {origin,keys,privateDir} from './runtime.mjs';
const env={...process.env,NEXT_PUBLIC_WORKSPACE_INTEGRATION:'1',NEXT_PUBLIC_WORKSPACE_FOUNDATION:'0',NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:keys().anon,WORKSPACE_HOSTED_READS:'1',WORKSPACE_READ_GUARD:'1',STAGING_WEB_VITALS:'0',SALES_PERF_LOCAL:'0',NEXT_TELEMETRY_DISABLED:'1'};
for(const name of Object.keys(env))if(/SERVICE_ROLE|SMTP|SENDGRID|RESEND|BREVO|MAILGUN|TWILIO|WEBHOOK|CRON_SECRET/i.test(name))delete env[name];
const args=process.argv[2]==='start'?['start','--hostname','127.0.0.1','--port','3037']:['build','--webpack'];
const r=spawnSync(process.execPath,['node_modules/next/dist/bin/next',...args],{env,stdio:'inherit',windowsHide:true});process.exitCode=r.status||0;
