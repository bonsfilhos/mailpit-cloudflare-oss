import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_CONFIG_PATH = "mailpit-cloudflare.config.json";
export const EXAMPLE_CONFIG_PATH = "mailpit-cloudflare.config.example.json";
export const GENERATED_CONFIG_PATH = "wrangler.generated.jsonc";
export const LOCAL_D1_ID = "00000000-0000-0000-0000-000000000000";

const locations = new Set(["weur", "eeur", "apac", "oc", "wnam", "enam"]);

function fail(message) {
  throw new Error(`Invalid Mailpit Cloudflare configuration: ${message}`);
}

function isHostname(value) {
  return (
    typeof value === "string" &&
    value.length <= 253 &&
    value.split(".").length >= 2 &&
    value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
  );
}

function integer(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function normalizeMxHosts(records) {
  return records
    .map((record) => (typeof record === "string" ? record : record.exchange))
    .filter(Boolean)
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
    .sort();
}

export function assertApexMxInvariant(actualRecords, expectedHosts, apexDomain) {
  const actual = normalizeMxHosts(actualRecords);
  const expected = normalizeMxHosts(expectedHosts);

  if (actual.length > 0 && expected.length === 0) {
    fail(`dns.expectedApexMx must record the current MX set for ${apexDomain} before remote setup`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`the current MX set for ${apexDomain} differs from dns.expectedApexMx`);
  }

  return actual;
}

export function validateConfig(config, { remote = false, requireD1Id = remote } = {}) {
  if (!config || typeof config !== "object") fail("the root value must be an object");
  const { worker, cloudflare, dns } = config;
  if (!worker || typeof worker !== "object") fail("worker is required");
  if (!cloudflare || typeof cloudflare !== "object") fail("cloudflare is required");
  if (!dns || typeof dns !== "object") fail("dns is required");

  if (!/^[a-z][a-z0-9-]{0,62}$/.test(worker.name ?? "")) fail("worker.name is invalid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(worker.compatibilityDate ?? "")) {
    fail("worker.compatibilityDate must use YYYY-MM-DD");
  }
  if (typeof worker.inboxLabel !== "string" || !worker.inboxLabel.trim()) fail("worker.inboxLabel is required");
  if (!isHostname(worker.inboundDomain)) fail("worker.inboundDomain must be a hostname");
  if (worker.webHostname !== null && !isHostname(worker.webHostname)) {
    fail("worker.webHostname must be null or a hostname");
  }
  if (worker.webHostname === worker.inboundDomain) fail("webHostname and inboundDomain must be different");
  if (typeof worker.workersDev !== "boolean") fail("worker.workersDev must be boolean");
  if (!worker.workersDev && !worker.webHostname) fail("enable workersDev or configure webHostname");
  if (worker.authRequired !== true) fail("worker.authRequired must remain true for generated deployments");
  if (typeof worker.basicAuthUsername !== "string" || !worker.basicAuthUsername) {
    fail("worker.basicAuthUsername is required");
  }
  integer(worker.retentionDays, "worker.retentionDays", 1, 365);
  integer(worker.maxMessages, "worker.maxMessages", 1, 100_000);
  integer(worker.maxMessageBytes, "worker.maxMessageBytes", 1_024, 52_428_800);
  if (typeof worker.cron !== "string" || !worker.cron.trim()) fail("worker.cron is required");
  if (!locations.has(worker.eventLocation)) fail("worker.eventLocation is invalid");
  if (!worker.observability || typeof worker.observability.enabled !== "boolean") {
    fail("worker.observability.enabled must be boolean");
  }
  if (
    typeof worker.observability.headSamplingRate !== "number" ||
    worker.observability.headSamplingRate < 0 ||
    worker.observability.headSamplingRate > 1
  ) {
    fail("worker.observability.headSamplingRate must be between 0 and 1");
  }
  try {
    const source = new URL(worker.sourceRepositoryUrl);
    if (source.protocol !== "https:") fail("worker.sourceRepositoryUrl must use HTTPS");
  } catch {
    fail("worker.sourceRepositoryUrl must be a valid HTTPS URL");
  }

  if (!/^[a-z0-9][a-z0-9-_]{0,62}$/.test(cloudflare.d1DatabaseName ?? "")) {
    fail("cloudflare.d1DatabaseName is invalid");
  }
  if (
    cloudflare.d1DatabaseId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cloudflare.d1DatabaseId ?? ""
    )
  ) {
    fail("cloudflare.d1DatabaseId must be null or a UUID");
  }
  if (!locations.has(cloudflare.d1Location)) fail("cloudflare.d1Location is invalid");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(cloudflare.r2BucketName ?? "")) {
    fail("cloudflare.r2BucketName is invalid");
  }
  if (!locations.has(cloudflare.r2Location)) fail("cloudflare.r2Location is invalid");

  if (!isHostname(dns.apexDomain)) fail("dns.apexDomain must be a hostname");
  if (!worker.inboundDomain.endsWith(`.${dns.apexDomain}`)) {
    fail("worker.inboundDomain must be a dedicated subdomain of dns.apexDomain");
  }
  if (!Array.isArray(dns.expectedApexMx) || dns.expectedApexMx.some((host) => !isHostname(host))) {
    fail("dns.expectedApexMx must be an array of hostnames");
  }

  if (requireD1Id) {
    if (!cloudflare.d1DatabaseId || cloudflare.d1DatabaseId === LOCAL_D1_ID) {
      fail("cloudflare.d1DatabaseId must identify a provisioned database");
    }
  }
  if (remote) {
    if (worker.inboundDomain.endsWith(".example.com") || dns.apexDomain === "example.com") {
      fail("replace example.com before remote setup or deployment");
    }
  }
  return config;
}

export function resolveConfigPath(explicitPath) {
  if (explicitPath) return resolve(explicitPath);
  if (existsSync(DEFAULT_CONFIG_PATH)) return resolve(DEFAULT_CONFIG_PATH);
  return resolve(EXAMPLE_CONFIG_PATH);
}

export function loadConfig(explicitPath, options = {}) {
  const configPath = resolveConfigPath(explicitPath);
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  validateConfig(config, options);
  return { config, configPath, isExample: configPath.endsWith(EXAMPLE_CONFIG_PATH) };
}

export function buildWranglerConfig(config) {
  const routes = config.worker.webHostname
    ? [{ pattern: config.worker.webHostname, custom_domain: true }]
    : undefined;
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: config.worker.name,
    main: "src/worker/index.ts",
    compatibility_date: config.worker.compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    workers_dev: config.worker.workersDev,
    ...(routes ? { routes } : {}),
    observability: {
      enabled: config.worker.observability.enabled,
      head_sampling_rate: config.worker.observability.headSamplingRate
    },
    assets: {
      directory: "./dist",
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: true
    },
    durable_objects: { bindings: [{ name: "EVENTS", class_name: "EventHub" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["EventHub"] }],
    triggers: { crons: [config.worker.cron] },
    vars: {
      INBOUND_DOMAIN: config.worker.inboundDomain,
      INBOX_LABEL: config.worker.inboxLabel,
      SOURCE_REPOSITORY_URL: config.worker.sourceRepositoryUrl,
      EVENT_LOCATION_HINT: config.worker.eventLocation,
      MAX_MESSAGES: String(config.worker.maxMessages),
      RETENTION_DAYS: String(config.worker.retentionDays),
      MAX_MESSAGE_BYTES: String(config.worker.maxMessageBytes),
      AUTH_REQUIRED: String(config.worker.authRequired),
      BASIC_AUTH_USERNAME: config.worker.basicAuthUsername
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: config.cloudflare.d1DatabaseName,
        database_id: config.cloudflare.d1DatabaseId ?? LOCAL_D1_ID
      }
    ],
    r2_buckets: [{ bucket_name: config.cloudflare.r2BucketName, binding: "MESSAGE_STORE" }]
  };
}

export function writeGeneratedConfig(config, outputPath = GENERATED_CONFIG_PATH) {
  const generated = `${JSON.stringify(buildWranglerConfig(config), null, 2)}\n`;
  writeFileSync(resolve(outputPath), generated, { mode: 0o600 });
  return resolve(outputPath);
}

export function saveInstanceConfig(config, configPath) {
  writeFileSync(resolve(configPath), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export function parseCommonArgs(argv) {
  const args = { configPath: undefined, remote: false, apply: false, predeploy: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--config") args.configPath = argv[++index];
    else if (value === "--remote") args.remote = true;
    else if (value === "--apply") args.apply = true;
    else if (value === "--predeploy") args.predeploy = true;
    else fail(`unknown argument ${value}`);
  }
  return args;
}
