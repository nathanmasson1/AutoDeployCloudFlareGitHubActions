import { describe, expect, it } from "vitest";
import {
  guessZoneName,
  isValidDomain,
  namesForSite,
  normalizeDomain,
  parseGithubTemplateUrl,
  slugify,
} from "../src/shared/utils";

describe("shared utils", () => {
  it("slugifies Portuguese site names", () => {
    expect(slugify("Clínica São João!")).toBe("clinica-sao-joao");
  });

  it("normalizes domains from pasted urls", () => {
    expect(normalizeDomain("https://www.Exemplo.com/path?a=1")).toBe("www.exemplo.com");
  });

  it("validates hostnames", () => {
    expect(isValidDomain("exemplo.com")).toBe(true);
    expect(isValidDomain("localhost")).toBe(false);
    expect(isValidDomain("*.exemplo.com")).toBe(false);
  });

  it("parses github template urls with branch and subdir", () => {
    expect(parseGithubTemplateUrl("https://github.com/nathanmasson1/templates/tree/main/blog")).toMatchObject({
      owner: "nathanmasson1",
      repo: "templates",
      branch: "main",
      subdir: "blog",
    });
  });

  it("generates Cloudflare-safe resource names", () => {
    expect(namesForSite("Meu Portal de Notícias")).toMatchObject({
      slug: "meu-portal-de-noticias",
      workerName: "meu-portal-de-noticias",
      d1Name: "meu-portal-de-noticias-db",
      r2BucketName: "meu-portal-de-noticias-media",
      kvName: "meu-portal-de-noticias-session",
    });
  });

  it("guesses Brazilian second-level zones", () => {
    expect(guessZoneName("blog.exemplo.com.br")).toBe("exemplo.com.br");
  });
});
