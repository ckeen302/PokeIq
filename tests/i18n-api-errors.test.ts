import { describe, expect, it } from "vitest";
import en from "@/messages/en/api-errors.json";
import es from "@/messages/es/api-errors.json";
import PATTERNS from "@/i18n/api-error-patterns.json";
import { errorSlug, translateApiError } from "@/components/i18n/ApiErrors";

const raw = en as Record<string, unknown>;

describe("API errors in another language", () => {
  it("finds every plain message by the slug of the text the server sends", async () => {
    // vitest compiles messages to arrays: read the English source text from the JSON file itself.
    const source = JSON.parse((await import("node:fs")).readFileSync("src/messages/en/api-errors.json", "utf8")) as Record<string, string>;
    for (const [key, text] of Object.entries(source)) {
      if (/\{a\d+\}/.test(text)) continue;
      expect(errorSlug(text.replace(/''/g, "'")), text).toBe(key);
    }
    expect(Object.keys(raw).length).toBe(Object.keys(es).length);
  });

  it("translates plain and patterned messages, and leaves unknown ones as sent", async () => {
    expect(await translateApiError("Slow down, trainer.", "es")).not.toBe("Slow down, trainer.");
    const patterned = PATTERNS.find(([k]) => k === "keep-it-under-x-characters");
    expect(patterned).toBeTruthy();
    const out = await translateApiError("Keep it under 280 characters.", "es");
    expect(out).toContain("280");
    expect(out).not.toBe("Keep it under 280 characters.");
    expect(await translateApiError("Something nobody wrote.", "es")).toBe("Something nobody wrote.");
  });
});
