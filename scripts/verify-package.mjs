import { execFileSync } from "node:child_process";

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const parsed = JSON.parse(output);
const pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
if (!pack || !Array.isArray(pack.files)) throw new Error("npm pack did not return file metadata");
const names = pack.files.map((entry) => entry.path);
for (const required of ["dist/extension.js", "dist/extension.d.ts", "src/extension.ts", "prompts/worker.md", "prompts/reviewer.md", "LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "CHANGELOG.md", "SECURITY.md"]) {
  if (!names.includes(required)) throw new Error(`packed tarball omits required payload: ${required}`);
}
for (const name of names) {
  if (/(^|\/)(node_modules|\.git|\.jj|\.pi-subagents|coverage)(\/|$)|\.(tgz|key|pem)$/i.test(name) || /\.env(?:\.|$)/i.test(name)) {
    throw new Error(`packed tarball includes prohibited payload: ${name}`);
  }
}
console.log(`package payload verified (${names.length} files)`);
