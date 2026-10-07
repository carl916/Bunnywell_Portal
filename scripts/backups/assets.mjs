import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, copyFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function storageReference(value, projectRef) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (![`${projectRef}.supabase.co`, `${projectRef}.storage.supabase.co`].includes(url.hostname)) return { external: url.href };
    const match = url.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return { bucket: decodeURIComponent(match[1]), key: decodeURIComponent(match[2]) };
  } catch { return null; }
}
export function safeStoragePath(bucket, key) {
  // Reject Windows aliases and traversal as these packages must also extract
  // safely on Windows. Never pass source filenames to a shell command.
  const segments = `${bucket}/${key}`.split('/');
  if (!bucket || !key || segments.some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f:]/.test(p) || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe Storage path; export stopped.');
  return segments;
}
export async function collectAssets(references, sourceRoot, outputRoot) {
  const source = await realpath(sourceRoot), assets = new Map(), missing = [];
  for (const ref of references) {
    if (!ref.bucket || !ref.key) continue;
    const storageId = `${ref.bucket}/${ref.key}`;
    if (assets.has(storageId)) { Object.assign(ref, assets.get(storageId)); continue; }
    const segments = safeStoragePath(ref.bucket, ref.key);
    const candidate = path.join(source, ...segments);
    let resolved, info;
    try { resolved = await realpath(candidate); info = await stat(resolved); }
    catch (error) { if (error.code === 'ENOENT') { missing.push(ref.id); continue; } throw error; }
    if (!resolved.startsWith(source + path.sep) || !info.isFile()) throw new Error('Storage file resolved outside the media directory.');
    if (ref.expectedBytes != null && Number(ref.expectedBytes) !== info.size) throw new Error(`File size changed for document ${ref.id}; export stopped.`);
    const hash = await sha256(resolved);
    if (ref.expectedHash && /^[a-f0-9]{64}$/i.test(ref.expectedHash) && hash !== ref.expectedHash.toLowerCase()) throw new Error(`Checksum mismatch for document ${ref.id}.`);
    // Hash names are immutable, short and portable; human names stay in the index.
    const extension = /^\.[a-z0-9]{1,8}$/i.test(path.extname(ref.key)) ? path.extname(ref.key).toLowerCase() : '.bin';
    const relative = `files/${hash}${extension}`;
    await mkdir(path.join(outputRoot, 'files'), { recursive: true });
    await copyFile(resolved, path.join(outputRoot, relative));
    const saved = { relative, sha256: hash, bytes: info.size };
    assets.set(storageId, saved); Object.assign(ref, saved);
  }
  if (missing.length) throw new Error(`${missing.length} referenced files are missing; Latest must not be replaced. Document references: ${missing.slice(0, 10).join(', ')}`);
  return assets;
}
export async function saveCorrespondence(references, outputRoot) {
  await mkdir(path.join(outputRoot, 'files'), { recursive: true });
  for (const ref of references.filter(item => item.correspondence != null)) {
    const bytes = Buffer.from(ref.correspondence, 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    ref.relative = `files/${hash}.txt`; ref.sha256 = hash; ref.bytes = bytes.length;
    await writeFile(path.join(outputRoot, ref.relative), bytes);
  }
}
