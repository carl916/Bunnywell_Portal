import {NextRequest,NextResponse} from "next/server";
import {hostedIntegration,stagingEnabled,stagingOrigin} from "./lib/workspace/staging";
export function proxy(request:NextRequest) {
 if(!hostedIntegration)return NextResponse.next();
 if(!stagingEnabled())return new NextResponse("Integration environment unavailable",{status:503});
 const path=request.nextUrl.pathname;
 if(!["GET","HEAD"].includes(request.method))return NextResponse.json({error:"Business actions are disabled in this read-only integration."},{status:403});
 if(path==="/")return NextResponse.redirect(new URL("/workspace",request.url));
 const allowed=path==="/workspace"||path==="/workspace/read"||path.startsWith("/_next/")||path.startsWith("/branding/")||path.startsWith("/brand/")||path==="/favicon.ico";
 if(!allowed)return new NextResponse("Unavailable in the read-only integration",{status:404});
 const response=NextResponse.next();
 response.headers.set("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'"+(process.env.NODE_ENV==="development"?" 'unsafe-eval'":"")+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: "+stagingOrigin+"; font-src 'self' data:; connect-src 'self' "+stagingOrigin+"; frame-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'");
 response.headers.set("X-Robots-Tag","noindex, nofollow");
 return response;
}
export const config={matcher:"/:path*"};
