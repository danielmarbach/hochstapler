import { describe, expect, it } from "vitest";
import { MAX_CHAT_LENGTH } from "@poly/engine";
import { checkChatText } from "../src/chat/filter.ts";

const reason = (text: string): string => {
  const r = checkChatText(text);
  return r.ok ? "ok" : r.reason;
};

describe("checkChatText: harmless text passes", () => {
  it.each([
    "Gut gespielt!",
    "Ich biete 1500 für den Bahnhof",
    "Willst du die Bahnhofstrasse tauschen? Ich gebe 200 dazu.",
    "Das war knapp. Danke dir, bis später",
    "Würfel nochmal, bitte :)",
    "Uhr 18:30 geht's weiter?",
    "Ich hab 3 Häuser und 2 Hotels",
    "Marschall und Harsch sind keine Schimpfwörter",
    "Hoi zäme, wer isch dra?",
    "1.500.000 sind viel",
    "Bien joué, merci !",
    "Je te propose 1500 pour la gare de Lyon",
    "Salut tout le monde, c'est à qui ?",
    "Véronique et Monique jouent aussi",
    "Ben giocato, grazie mille!",
    "Ti offro 1500 per la stazione",
    "Ciao a tutti, tocca a te?",
    "Mamma mia, che fortuna!",
  ])("%s", (text) => {
    expect(reason(text)).toBe("ok");
  });

  it("returns the cleaned text (spaces collapsed, NFC)", () => {
    expect(checkChatText("  Hallo   Welt \n ")).toEqual({ ok: true, text: "Hallo Welt" });
    expect(checkChatText("Café")).toEqual({ ok: true, text: "Café" });
  });

  it("keeps emoji", () => {
    expect(checkChatText("Super 🎉👍")).toEqual({ ok: true, text: "Super 🎉👍" });
  });
});

describe("checkChatText: links", () => {
  it.each([
    "https://example.com",
    "http://example.com/path?x=1",
    "schau mal example.ch",
    "www.example.org",
    "Example.Com",
    "geh auf bit.ly/abc",
    "discord.gg/abc",
    "kasino.xyz",
    "ftp://1.2.3.4/file",
    "meine IP 192.168.0.1",
    "http://[2001:db8::1]/",
    "2001:db8::1",
    "ｅｘａｍｐｌｅ．ｃｏｍ",
    "example[.]com",
    "example(.)com",
    "example dot com",
    "example (dot) ch",
    "example punkt ch",
    "exa​mple.com",
    "hxxp://example.com",
    "example . com",
  ])("blocks %s", (text) => {
    expect(reason(text)).toBe("link");
  });
});

describe("checkChatText: contact data", () => {
  it.each([
    "mail an max@example.com",
    "max(at)example(dot)com",
    "max [at] example [dot] com",
    "max at example dot com",
    "ruf mich an 079 123 45 67",
    "+41 79 123 45 67",
    "0791234567",
    "(030) 1234 5678",
    "null sieben neun eins zwei drei vier fünf sechs sieben",
    "zero seven nine one two three four five six",
    "zéro sept neuf un deux trois quatre cinq six sept",
    "zero sette nove uno due tre quattro cinque sei sette",
    "écris-moi sur WhatsApp",
    "scrivimi su Telegram",
    "appelle-moi au 06 12 34 56 78",
    "chiamami al 333 123 4567",
    "schreib mir auf whatsapp",
    "my Telegram is cool",
    "w h a t s a p p",
    "Instagram?",
    "add me @max_muster",
  ])("blocks %s", (text) => {
    expect(reason(text)).toBe("contact");
  });
});

describe("checkChatText: family filter", () => {
  it.each([
    "Scheisse",
    "so ein Scheiß",
    "Sch3!ss3",
    "du Arschloch",
    "S c h e i s s e",
    "A.r.s.c.h.l.o.c.h",
    "was für ein Hurensohn",
    "Fotze",
    "huere Siech",
    "Wixer",
    "you piece of shit",
    "f u c k",
    "fuuuuck",
    "putain",
    "quel connard",
    "espèce de salope",
    "enculé",
    "p u t a i n",
    "Cazzo",
    "vaffanculo",
    "che stronzo",
    "sei una puttana",
    "S T R O N Z O",
  ])("blocks %s", (text) => {
    expect(reason(text)).toBe("language");
  });

  it("does not block names or words that merely contain a bad word (Scunthorpe)", () => {
    for (const ok of [
      "Assistent",
      "Klassik",
      "Marschall",
      "Fickle",
      "Hello Class",
      "Schlossberg",
      "Assiette",
      "Computer",
      "Cassetta",
      "Particolare",
    ]) {
      expect(reason(ok), ok).toBe("ok");
    }
  });
});

describe("checkChatText: unicode abuse and limits", () => {
  it("rejects direction overrides and tag characters", () => {
    expect(reason("abc‮def")).toBe("invalid");
    expect(reason("abc⁦def⁩")).toBe("invalid");
    expect(reason("abc‏def")).toBe("invalid");
    expect(reason(`abc${String.fromCodePoint(0xe0041)}`)).toBe("invalid");
  });

  it("rejects lone surrogates and zalgo", () => {
    expect(reason("abc\ud800def")).toBe("invalid");
    expect(reason(`a${"́".repeat(6)}`)).toBe("invalid");
  });

  it("strips control and zero-width characters instead of delivering them", () => {
    expect(checkChatText("a\u0000b\u0007c​­d﻿e")).toEqual({ ok: true, text: "a b cde" });
  });

  it("rejects empty and whitespace-only text", () => {
    expect(reason("")).toBe("invalid");
    expect(reason(" ​ \n")).toBe("invalid");
  });

  it("rejects text over the limit by code points, not UTF-16 units", () => {
    expect(reason("a".repeat(MAX_CHAT_LENGTH))).toBe("ok");
    expect(reason("a".repeat(MAX_CHAT_LENGTH + 1))).toBe("length");
    expect(reason("🎉".repeat(MAX_CHAT_LENGTH))).toBe("ok");
    expect(reason("🎉".repeat(MAX_CHAT_LENGTH + 1))).toBe("length");
  });

  it("is not defeated by huge input (bounded work)", () => {
    const start = performance.now();
    reason("a ".repeat(100_000));
    reason(".".repeat(100_000));
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
