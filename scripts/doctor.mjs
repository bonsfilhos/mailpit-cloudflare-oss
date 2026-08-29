import { execFileSync } from "node:child_process";
import { resolveMx } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import {
  buildWranglerConfig,
  GENERATED_CONFIG_PATH,
  loadConfig,
  parseCommonArgs,
  validateConfig,
  writeGeneratedConfig
} from "./config.mjs";

function wrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function normalizeMx(rows) {
  return rows.map((row) => row.exchange.replace(/\.$/, "").toLowerCase()).sort();
}

const args = parseCommonArgs(process.argv.slice(2));
const { config, configPath, isExample } = loadConfig(args.configPath, { remote: args.remote });
validateConfig(config, { remote: args.remote });

const checks = [];
const expectedGenerated = `${JSON.stringify(buildWranglerConfig(config), null, 2)}\n`;
if (!existsSync(GENERATED_CONFIG_PATH) || readFileSync(GENERATED_CONFIG_PATH, "utf8") !== expectedGenerated) {
  writeGeneratedConfig(config);
  checks.push("generated configuration refreshed");
} else {
  checks.push("generated configuration matches source configuration");
}
checks.push(`configuration valid: ${configPath}${isExample ? " (example)" : ""}`);
checks.push("authentication required by configuration");

if (args.remote) {
  JSON.parse(wrangler(["whoami", "--json"]));
  checks.push("Wrangler authentication valid");

  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  const database = databases.find((item) => item.name === config.cloudflare.d1DatabaseName);
  if (!database || database.uuid !== config.cloudflare.d1DatabaseId) {
    throw new Error("Configured D1 binding does not match the authenticated Cloudflare account.");
  }
  checks.push("D1 database exists and ID matches");

  const bucket = JSON.parse(
    wrangler(["r2", "bucket", "info", config.cloudflare.r2BucketName, "--json"])
  );
  if (bucket.name !== config.cloudflare.r2BucketName) throw new Error("Configured R2 bucket was not found.");
  checks.push("R2 bucket exists");

  const secrets = JSON.parse(
    wrangler(["secret", "list", "--config", GENERATED_CONFIG_PATH, "--format", "json"])
  );
  if (!secrets.some((secret) => secret.name === "BASIC_AUTH_PASSWORD")) {
    throw new Error("BASIC_AUTH_PASSWORD is not configured for the Worker.");
  }
  checks.push("required Worker secret exists");

  const inboundMx = normalizeMx(await resolveMx(config.worker.inboundDomain));
  if (!inboundMx.length) throw new Error("Inbound domain has no MX records.");
  checks.push(`inbound MX resolves (${inboundMx.length} records)`);

  if (config.dns.expectedApexMx.length) {
    const apexMx = normalizeMx(await resolveMx(config.dns.apexDomain));
    const expected = [...config.dns.expectedApexMx].map((host) => host.toLowerCase()).sort();
    if (JSON.stringify(apexMx) !== JSON.stringify(expected)) {
      throw new Error("Apex MX records differ from dns.expectedApexMx.");
    }
    checks.push("apex MX invariant preserved");
  }
}

console.log(JSON.stringify({ ok: true, mode: args.remote ? "remote" : "local", checks }, null, 2));
