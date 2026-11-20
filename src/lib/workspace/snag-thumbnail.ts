import sharp from "sharp";
import {stagingOrigin} from "./staging";

// Called only after exact building, snag and photo authorisation. No shared cache
// or public image proxy: each thumbnail uses the authenticated no-store read.
export async function createSnagThumbnail(source:string){
 const url=new URL(source);
 if(url.origin!==stagingOrigin||!url.pathname.startsWith("/storage/v1/"))throw Error("Evidence origin unavailable.");
 const response=await fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok||!response.body)throw Error("Evidence unavailable.");
 // Existing annotated camera photos predate the 4 MiB upload limit. Keep a
 // separate, bounded read budget so those valid records can generate thumbnails.
 const reader=response.body.getReader(),chunks:Uint8Array[]=[],limit=20*1024*1024;let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error("Evidence exceeds the thumbnail limit.");chunks.push(value)}}finally{await reader.cancel()}
 const thumbnail=await sharp(Buffer.concat(chunks),{limitInputPixels:40_000_000}).rotate().resize(128,128,{fit:"cover",withoutEnlargement:true}).webp({quality:70}).toBuffer();
 return "data:image/webp;base64,"+thumbnail.toString("base64");
}
