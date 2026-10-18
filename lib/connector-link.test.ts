import { describe, expect, it } from "vitest";
import { connectorHost, installBadgeMarkdown, installUrl } from "./connector-link";

describe("install links", () => {
  it("names the admin_extension target on the connector, never a server", () => {
    expect(installUrl("quick-reply")).toBe("https://connector.bulwarkmail.org/admin_extension?slug=quick-reply");
  });

  it("carries the version when one is asked for", () => {
    expect(installUrl("quick-reply", "1.2.0")).toBe(
      "https://connector.bulwarkmail.org/admin_extension?slug=quick-reply&version=1.2.0",
    );
    expect(installUrl("quick-reply", "2.0.0-beta.1")).toContain("version=2.0.0-beta.1");
    expect(installUrl("quick-reply", null)).not.toContain("version");
  });

  it("encodes what it is given", () => {
    expect(installUrl("a b", "1.0.0+x")).toBe(
      "https://connector.bulwarkmail.org/admin_extension?slug=a+b&version=1.0.0%2Bx",
    );
  });

  it("builds a badge that works in light and dark READMEs", () => {
    const md = installBadgeMarkdown("quick-reply");
    expect(md).toContain('href="https://connector.bulwarkmail.org/admin_extension?slug=quick-reply"');
    expect(md).toContain("/badges/admin_extension.svg");
    expect(md).toContain("/badges/admin_extension-dark.svg");
    expect(md).toContain('alt="Install in Bulwark"');
  });

  it("knows the connector's host for the explanatory line", () => {
    expect(connectorHost()).toBe("connector.bulwarkmail.org");
  });
});
