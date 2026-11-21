import type { NextConfig } from "next";
const staging = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_PROJECT_ID === 'prj_4s8vIyfrGh9DSGJcixTU5slevr5P' || !process.env.VERCEL && process.env.NEXT_PUBLIC_WORKSPACE_STAGING === '1';
const nextConfig: NextConfig = { distDir: '.next-hosted', ...(staging ? {env: { NEXT_PUBLIC_SHOW_ENV_BANNER:'true', NEXT_PUBLIC_PORTAL_ENV:'staging', NEXT_PUBLIC_WORKSPACE_STAGING:'1', WORKSPACE_HOSTED_READS:'1', WORKSPACE_READ_GUARD:'1', WORKSPACE_COMPLETION_WRITES:'1', WORKSPACE_CORE_SALES_WRITES:'1', WORKSPACE_OPERATIONS_WRITES:'1' }} : {}) };
export default nextConfig;
