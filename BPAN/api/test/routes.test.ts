import { describe, it, expect } from "vitest";

describe("API Route Validation", () => {
  const MIN_NUMBER = 10_000_000_000n;
  const MAX_NUMBER = 99_999_999_999n;

  function parseNumber(raw: string): bigint | null {
    try {
      const num = BigInt(raw);
      if (num < MIN_NUMBER || num > MAX_NUMBER) return null;
      return num;
    } catch {
      return null;
    }
  }

  describe("parseNumber", () => {
    it("should accept a valid 11-digit number", () => {
      expect(parseNumber("48290173462")).toBe(48_290_173_462n);
    });

    it("should accept the smallest valid number", () => {
      expect(parseNumber("10000000000")).toBe(10_000_000_000n);
    });

    it("should accept the largest valid number", () => {
      expect(parseNumber("99999999999")).toBe(99_999_999_999n);
    });

    it("should reject a 10-digit number", () => {
      expect(parseNumber("9999999999")).toBeNull();
    });

    it("should reject a 12-digit number", () => {
      expect(parseNumber("100000000000")).toBeNull();
    });

    it("should reject non-numeric input", () => {
      expect(parseNumber("abc")).toBeNull();
    });

    it("should reject zero", () => {
      expect(parseNumber("0")).toBeNull();
    });

    it("should reject negative numbers", () => {
      expect(parseNumber("-48290173462")).toBeNull();
    });
  });
});
