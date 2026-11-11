import { mkdirSync, writeFileSync } from "node:fs";
// Plain fictional one-page PDFs for the approved local review only.
export function writeReviewPdfs(out, unit) {
 mkdirSync(out,{recursive:true});
 for(const [name,title] of [["completion-v1.pdf","Completion statement - version 1"],["completion-v2.pdf","Completion statement - revised version 2"],["statement-of-account.pdf","Statement of account"]]){
  const lines=["SYNTHETIC LOCAL TEST - NOT A REAL SALE","Willow Court / "+unit,title,"Fictional Completion Reviewer","For document review testing only."];
  const stream="BT /F1 16 Tf 50 780 Td "+lines.map((t,i)=>(i?"0 -32 Td ":"")+"("+t.replace(/[()\\]/g," ") +") Tj").join("\n")+" ET";
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"];
  let pdf="%PDF-1.4\n";const offsets=[];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+o+"\nendobj\n";});
  const xref=Buffer.byteLength(pdf);
  pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  writeFileSync(out+"/"+name,pdf);
 }
}
