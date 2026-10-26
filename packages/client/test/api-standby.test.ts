// A server instance without the database (writer-lease standby / handover) answers 503 with `standby: true`: nothing
// was applied, so the client repeats the request after a short, jittered pause instead of showing an error.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/net/api.ts";

const reply = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("api: standby retries", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("repeats a request answered 503 standby until an instance serves it", async () => {
    const standby = () =>
      reply(
        503,
        { error: "Der Server wechselt gerade – bitte gleich nochmal.", standby: true },
        {
          "retry-after": "2",
        },
      );
    fetchMock
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(standby())
      .mockResolvedValueOnce(reply(200, { gameId: "g1" }));
    const p = api.getLobby("g1");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toEqual({ gameId: "g1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry other 503s (server full) and gives up on standby after about half a minute", async () => {
    fetchMock.mockResolvedValue(
      reply(503, { error: "Der Server ist gerade voll. Bitte später erneut." }),
    );
    await expect(api.getLobby("g1")).rejects.toThrow(/voll/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        reply(503, { error: "Der Server wechselt gerade – bitte gleich nochmal.", standby: true }),
      ),
    );
    const p = api.getLobby("g1");
    const outcome = p.then(
      () => "ok",
      (e: unknown) => (e instanceof Error ? e.message : "error"),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toMatch(/wechselt/);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
    expect(fetchMock.mock.calls.length).toBeLessThan(60);
  });
});
