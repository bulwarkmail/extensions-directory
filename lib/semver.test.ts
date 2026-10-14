import { describe, expect, it } from "vitest";
import { appVersionFits, compare, isPrerelease, isValidRange, max, satisfies } from "./semver";

describe("compare", () => {
  it("orders by semver precedence", () => {
    const sorted = ["1.10.0", "1.0.0-alpha", "1.2.0", "1.0.0", "1.0.0-alpha.1", "1.0.0-beta.11", "1.0.0-beta.2", "1.0.0-rc.1", "1.0.0-beta", "1.9.0"]
      .sort(compare);
    expect(sorted).toEqual(["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.2.0", "1.9.0", "1.10.0"]);
  });
  it("ignores build metadata", () => {
    expect(compare("1.0.0+abc", "1.0.0")).toBe(0);
  });
  it("finds the highest, not the newest", () => {
    expect(max(["1.9.0", "1.10.0", "1.2.0"])).toBe("1.10.0");
  });
  it("knows pre-releases", () => {
    expect(isPrerelease("1.11.0-beta.1")).toBe(true);
    expect(isPrerelease("1.11.0")).toBe(false);
  });
});

describe("satisfies", () => {
  it.each([
    ["1.1.0", ">=1.0.0 <1.2.3", true],
    ["1.2.3", ">=1.0.0 <1.2.3", false],
    ["2.0.0", ">=1.0.0 <1.2.3 || 2.0.0", true],
    ["1.0.0-beta.1", "<1.0.0", true],
    ["5.0.0", "*", true],
    ["1.0.0", "<=1.0.0", true],
  ])("%s in %s is %s", (v, r, want) => {
    expect(satisfies(v, r)).toBe(want);
  });
  it("rejects nonsense ranges", () => {
    expect(isValidRange("<= banana")).toBe(false);
    expect(isValidRange("")).toBe(false);
    expect(satisfies("1.0.0", "~1.0")).toBe(false);
  });
});

describe("appVersionFits", () => {
  it("checks both bounds", () => {
    expect(appVersionFits("1.8.0", "1.9.0", null)).toBe(false);
    expect(appVersionFits("1.9.0", "1.9.0", null)).toBe(true);
    expect(appVersionFits("2.1.0", null, "2.0.0")).toBe(false);
    expect(appVersionFits(null, "9.0.0", null)).toBe(true);
  });
});
