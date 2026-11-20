import {redirect,notFound} from 'next/navigation';
import {hostedStaging,stagingEnabled} from '@/lib/workspace/staging';
import {setupHref,workspaceHref} from '@/lib/workspace/setup-navigation';
export default async function SetupPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){if(!hostedStaging||!stagingEnabled())notFound();const raw=await searchParams,values=Object.fromEntries(Object.entries(raw).filter((e):e is [string,string]=>typeof e[1]==='string'));redirect(['dashboard','sales','snags'].includes(values.screen)?workspaceHref(values.screen,values.building):setupHref(values));}
