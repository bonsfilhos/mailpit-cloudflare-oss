import { execFileSync } from "node:child_process";
import {
  loadConfig,
  parseCommonArgs,
  saveInstanceConfig,
  validateConfig,
  writeGeneratedConfig
} from "./config.mjs";

function wrangler(args, { capture = false, tolerateFailure = false } = {}) {
  try {
    return execFileSync("npx", ["wrangler", ...args], {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
  } catch (error) {
    if (tolerateFailure) return null;
    throw error;
  }
}

function d1Databases() {
  return JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }));
}

const args = parseCommonArgs(process.argv.slice(2));
if (!args.configPath) {
  throw new Error("Pass --config mailpit-cloudflare.config.json. The example file is never provisioned.");
}
const { config, configPath, isExample } = loadConfig(args.configPath);
if (isExample) throw new Error("Copy and edit the example configuration before provisioning.");
validateConfig(config, { remote: true, requireD1Id: false });

const plan = {
  worker: config.worker.name,
  d1: config.cloudflare.d1DatabaseName,
  r2: config.cloudflare.r2BucketName,
  inboundDomain: config.worker.inboundDomain,
  web: config.worker.webHostname ?? "workers.dev"
};
console.log(JSON.stringify({ mode: args.apply ? "apply" : "plan", ...plan }, null, 2));

if (!args.apply) {
  console.log("No remote changes made. Re-run with --apply after reviewing the plan.");
  process.exit(0);
}

wrangler(["whoami", "--json"], { capture: true });

let database = d1Databases().find((item) => item.name === config.cloudflare.d1DatabaseName);
if (!database) {
  wrangler([
    "d1",
    "create",
    config.cloudflare.d1DatabaseName,
    "--location",
    config.cloudflare.d1Location
  ]);
  database = d1Databases().find((item) => item.name === config.cloudflare.d1DatabaseName);
}
if (!database?.uuid) throw new Error("D1 database was not found after provisioning.");
if (config.cloudflare.d1DatabaseId && config.cloudflare.d1DatabaseId !== database.uuid) {
  throw new Error("The configured D1 ID does not match the account resource with the same name.");
}

const bucketExists = wrangler(
  ["r2", "bucket", "info", config.cloudflare.r2BucketName, "--json"],
  { capture: true, tolerateFailure: true }
);
if (!bucketExists) {
  wrangler([
    "r2",
    "bucket",
    "create",
    config.cloudflare.r2BucketName,
    "--location",
    config.cloudflare.r2Location
  ]);
}

config.cloudflare.d1DatabaseId = database.uuid;
saveInstanceConfig(config, configPath);
const generatedPath = writeGeneratedConfig(config);
wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", generatedPath]);

console.log(
  [
    "Cloudflare storage is ready.",
    `Next: npx wrangler secret put BASIC_AUTH_PASSWORD --config ${generatedPath}`,
    "Optional HTTP ingestion: set INGEST_TOKEN as a separate secret.",
    "Then run npm run deploy and configure the Email Routing catch-all manually."
  ].join("\n")
);
