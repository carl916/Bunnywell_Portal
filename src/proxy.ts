import {NextRequest,NextResponse} from "next/server";
import {hostedWorkspace,hostedStaging,stagingEnabled,stagingOrigin,completionWritesEnabled,coreSalesEnabled,operationsWritesEnabled,stagingProject} from "./lib/workspace/staging";
import {isSetupDestination,setupHref,setupScreens,setupApiAllowed} from "./lib/workspace/setup-navigation";
export function proxy(request:NextRequest) {
 if(!hostedWorkspace)return NextResponse.next();
 if(!stagingEnabled()) { console.error('Workspace environment guard',JSON.stringify({project:process.env.VERCEL_PROJECT_ID,target:process.env.VERCEL_ENV,url:process.env.NEXT_PUBLIC_SUPABASE_URL,staging:process.env.NEXT_PUBLIC_WORKSPACE_STAGING,reads:process.env.WORKSPACE_HOSTED_READS,guard:process.env.WORKSPACE_READ_GUARD}));return new NextResponse("Workspace environment unavailable",{status:503}); }
 const path=request.nextUrl.pathname;
 const values=Object.fromEntries(request.nextUrl.searchParams);
 if(hostedStaging&&["GET","HEAD"].includes(request.method)&&((path==="/workspace"&&values.view==="building-settings")||(path==="/"&&setupScreens.includes(values.screen as typeof setupScreens[number]))))return NextResponse.redirect(new URL(setupHref(values),request.url));
 const setupApi=hostedStaging&&setupApiAllowed(path,request.method);
 const dispatcher=hostedStaging&&request.method==='POST'&&path==='/workspace/notification-dispatch';
 const command=dispatcher||request.method==="POST"&&((path==="/workspace/command"&&completionWritesEnabled())||(path==="/workspace/upload"&&coreSalesEnabled())||(["/workspace/operations","/workspace/snag-upload","/workspace/accounts"].includes(path)&&operationsWritesEnabled()));
 if(!["GET","HEAD"].includes(request.method)&&!command&&!setupApi)return NextResponse.json({error:"This operation is unavailable in the integration."},{status:403});
 if(path==="/")return NextResponse.redirect(new URL("/workspace",request.url));
 const allowed=command||setupApi||(hostedStaging&&["/setup","/request-access","/bunnywell-logo-icon.jpg","/bunnywell-logo-icon.png","/bunnywell-logo.png","/bunnywell-report-logo.png"].includes(path))||path==="/workspace"||path==="/workspace/read"||path.startsWith("/_next/")||path.startsWith("/branding/")||path.startsWith("/brand/")||path==="/favicon.ico";
 if(!allowed)return new NextResponse("Unavailable in the integration",{status:404});
 const response=NextResponse.next();
 response.headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'"+(process.env.NODE_ENV==="development"?" 'unsafe-eval'":"")+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: "+stagingOrigin+"; media-src 'self' "+stagingOrigin+"; font-src 'self' data:; connect-src 'self' "+stagingOrigin+(completionWritesEnabled()?" https://"+stagingProject+".storage.supabase.co":"")+"; frame-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'");
 response.headers.set("X-Robots-Tag","noindex, nofollow");
 return response;
}
export const config={matcher:"/:path*"};
