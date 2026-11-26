import { describe, expect, it } from "vitest";
import { aOrAn } from "@/engines/shared";

describe("English questions put the right article before a type", () => {
  it("an before a vowel, a before a consonant", () => {
    expect(`${aOrAn("ice")} Ice-type move`).toBe("an Ice-type move");
    expect(`${aOrAn("Electric")} Electric-type move`).toBe("an Electric-type move");
    expect(`${aOrAn("fire")} Fire-type move`).toBe("a Fire-type move");
    expect(`${aOrAn("Normal")} Normal-type crew`).toBe("a Normal-type crew");
  });
});
