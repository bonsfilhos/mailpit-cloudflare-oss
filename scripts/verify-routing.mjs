import { Resolver } from "node:dns/promises";
import { loadConfig, parseCommonArgs } from "./config.mjs";

const args = parseCommonArgs(process.argv.slice(2));
const { config } = loadConfig(args.configPath, { remote: true });
const apexDomain = config.dns.apexDomain;
const inboundDomain = config.worker.inboundDomain;
const expectedApexMx = config.dns.expectedApexMx.map(normalize).sort();

if (inboundDomain === apexDomain || !inboundDomain.endsWith(`.${apexDomain}`)) {
  throw new Error("The inbound domain must be a dedicated subdomain of the apex domain");
}

const resolver = new Resolver();
resolver.setServers([process.env.DNS_RESOLVER || "1.1.1.1"]);

const [apexMx, inboundMx, inboundTxt] = await Promise.all([
  resolver.resolveMx(apexDomain),
  resolver.resolveMx(inboundDomain),
  resolver.resolveTxt(inboundDomain).catch(() => [])
]);

const actualApexMx = apexMx.map((record) => normalize(record.exchange)).sort();
const actualInboundMx = inboundMx.map((record) => normalize(record.exchange)).sort();
const apexUnchanged = expectedApexMx.length === 0 || same(actualApexMx, expectedApexMx);
const inboundReady =
  actualInboundMx.length > 0 && actualInboundMx.every((exchange) => exchange.endsWith(".mx.cloudflare.net"));
const routingSpf = inboundTxt.some((chunks) => chunks.join("").includes("include:_spf.mx.cloudflare.net"));

console.log(
  JSON.stringify(
    {
      apex: { domain: apexDomain, mx: actualApexMx, unchanged: apexUnchanged },
      inbound: { domain: inboundDomain, mx: actualInboundMx, cloudflare: inboundReady, spf: routingSpf }
    },
    null,
    2
  )
);

if (!apexUnchanged) throw new Error(`Unexpected MX set on ${apexDomain}`);
if (!inboundReady) throw new Error(`Cloudflare MX records are not ready on ${inboundDomain}`);
if (!routingSpf) throw new Error(`Cloudflare Email Routing SPF record is missing on ${inboundDomain}`);

function normalize(value) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function same(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
