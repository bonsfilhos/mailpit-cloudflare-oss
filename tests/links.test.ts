import { afterEach, describe, expect, test, vi } from "vitest";
import { checkLinks, isBlockedHostname } from "../src/worker/links";
import type { StoredMessageDetail } from "../src/worker/types";

afterEach(() => vi.unstubAllGlobals());

describe("link checks", () => {
  test.each(["localhost.", "service.internal", "10.0.0.1", "[fd00::1]", "::ffff:127.0.0.1"])(
    "blocks local or private hostname %s",
    (hostname) => expect(isBlockedHostname(hostname)).toBe(true)
  );

  test("revalidates every redirect target", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } })
    );
    vi.stubGlobal("fetch", fetch);

    const result = await checkLinks(messageWith("https://public.example/redirect"), true);

    expect(fetch).toHaveBeenCalledOnce();
    expect(result.Links[0]).toMatchObject({ Status: "Blocked private or local destination", StatusCode: 0 });
  });
});

function messageWith(url: string): StoredMessageDetail {
  return {
    ID: "message",
    MessageID: "",
    From: null,
    To: [],
    Cc: [],
    Bcc: [],
    ReplyTo: [],
    ReturnPath: "",
    Subject: "",
    ListUnsubscribe: { Header: "", HeaderPost: "", Links: [], Errors: "" },
    Date: new Date(0).toISOString(),
    Tags: [],
    Username: "",
    Text: url,
    HTML: "",
    Size: url.length,
    Inline: [],
    Attachments: [],
    OtherParts: [],
    Headers: {}
  };
}
