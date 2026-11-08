#!/usr/bin/env node
// Substitutes $KV_ID into a temp wrangler config and runs `wrangler deploy`.
// Keeps the committed wrangler.jsonc clean (placeholder stays in place).

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

const kvId = process.env.KV_ID;
if (!kvId) {
  console.error("error: KV_ID env var is required for deploy");
  console.error("       (set it as a Workers Builds variable in the Cloudflare dashboard,");
  console.error("        or export it locally before running `npm run deploy`)");
  process.exit(1);
}

const PLACEHOLDER = "REPLACE_WITH_YOUR_KV_NAMESPACE_ID";
const SOURCE = "wrangler.jsonc";
const TEMP = ".wrangler.deploy.jsonc";

const template = readFileSync(SOURCE, "utf8");
if (!template.includes(PLACEHOLDER)) {
  console.error(`error: placeholder "${PLACEHOLDER}" not found in ${SOURCE}`);
  process.exit(1);
}

writeFileSync(TEMP, template.replaceAll(PLACEHOLDER, kvId));

const result = spawnSync("npx", ["wrangler", "deploy", "--config", TEMP], {
  stdio: "inherit",
});

try { unlinkSync(TEMP); } catch {}
process.exit(result.status ?? 1);
