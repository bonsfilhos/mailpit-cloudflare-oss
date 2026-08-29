import PostalMime from "postal-mime";
import { describe, expect, test } from "vitest";
import {
  buildRawMime,
  flattenPostalAddresses,
  normalizedTags,
  parseAddressMetadata,
  tagsFromRecipient
} from "../src/worker/format";

describe("message formatting", () => {
  test("builds a parseable multipart message with an attachment", async () => {
    const raw = buildRawMime({
      From: { Name: "Example App", Email: "no-reply@app.example.com" },
      To: [{ Name: "Preview", Email: "storefront+preview+receipt@preview-mail.example.com" }],
      Subject: "Order receipt",
      Text: "Plain text",
      HTML: "<strong>HTML text</strong>",
      Tags: ["storefront", "preview"],
      Attachments: [
        {
          Filename: "receipt.txt",
          ContentType: "text/plain",
          Content: btoa("attachment")
        }
      ]
    });

    const parsed = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
    expect(parsed.subject).toBe("Order receipt");
    expect(parsed.text).toContain("Plain text");
    expect(parsed.html).toContain("HTML text");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.filename).toBe("receipt.txt");
  });

  test("normalizes metadata addresses and group addresses", () => {
    expect(parseAddressMetadata('[{"Name":"Alex","Address":"alex@example.com"}]')).toEqual([
      { Name: "Alex", Address: "alex@example.com" }
    ]);
    expect(flattenPostalAddresses([{ name: "Team", group: [{ name: "Sam", address: "sam@example.com" }] }])).toEqual([
      { Name: "Sam", Address: "sam@example.com" }
    ]);
  });

  test("derives stable tags from plus addressing", () => {
    expect(tagsFromRecipient("storefront+preview+receipt@preview-mail.example.com")).toEqual([
      "storefront",
      "preview",
      "receipt"
    ]);
    expect(normalizedTags(["Preview", "preview", "  Paid  "])).toEqual(["Paid", "preview"]);
  });
});
