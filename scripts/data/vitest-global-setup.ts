/** Make sure the staged snapshot exists before any test reads client/public/data.json (see stage-public-data.mjs). */
import { spawnSync } from "node:child_process";
import path from "node:path";

export default function setup() {
  const r = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "stage-public-data.mjs")], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("could not stage the snapshot data");
}
