import type { StoredMessageDetail } from "./types";

interface LinkResult {
  URL: string;
  Status: string;
  StatusCode: number;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }
  if (
    host === "::" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe[89ab][0-9a-f]:/i.test(host) ||
    /^ff[0-9a-f]{2}:/i.test(host)
  ) {
    return true;
  }
  const mappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4) return isBlockedHostname(mappedIpv4);
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function extractLinks(message: StoredMessageDetail): string[] {
  const found = new Set<string>();
  const pattern = /\bhttps?:\/\/[^\s<>'"\])}]+/gi;
  for (const source of [message.Text, message.HTML]) {
    for (const match of source.matchAll(pattern)) {
      const value = (match[0] ?? "").replace(/[.,;:!?]+$/, "");
      try {
        const url = new URL(value);
        if (["http:", "https:"].includes(url.protocol)) found.add(url.toString());
      } catch {
        // Ignore malformed URLs in message bodies.
      }
    }
  }
  return [...found].slice(0, 50);
}

async function checkOne(url: string, followRedirects: boolean): Promise<LinkResult> {
  try {
    let current = new URL(url);
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      if (!["http:", "https:"].includes(current.protocol) || isBlockedHostname(current.hostname)) {
        return { URL: url, Status: "Blocked private or local destination", StatusCode: 0 };
      }
      const response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: { "user-agent": "Mailpit-Cloudflare-Link-Check/0.1" }
      });
      const location = response.headers.get("location");
      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      if (!followRedirects || !isRedirect || !location) {
        return { URL: url, Status: response.statusText, StatusCode: response.status };
      }
      current = new URL(location, current);
    }
    return { URL: url, Status: "Too many redirects", StatusCode: 0 };
  } catch {
    return { URL: url, Status: "Cannot connect to server", StatusCode: 0 };
  }
}

export async function checkLinks(message: StoredMessageDetail, followRedirects: boolean) {
  const links = extractLinks(message);
  const results: LinkResult[] = [];
  for (let offset = 0; offset < links.length; offset += 5) {
    results.push(...(await Promise.all(links.slice(offset, offset + 5).map((url) => checkOne(url, followRedirects)))));
  }
  return { Links: results, Errors: results.filter((result) => result.StatusCode === 0 || result.StatusCode >= 400).length };
}
