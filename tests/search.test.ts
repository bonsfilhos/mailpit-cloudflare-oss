import { describe, expect, test } from "vitest";
import { compileSearch, tokenizeSearch } from "../src/worker/search";

describe("Mailpit Cloudflare search", () => {
  test("keeps quoted field values together", () => {
    expect(tokenizeSearch('from:sender subject:"Order receipt" -tag:archived')).toEqual([
      { value: "from:sender", negated: false },
      { value: "subject:Order receipt", negated: false },
      { value: "tag:archived", negated: true }
    ]);
  });

  test("compiles address, tag, state, attachment, size and date filters with bindings", () => {
    const result = compileSearch(
      "to:storefront tag:preview is:unread has:attachment larger:10kb after:2026-08-01"
    );
    expect(result.sql).toContain("m.to_search LIKE ?");
    expect(result.sql).toContain("message_tags");
    expect(result.sql).toContain("m.is_read = 0");
    expect(result.sql).toContain("m.attachment_count > 0");
    expect(result.sql).toContain("m.size > ?");
    expect(result.sql).toContain("m.created_at > ?");
    expect(result.params).toContain(10_000);
    expect(result.params).toContain("2026-08-01T00:00:00.000Z");
  });

  test("escapes SQL wildcard characters", () => {
    expect(compileSearch("subject:100%_ok").params).toEqual(["%100\\%\\_ok%"]);
  });
});
