import { describe, expect, it } from "vitest";
import { debtAfterSale, debtCreditorName, debtShortfall, noBreak } from "../src/ui/debt.ts";

describe("debt arithmetic (T10)", () => {
  it("the shortfall is what the cash does not cover", () => {
    expect(debtShortfall(400, 20)).toBe(380);
    expect(debtShortfall(400, 400)).toBe(0);
    expect(debtShortfall(400, 900)).toBe(0);
  });

  it("a sale reduces the shortfall by its proceeds and never goes below zero", () => {
    expect(debtAfterSale(900, 20, 560)).toBe(320);
    expect(debtAfterSale(400, 20, 560)).toBe(0);
    expect(debtAfterSale(400, 20, 380)).toBe(0);
  });
});

describe("debt notice creditor", () => {
  const players = [
    { id: "p1", name: "Anna" },
    { id: "p2", name: "Ben" },
  ];

  it("names the player the debt is owed to", () => {
    expect(debtCreditorName("p2", players)).toBe("Ben");
  });

  it("is null for the bank", () => {
    expect(debtCreditorName(null, players)).toBeNull();
  });

  it("falls back to the bank for a creditor that is not at the table", () => {
    expect(debtCreditorName("p9", players)).toBeNull();
  });
});

describe("debt notice line breaks", () => {
  it("glues a money amount together with no-break spaces", () => {
    expect(noBreak("CHF 1'250")).toBe("CHF\u00a01'250");
    expect(noBreak("1\u00a0250 €")).toBe("1\u00a0250\u00a0€");
  });

  it("leaves text without spaces alone", () => {
    expect(noBreak("-CHF")).toBe("-CHF");
  });
});
