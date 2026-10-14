// Where a submission's built bundle and re-encoded images wait for review.
// Outside the uploads folder, so nothing here is ever served by the files
// route; approval moves them into uploads/.
import fs from "fs/promises";
import path from "path";

export function stagingRoot(): string {
  return path.resolve(process.env.STAGING_DIR || path.join(process.cwd(), "data", "staging"));
}

function dirFor(submissionId: string): string {
  if (!/^[0-9a-f-]{8,64}$/i.test(submissionId)) throw new Error("bad submission id");
  return path.join(stagingRoot(), submissionId);
}

/** Path of a staged file, relative to the staging root (what the DB stores). */
export async function stage(submissionId: string, name: string, data: Uint8Array): Promise<string> {
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(name)) throw new Error(`bad staged name ${name}`);
  const dir = dirFor(submissionId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), data);
  return `${submissionId}/${name}`;
}

export async function readStaged(rel: string): Promise<Buffer> {
  const root = stagingRoot();
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("bad staged path");
  return fs.readFile(full);
}

export async function clearStaging(submissionId: string): Promise<void> {
  await fs.rm(dirFor(submissionId), { recursive: true, force: true });
}
