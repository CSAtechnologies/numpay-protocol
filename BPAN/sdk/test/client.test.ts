import { describe, it, expect } from "vitest";
import { BANPClient, MIN_BANP_NUMBER, MAX_BANP_NUMBER } from "../src";

describe("BANPClient", () => {
  describe("isValidNumber", () => {
    it("should accept the smallest valid 11-digit number", () => {
      expect(BANPClient.isValidNumber(10_000_000_000n)).toBe(true);
    });

    it("should accept the largest valid 11-digit number", () => {
      expect(BANPClient.isValidNumber(99_999_999_999n)).toBe(true);
    });

    it("should accept a number in the middle of the range", () => {
      expect(BANPClient.isValidNumber(48_290_173_462n)).toBe(true);
    });

    it("should reject zero", () => {
      expect(BANPClient.isValidNumber(0n)).toBe(false);
    });

    it("should reject a 10-digit number", () => {
      expect(BANPClient.isValidNumber(9_999_999_999n)).toBe(false);
    });

    it("should reject a 12-digit number", () => {
      expect(BANPClient.isValidNumber(100_000_000_000n)).toBe(false);
    });
  });

  describe("constructor", () => {
    it("should throw if neither provider nor rpcUrl is given", () => {
      expect(
        () => new BANPClient({ contractAddress: "0x1234567890abcdef1234567890abcdef12345678" })
      ).toThrow("Either provider or rpcUrl must be provided");
    });
  });

  describe("constants", () => {
    it("should export correct MIN_BANP_NUMBER", () => {
      expect(MIN_BANP_NUMBER).toBe(10_000_000_000n);
    });

    it("should export correct MAX_BANP_NUMBER", () => {
      expect(MAX_BANP_NUMBER).toBe(99_999_999_999n);
    });
  });
});
