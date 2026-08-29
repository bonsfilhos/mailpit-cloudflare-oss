import { describe, expect, test, vi } from "vitest";
import { broadcastEvent } from "../src/worker/event-hub";

describe("event hub", () => {
  test("uses the configured Durable Object location for broadcasts", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const getByName = vi.fn().mockReturnValue({ fetch });
    const namespace = { getByName } as unknown as DurableObjectNamespace;

    await broadcastEvent(namespace, { Type: "stats" }, "weur");

    expect(getByName).toHaveBeenCalledWith("global", { locationHint: "weur" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
