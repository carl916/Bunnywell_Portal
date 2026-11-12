import {NextRequest,NextResponse} from "next/server";
import {hostedIntegration,stagingEnabled,stagingOrigin,completionWritesEnabled,coreSalesEnabled,integrationProject} from "./lib/workspace/staging";
export function proxy(request:NextRequest) {
 if(!hostedIntegration)return NextResponse.next();
 if(!stagingEnabled())return new NextResponse("Integration environment unavailable",{status:503});
 const path=request.nextUrl.pathname;
 const command=request.method==="POST"&&((path==="/workspace/command"&&completionWritesEnabled())||(path==="/workspace/upload"&&coreSalesEnabled()));
 if(!["GET","HEAD"].includes(request.method)&&!command)return NextResponse.json({error:"This operation is unavailable in the integration."},{status:403});
 if(path==="/")return NextResponse.redirect(new URL("/workspace",request.url));
 const allowed=command||path==="/workspace"||path==="/workspace/read"||path.startsWith("/_next/")||path.startsWith("/branding/")||path.startsWith("/brand/")||path==="/favicon.ico";
 if(!allowed)return new NextResponse("Unavailable in the integration",{status:404});
 const response=NextResponse.next();
 response.headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'"+(process.env.NODE_ENV==="development"?" 'unsafe-eval'":"")+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: "+stagingOrigin+"; font-src 'self' data:; connect-src 'self' "+stagingOrigin+(completionWritesEnabled()?" https://"+integrationProject+".storage.supabase.co":"")+"; frame-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'");
 response.headers.set("X-Robots-Tag","noindex, nofollow");
 return response;
}
export const config={matcher:"/:path*"};
