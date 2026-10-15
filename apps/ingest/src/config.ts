import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const dataDir = resolve(process.env.JOBR_DATA_DIR ?? fileURLToPath(new URL("../../../data/", import.meta.url)));
export const dataPath = (name: string) => resolve(dataDir, name);
export const seedPath = process.env.JOBR_SEED_PATH ?? dataPath("seed-boards.json");
export function logFailure(provider: string, board: string, error: unknown) {
  const detail = { provider, board, error: error instanceof Error ? error.message : "Unknown failure" };
  console.error(JSON.stringify({ event: "ingestion_failure", ...detail }));
  return detail;
}
