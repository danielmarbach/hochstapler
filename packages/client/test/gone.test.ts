import { describe, expect, it } from "vitest";
import { WS_CLOSE_GAME_EXPIRED } from "@poly/engine";
import { isGameGoneClose, isGameNotFoundMessage } from "../src/net/gone.ts";
import { UI_MESSAGES } from "../src/i18n/index.ts";

describe("game expired or unknown (docs/DESIGN.md #57)", () => {
  it("recognises the close code the server sends when the retention sweep deletes a game", () => {
    expect(isGameGoneClose(WS_CLOSE_GAME_EXPIRED)).toBe(true);
    expect(isGameGoneClose(1000)).toBe(false);
    expect(isGameGoneClose(1012)).toBe(false);
    expect(isGameGoneClose(4001)).toBe(false);
  });

  it("recognises the server's German 'game not found' text (hello and REST) and nothing else", () => {
    expect(isGameNotFoundMessage(UI_MESSAGES.de["srv.gameNotFound"])).toBe(true);
    expect(isGameNotFoundMessage("Sitz nicht gefunden.")).toBe(false);
  });

  it("has the friendly message in all three languages", () => {
    expect(UI_MESSAGES.de["gone.lead"]).toBe("Dieses Spiel ist abgelaufen oder existiert nicht.");
    expect(UI_MESSAGES.en["gone.lead"]).toBe("This game has expired or does not exist.");
    expect(UI_MESSAGES.gsw["gone.lead"]).toMatch(/\S/);
    expect(UI_MESSAGES.gsw["gone.lead"]).not.toBe(UI_MESSAGES.de["gone.lead"]);
  });
});
