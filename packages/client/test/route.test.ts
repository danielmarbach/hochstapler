import { describe, expect, it } from "vitest";
import { gameHash, parseRoute, resumeLink } from "../src/net/route.ts";

const TOKEN = "Zq3_vN-8aLk2Wd9XyTb7HfPm"; // gitleaks:allow (made-up test token)

describe("parseRoute", () => {
  it("knows the existing routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
    expect(parseRoute("#/join/abc123/CODE42")).toEqual({
      name: "join",
      gameId: "abc123",
      code: "CODE42",
    });
    expect(parseRoute("#/game/abc123")).toEqual({ name: "game", gameId: "abc123" });
    expect(parseRoute("#/unknown/thing")).toEqual({ name: "home" });
  });

  it("parses a resume link into game id and token", () => {
    expect(parseRoute(`#/resume/abc123/${TOKEN}`)).toEqual({
      name: "resume",
      gameId: "abc123",
      token: TOKEN,
    });
    expect(parseRoute(`#resume/abc123/${TOKEN}`)).toEqual({
      name: "resume",
      gameId: "abc123",
      token: TOKEN,
    });
  });

  it.each([
    ["no token", "#/resume/abc123"],
    ["no game", "#/resume"],
    ["empty token", "#/resume/abc123/"],
    ["token with illegal characters", "#/resume/abc123/to%20ken"],
    ["token that is too short", "#/resume/abc123/abc"],
    ["token that is too long", `#/resume/abc123/${"a".repeat(129)}`],
    ["game id with illegal characters", `#/resume/ab.c/${TOKEN}`],
    ["extra path segments", `#/resume/abc123/${TOKEN}/more`],
  ])("flags a malformed resume link (%s)", (_name, hash) => {
    expect(parseRoute(hash)).toEqual({ name: "bad-resume" });
  });
});

describe("resume link language", () => {
  it.each(["de", "en", "gsw", "fr", "it"] as const)(
    "reads the language %s from the fragment",
    (lang) => {
      expect(parseRoute(`#/resume/abc123/${TOKEN}?lang=${lang}`)).toEqual({
        name: "resume",
        gameId: "abc123",
        token: TOKEN,
        lang,
      });
    },
  );

  it("keeps old links without a language working", () => {
    const route = parseRoute(`#/resume/abc123/${TOKEN}`);
    expect(route).toEqual({ name: "resume", gameId: "abc123", token: TOKEN });
    expect("lang" in route).toBe(false);
  });

  it.each([
    ["an unsupported language", `#/resume/abc123/${TOKEN}?lang=klingon`],
    ["an empty language", `#/resume/abc123/${TOKEN}?lang=`],
    ["a repeated language", `#/resume/abc123/${TOKEN}?lang=en&lang=gsw`],
    ["an unknown parameter only", `#/resume/abc123/${TOKEN}?x=1`],
    ["a script in the language", `#/resume/abc123/${TOKEN}?lang=<script>`],
  ])("still resumes the seat but ignores %s", (_name, hash) => {
    const route = parseRoute(hash);
    expect(route).toEqual({ name: "resume", gameId: "abc123", token: TOKEN });
  });

  it("does not mistake a query after a broken token for a valid link", () => {
    expect(parseRoute("#/resume/abc123/abc?lang=en")).toEqual({ name: "bad-resume" });
  });
});

describe("resumeLink / gameHash", () => {
  it("adds the language inside the fragment, never to the path or the query", () => {
    const link = resumeLink(
      { origin: "https://poly.example", pathname: "/play/" },
      "g1",
      TOKEN,
      "gsw",
    );
    expect(link).toBe(`https://poly.example/play/#/resume/g1/${TOKEN}?lang=gsw`);
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/play/");
    expect(parseRoute(url.hash)).toEqual({
      name: "resume",
      gameId: "g1",
      token: TOKEN,
      lang: "gsw",
    });
  });

  it("builds the old link when no language is given", () => {
    expect(resumeLink({ origin: "https://p.example", pathname: "/" }, "g1", TOKEN)).toBe(
      `https://p.example/#/resume/g1/${TOKEN}`,
    );
  });

  it("builds a link that parses back to the same seat", () => {
    const link = resumeLink({ origin: "http://192.168.1.5:8787", pathname: "/" }, "abc123", TOKEN);
    expect(link).toBe(`http://192.168.1.5:8787/#/resume/abc123/${TOKEN}`);
    const hash = link.slice(link.indexOf("#"));
    expect(parseRoute(hash)).toEqual({ name: "resume", gameId: "abc123", token: TOKEN });
  });

  it("keeps the token out of the path and the query (only the fragment is never sent)", () => {
    const link = resumeLink({ origin: "https://poly.example", pathname: "/play/" }, "g1", TOKEN);
    const url = new URL(link);
    expect(url.pathname).toBe("/play/");
    expect(url.search).toBe("");
    expect(url.hash).toContain(TOKEN);
  });

  it("the clean game hash carries no token", () => {
    expect(gameHash("abc123")).toBe("#/game/abc123");
  });
});
