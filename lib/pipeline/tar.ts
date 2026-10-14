// Minimal ustar reader and writer for moving source to the build VM and
// output back. The reader only returns regular files with safe relative
// paths; links, devices, absolute paths and ".." are skipped, because the
// output comes from code we don't trust.

const BLOCK = 512;

function octal(buf: Buffer, off: number, len: number): number {
  const s = buf.subarray(off, off + len).toString("ascii").replace(/\0.*$/, "").trim();
  return s ? parseInt(s, 8) : 0;
}

function str(buf: Buffer, off: number, len: number): string {
  const end = buf.indexOf(0, off);
  return buf.subarray(off, end === -1 || end > off + len ? off + len : end).toString("utf8");
}

export function safeRelPath(p: string): string | null {
  const s = p.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!s || s.startsWith("/") || s.includes("\\") || s.includes("\0")) return null;
  if (s.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return s;
}

export interface UnpackLimits {
  maxFiles: number;
  maxBytes: number;
}

export function unpack(tar: Buffer, limits: UnpackLimits): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let off = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (off + BLOCK <= tar.length) {
    const header = tar.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(header, 345, 155);
    let name = str(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = off + BLOCK;
    const data = tar.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (data.length < size) throw new Error("Truncated archive");

    if (type === "L") { longName = data.toString("utf8").replace(/\0+$/, ""); continue; }
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      paxPath = m ? m[1] : null;
      continue;
    }
    if (type === "g") continue;
    const path = longName ?? paxPath ?? name;
    longName = null;
    paxPath = null;
    if (type !== "0" && type !== "\0" && type !== "7") continue; // dirs, links, devices
    const rel = safeRelPath(path);
    if (!rel) continue;
    total += size;
    if (files.size >= limits.maxFiles) throw new Error(`Archive has more than ${limits.maxFiles} files`);
    if (total > limits.maxBytes) throw new Error(`Archive holds more than ${limits.maxBytes} bytes`);
    files.set(rel, new Uint8Array(data));
  }
  return files;
}

function header(name: string, size: number): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  let prefix = "";
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf("/", 154);
    if (cut <= 0 || Buffer.byteLength(name.slice(cut + 1)) > 100) throw new Error(`Path too long for tar: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  h.write(base, 0, 100, "utf8");
  h.write("0000644\0", 100, "ascii");
  h.write("0001750\0", 108, "ascii");
  h.write("0001750\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii");
  h[156] = 48; // "0": regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

export function pack(files: Map<string, Uint8Array>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, data] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const rel = safeRelPath(name);
    if (!rel) throw new Error(`Unsafe path ${name}`);
    parts.push(header(rel, data.length), Buffer.from(data), Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
