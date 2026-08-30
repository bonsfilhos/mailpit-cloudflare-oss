import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  assertApexMxInvariant,
  buildWranglerConfig,
  LOCAL_D1_ID,
  parseCommonArgs,
  validateConfig
} from "../scripts/config.mjs";

const example = JSON.parse(readFileSync("mailpit-cloudflare.config.example.json", "utf8"));

describe("instance configuration", () => {
  test("generates a safe local Wrangler configuration from the public example", () => {
    const generated = buildWranglerConfig(validateConfig(structuredClone(example)));

    expect(generated.name).toBe("mailpit-cloudflare");
    expect(generated.workers_dev).toBe(true);
    expect(generated.vars.AUTH_REQUIRED).toBe("true");
    expect(generated.vars.INBOUND_DOMAIN).toBe("preview-mail.example.com");
    expect(generated.d1_databases[0]?.database_id).toBe(LOCAL_D1_ID);
    expect(JSON.stringify(generated)).not.toContain("bonsfilhos.com.br");
  });

  test("rejects deployments without authentication", () => {
    const unsafe = structuredClone(example);
    unsafe.worker.authRequired = false;

    expect(() => validateConfig(unsafe)).toThrow(/authRequired/);
  });

  test("rejects remote setup that still uses example values", () => {
    const unconfigured = structuredClone(example);
    unconfigured.cloudflare.d1DatabaseId = "11111111-1111-4111-8111-111111111111";

    expect(() => validateConfig(unconfigured, { remote: true })).toThrow(/example\.com/);
  });

  test("parses the first-install remote diagnosis explicitly", () => {
    expect(parseCommonArgs(["--remote", "--predeploy"])).toMatchObject({
      remote: true,
      predeploy: true
    });
  });

  test("requires an exact apex MX baseline before remote mutation", () => {
    const current = [{ exchange: "ASPMX.L.GOOGLE.COM.", priority: 1 }];

    expect(() => assertApexMxInvariant(current, [], "example.org")).toThrow(/expectedApexMx/);
    expect(assertApexMxInvariant(current, ["aspmx.l.google.com"], "example.org")).toEqual([
      "aspmx.l.google.com"
    ]);
    expect(() =>
      assertApexMxInvariant(current, ["other.example.org"], "example.org")
    ).toThrow(/differs/);
    expect(assertApexMxInvariant([], [], "example.org")).toEqual([]);
  });

  test("keeps the documented local ingestion token executable", () => {
    const vars = readFileSync(".dev.vars.example", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(vars).toContain("INGEST_TOKEN=local-development");
    expect(readme).toContain("Authorization: Bearer local-development");
  });
});
