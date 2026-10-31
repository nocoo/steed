import { describe, expect, it } from "vitest";
import {
  findSecretLike,
  isFingerprintFormat,
  isIdentifierFormat,
  isPublicKeyFormat,
  matchesAllowlistedAttrType,
} from "./secret-scan";

const runtime = (...parts: string[]) => parts.join("");

function encodeEveryChar(value: string): string {
  return Array.from(value, (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join("").toUpperCase();
}

function sshString(value: string): string {
  return String.fromCharCode(
    value.length >>> 24,
    value.length >>> 16,
    value.length >>> 8,
    value.length,
  ) + value;
}

function mpintFixture(bytes: readonly number[]): string {
  return sshString(String.fromCharCode(...bytes));
}

function sshFixture(): string {
  const algorithm = "ssh-ed25519";
  const blob = sshString(algorithm) + sshString(String.fromCharCode(...new Array(32).fill(0)));
  return runtime(`${algorithm} `, btoa(blob), " fixture");
}

function sshRsaFixture(exponent = 65537, modulusBytes = [1, 1]): string {
  const exponentBytes = exponent === 65537 ? [1, 0, 1] : [0];
  const blob = sshString("ssh-rsa") + mpintFixture(exponentBytes) + mpintFixture(modulusBytes);
  return runtime("ssh-rsa ", btoa(blob), " fixture");
}

function hexBytes(hex: string): string {
  const bytes = new Array<string>();
  for (let index = 0; index < hex.length; index += 2) bytes.push(String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16)));
  return bytes.join("");
}

function sshEcdsaFixture(curve: "nistp256" | "nistp384" | "nistp521", offCurve = false): string {
  const coordinates: Record<typeof curve, readonly [string, string]> = {
    nistp256: [
      "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
      "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    ],
    nistp384: [
      "AA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7",
      "3617DE4A96262C6F5D9E98BF9292DC29F8F41DBD289A147CE9DA3113B5F0B8C00A60B1CE1D7E819D7A431D7C90EA0E5F",
    ],
    nistp521: [
      "C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66",
      "11839296A789A3BC0045C8A5FB42C7D1BD998F54449579B446817AFBD17273E662C97EE72995EF42640C550B9013FAD0761353C7086A272C24088BE94769FD16650",
    ],
  };
  const xCoordinate = coordinates[curve][0];
  const yCoordinate = coordinates[curve][1];
  const coordinateLength = curve === "nistp256" ? 32 : curve === "nistp384" ? 48 : 66;
  const x = xCoordinate.padStart(coordinateLength * 2, "0");
  const y = yCoordinate.padStart(coordinateLength * 2, "0");
  const algorithm = runtime("ecdsa-sha2-", curve);
  const yBytes = offCurve ? runtime(y.slice(0, -2), y.endsWith("00") ? "01" : "00") : y;
  const point = runtime("04", x, yBytes);
  const blob = sshString(algorithm) + sshString(curve) + sshString(hexBytes(point));
  return runtime(`${algorithm} `, btoa(blob), " fixture");
}

function validAgeFixture(): string {
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const payload = Array.from({ length: 32 }, (_, index) => index);
  const payloadValues: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const byte of payload) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      payloadValues.push((accumulator >>> bitCount) & 31);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) payloadValues.push((accumulator << (5 - bitCount)) & 31);

  const hrp = "age";
  const hrpCodes = Array.from(hrp, (char) => char.charCodeAt(0));
  const hrpExpanded = [
    ...hrpCodes.map((code) => code >>> 5),
    0,
    ...hrpCodes.map((code) => code & 31),
  ];
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  const polymodStep = (value: number) => {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index++) {
      if ((top >>> index) & 1) checksum ^= generators[index]!;
    }
    checksum >>>= 0;
  };
  for (const value of hrpExpanded) polymodStep(value);
  for (const value of payloadValues) polymodStep(value);
  for (let index = 0; index < 6; index++) polymodStep(0);
  checksum ^= 1;
  const checksumValues = Array.from({ length: 6 }, (_, index) => (checksum >>> (5 * (5 - index))) & 31);
  return runtime(hrp, "1", [...payloadValues, ...checksumValues].map((value) => charset[value]).join(""));
}

function invalidAgeChecksumFixture(valid: string): string {
  const last = valid.at(-1)!;
  const replacement = last === "q" ? "p" : "q";
  return runtime(valid.slice(0, -1), replacement);
}

describe("secret-like value detector", () => {
  it("reports key names only in attr-key context without echoing the value", () => {
    const value = runtime("api", "_key");
    expect(findSecretLike(value, ["types", 0, "attrs_schema", value], { attrKey: true })).toEqual({
      path: ["types", 0, "attrs_schema"],
      code: "secret_like_value",
      rule: "key_name",
    });
    expect(findSecretLike("service token inventory", ["nodes", 0, "label"])).toBeNull();
    expect(findSecretLike("password", ["nodes", 0, "attrs", "displayName"])).toBeNull();
    expect(findSecretLike("password", ["attrs", "password"] , { attrKey: true })).toMatchObject({ rule: "key_name" });
    expect(JSON.stringify(findSecretLike("password", ["attrs", "password"], { attrKey: true }))).not.toContain("password");
  });

  it("detects private key blocks of every PEM type", () => {
    for (const kind of ["RSA", "EC", "OPENSSH", "ENCRYPTED"]) {
      const marker = runtime("-----BEGIN ", kind, " PRIVATE KEY-----");
      expect(findSecretLike(marker, ["description"])).toMatchObject({ rule: "private_key" });
    }
  });

  it("detects known credential prefixes assembled at runtime", () => {
    const prefixes = [
      runtime("steed", "c_"),
      runtime("gh", "p_"), runtime("github", "_pat_"), runtime("gh", "o_"),
      runtime("sk", "-"), runtime("sk", "_live_"), runtime("rk", "_live_"),
      runtime("x", "oxb-"), runtime("AK", "IA") + "A1B2C3D4E5F6G7H8", runtime("AI", "za") + "a".repeat(35),
      runtime("ya", "29."), runtime("gl", "pat-"), runtime("npm", "_") + "a".repeat(36), runtime("ts", "key-"),
    ];
    for (const prefix of prefixes) {
      expect(findSecretLike(prefix + runtime("fixture", "value"), ["label"])).toMatchObject({ rule: "known_prefix" });
    }
    const embedded = runtime("prefix", "gh", "p_", "fixture");
    const embeddedSk = runtime("prefix", "sk-", "fixture".repeat(8));
    expect(findSecretLike(embedded, ["label"])).toMatchObject({ rule: "known_prefix" });
    expect(findSecretLike(embedded, ["attrs", "identifier"], { declaredAttrType: "identifier" })).toMatchObject({ rule: "known_prefix" });
    expect(findSecretLike(embeddedSk, ["label"])).toMatchObject({ rule: "known_prefix" });
    expect(findSecretLike(embeddedSk, ["attrs", "identifier"], { declaredAttrType: "identifier" })).toMatchObject({ rule: "known_prefix" });
    for (const ordinary of ["task-runner", "disk-backed", "disk backed", "ghos-hostname", "skilled-worker"]) {
      expect(findSecretLike(ordinary, ["label"])).toBeNull();
    }
  });

  it("detects JWTs made from runtime parts and embedded JWTs", () => {
    const jwt = runtime("ey", "JhbGciOiJIUzI1NiJ9", ".", "payload", "fixture", ".", "signature");
    expect(findSecretLike(jwt, ["attrs", "example"])).toMatchObject({ rule: "jwt" });
    expect(findSecretLike(runtime("Bearer_", jwt), ["attrs", "identifier"], { declaredAttrType: "identifier" })).toMatchObject({ rule: "jwt" });
  });

  it("detects URL userinfo and sensitive query parameter names", () => {
    expect(findSecretLike(runtime("postgres", "://user:pass@database.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https", "://:fixture@database.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike("https://user@database.example/production", ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://api.example.test/items?", "to", "ken=fixture"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://api.example.test/items?sig", "nature=fixture"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://api.example.test/items?", "%74", "oken=fixture"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https", ":///user:", "fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://us", "er:\t", "fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("Earlier question? Then see ", "https://api.example.test/items?", "se", "cret=fixture"), ["description"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example/?q='", "fixture", "'&token=fixture"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example/?q=\"", "fixture", "\"&token=fixture"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example/?q=", "'fixture'", "&view=health"), ["url"])).toBeNull();
    expect(findSecretLike(runtime("https://host.example/?q=\"", "fixture", "\"&view=health"), ["url"])).toBeNull();
    expect(findSecretLike(runtime("https://user", "'name:fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://user", "`name:fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://user", "<name:fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://user", "\"name:fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https", ":/user:", "fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https", ":\\user:", "fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example", "\\user:", "fixture@host.example/production"), ["url"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike("https://api.example.test/items?limit=10", ["url"])).toBeNull();
  });

  it("scans percent-decoded URL components before entropy allowlisting", () => {
    const ghValue = runtime("gh", "p_fixture");
    const ghPrefix = encodeEveryChar(ghValue);
    const jwt = runtime("ey", "JhbGciOiJIUzI1NiJ9", ".", "payload", "fixture", ".", "signature");
    const encodedJwt = encodeEveryChar(jwt);
    const privateKey = runtime("-----BEGIN RSA ", "PRIVATE KEY-----");
    const encodedPrivateKey = encodeEveryChar(privateKey);

    expect(findSecretLike(runtime("https://host.example/?view=", ghPrefix), ["label"])).toMatchObject({ rule: "known_prefix" });
    expect(findSecretLike(runtime("https://host.example/?view=", encodedJwt), ["label"])).toMatchObject({ rule: "jwt" });
    expect(findSecretLike(runtime("https://host.example/?view=", encodedPrivateKey), ["label"])).toMatchObject({ rule: "private_key" });
    expect(findSecretLike(runtime("https://host.example/?view=%ZZ", ghPrefix), ["label"])).toMatchObject({ rule: "known_prefix" });
    expect(findSecretLike(runtime("https://host.example/?view=%ZZ", encodedPrivateKey), ["label"])).toMatchObject({ rule: "private_key" });

    const ordinaryUrl = runtime("https://host.example/?view=", encodeEveryChar("health-fixture"));
    const malformedBeforeJwt = runtime("%A", encodedJwt);
    expect(findSecretLike(malformedBeforeJwt, ["label"])).toMatchObject({ rule: "jwt" });

    let depthEncoded = "health-fixture";
    for (let index = 0; index < 4; index++) depthEncoded = encodeEveryChar(depthEncoded);
    expect(findSecretLike(runtime("https://host.example/?view=", depthEncoded), ["label"])).not.toBeNull();
    expect(findSecretLike(ordinaryUrl, ["label"])).toBeNull();
    expect(JSON.stringify(findSecretLike(runtime("https://host.example/?view=", ghPrefix), ["label"]))).not.toContain(ghValue);
  });

  it("recursively detects nested encoded URL credentials and preserves redacted paths", () => {
    const userUrl = runtime("https://user:", "fixture@host.example/health");
    const nestedTokenUrl = runtime("https://host.example/?", "token=fixture");
    const nestedUserEncoded = encodeEveryChar(userUrl);
    const nestedTokenEncoded = encodeEveryChar(nestedTokenUrl);
    const nestedJwt = runtime("ey", "JhbGciOiJIUzI1NiJ9", ".", "payload", "fixture", ".", "signature");
    const nestedJwtEncoded = encodeEveryChar(nestedJwt);

    expect(findSecretLike(runtime("https://host.example/?next=", nestedUserEncoded), ["label"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example/?next=", nestedTokenEncoded), ["label"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://host.example/?next=", nestedJwtEncoded), ["label"])).toMatchObject({ rule: "jwt" });
    expect(findSecretLike(runtime("https:user:", "fixture@host.example/health"), ["label"])).toMatchObject({ rule: "url_credentials" });
    expect(findSecretLike(runtime("https://user ", "name:fixture@host.example/health"), ["label"])).toMatchObject({ rule: "url_credentials" });

    const encodedGhValue = encodeEveryChar(runtime("gh", "p_fixture"));
    const decodedIssue = findSecretLike(runtime("https://host.example/?view=", encodedGhValue), ["nodes", 0, "ghp", encodedGhValue]);
    const decodedJson = JSON.stringify(decodedIssue);
    expect(decodedIssue?.rule).toBe("known_prefix");
    expect(decodedJson).not.toContain(encodedGhValue);
    expect(decodedJson).not.toContain(runtime("gh", "p_fixture"));

    const jwtIssue = findSecretLike(runtime("https://host.example/?view=", encodeEveryChar(nestedJwt)), runtime("label:", nestedJwt));
    expect(jwtIssue?.path).toBe("[redacted]");
    expect(JSON.stringify(jwtIssue)).not.toContain(nestedJwt);
  });

  it("detects high entropy runs, pure hex, and long base64", () => {
    const mixed = runtime("A7!", "mQ2@", "zX9#", "cV4$", "pL8&", "oR3%", "nK5+");
    expect(mixed.length).toBeGreaterThanOrEqual(24);
    expect(findSecretLike(mixed, ["attrs", "value"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike("A1!m".repeat(5), ["label"])).toBeNull();
    expect(findSecretLike("😀".repeat(12), ["label"])).toBeNull();
    expect(findSecretLike("你好".repeat(12), ["label"])).toBeNull();
    expect(findSecretLike(runtime("2001:db8::1%eth0-", "A7!mQ2@zX9#cV4$pL8&oR3%nK5+"), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike("a".repeat(40), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike("A".repeat(40), ["label"])).toMatchObject({ rule: "high_entropy" });
  });

  it("allows IPv4, IPv6, CIDR, UUID, short hex IDs, names, semver, dates, numbers, and URLs", () => {
    const allowed = [
      "192.0.2.10", "2001:db8::1", "::ffff:192.0.2.128", "::192.0.2.128",
      "0:0:0:0:0:ffff:192.0.2.128", "::ffff:192.0.2.128/96", "0:0:0:0:0:ffff:192.0.2.128/128",
      "192.0.2.0/24", "2001:db8::/48",
      runtime("00000000-0000-4000-8000-000000000000"), "a".repeat(32), "api.example.test",
      "v1.2.3-beta.1+build.5", "2026-10-31", "2026-10-31T12:30:00Z", "-12.5e3",
      runtime("https://", "api.example.test/health"),
    ];
    for (const value of allowed) expect(findSecretLike(value, ["label"]), value).toBeNull();
    for (const invalid of [
      "::ffff:192.0.2.999", "2001:db8:192.0.2.1::1", "192.0.2.1::",
      "::ffff:192.0.2.128/129", "0:0:0:0:0:192.0.2.128",
    ]) {
      expect(findSecretLike(invalid, ["label"]), invalid).not.toMatchObject({ rule: "high_entropy" });
    }
  });

  it("accepts strict public-key formats", () => {
    const ssh = sshFixture();
    const age = validAgeFixture();
    const invalidAge = invalidAgeChecksumFixture(age);
    const publicAgeExample = "age1xmvpnpye2lghmt9tcptjquh6nxpy6dhjr848fxy5v3dkvtjn5y3s8dkszj";
    const wireGuard = "A".repeat(43) + "=";
    expect(isPublicKeyFormat(ssh)).toBe(true);
    expect(isPublicKeyFormat(age)).toBe(true);
    expect(isPublicKeyFormat(publicAgeExample)).toBe(true);
    expect(isPublicKeyFormat(invalidAge)).toBe(false);
    expect(isPublicKeyFormat(wireGuard)).toBe(true);
    expect(isPublicKeyFormat("ssh-rsa not-base64")).toBe(false);
    expect(isPublicKeyFormat(runtime("ssh-ed25519 ", "A==="))).toBe(false);
    expect(isPublicKeyFormat(runtime("age1", "a".repeat(20)))).toBe(false);
    expect(isPublicKeyFormat(runtime("age1", "b".repeat(58)))).toBe(false);
    expect(isPublicKeyFormat("A".repeat(43))).toBe(false);
  });

  it("accepts only structurally valid OpenSSH public keys", () => {
    const rsa = sshRsaFixture();
    expect(isPublicKeyFormat(rsa)).toBe(true);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp256"))).toBe(true);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp384"))).toBe(true);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp521"))).toBe(true);

    expect(isPublicKeyFormat(runtime(rsa, "\nsecond-line"))).toBe(false);
    expect(isPublicKeyFormat(runtime(rsa.slice(0, rsa.indexOf(" fixture")), " fixture\r\nsecond"))).toBe(false);
    expect(isPublicKeyFormat(sshRsaFixture(1))).toBe(false);
    expect(isPublicKeyFormat("ssh-rsa " + btoa(sshString("ssh-rsa") + mpintFixture([0]) + mpintFixture([1, 1])))).toBe(false);
    expect(isPublicKeyFormat("ssh-rsa " + btoa(sshString("ssh-rsa") + mpintFixture([128]) + mpintFixture([1, 1])))).toBe(false);
    expect(isPublicKeyFormat("ssh-rsa " + btoa(sshString("ssh-rsa") + mpintFixture([1, 0, 1]) + mpintFixture([0])))).toBe(false);
    expect(isPublicKeyFormat("ssh-rsa " + btoa(sshString("ssh-rsa") + mpintFixture([1, 0, 1]) + mpintFixture([128])))).toBe(false);
    expect(isPublicKeyFormat("ssh-rsa " + btoa(sshString("ssh-rsa") + mpintFixture([1, 0, 1]) + mpintFixture([1, 0])))).toBe(false);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp256", true))).toBe(false);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp384", true))).toBe(false);
    expect(isPublicKeyFormat(sshEcdsaFixture("nistp521", true))).toBe(false);
  });

  it("detects fingerprints embedded in text or separated by whitespace", () => {
    const sha = runtime("SHA256:", "A".repeat(43));
    const md5 = runtime("MD5:", Array.from({ length: 16 }, () => "aa").join(":"));
    const hex = "a".repeat(40);

    expect(findSecretLike(runtime("prefix", sha, "suffix"), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("prefix ", "SHA256:", " ", "A".repeat(43), " suffix"), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("prefix ", md5, " suffix"), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("prefix", " ", hex.slice(0, 20), " ", hex.slice(20), " suffix"), ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("prefix ", sha, " suffix"), ["attrs", "fingerprint"], { declaredAttrType: "fingerprint" })).toMatchObject({ rule: "high_entropy" });

    expect(findSecretLike(runtime("SHA256:", "not-base64!"), ["label"])).toBeNull();
    expect(findSecretLike(runtime("MD5:", "gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg:gg"), ["label"])).toBeNull();
    expect(findSecretLike("a".repeat(39), ["label"])).toBeNull();
  });

  it("accepts strict fingerprint formats", () => {
    expect(isFingerprintFormat(runtime("SHA256:", "A".repeat(43)))).toBe(true);
    expect(isFingerprintFormat(runtime("MD5:", Array.from({ length: 16 }, () => "aa").join(":")))).toBe(true);
    expect(isFingerprintFormat("a".repeat(40))).toBe(true);
    expect(isFingerprintFormat("A".repeat(64))).toBe(true);
    expect(isFingerprintFormat("SHA256:not-base64!")).toBe(false);
    expect(isFingerprintFormat(runtime("SHA256:", "A".repeat(42)))).toBe(false);
    expect(isFingerprintFormat(runtime("MD5:", "aa:".repeat(15), "aa:"))).toBe(false);
  });

  it("accepts strict identifier format", () => {
    expect(isIdentifierFormat(runtime("arn:", "aws:service:region:account:resource"))).toBe(true);
    expect(isIdentifierFormat("a".repeat(40))).toBe(true);
    expect(isIdentifierFormat("../relative")).toBe(false);
    expect(isIdentifierFormat("bad value")).toBe(false);
  });

  it("exempts high entropy only for declared and matching allowlisted attr types", () => {
    const ssh = sshFixture();
    const fingerprint = runtime("SHA256:", "A".repeat(43));
    const identifier = runtime("gitsha:", "a".repeat(40));

    expect(findSecretLike(ssh, ["nodes", 0, "attrs", "key"], { declaredAttrType: "public_key" })).toBeNull();
    expect(findSecretLike(fingerprint, ["nodes", 0, "attrs", "fingerprint"], { declaredAttrType: "fingerprint" })).toBeNull();
    expect(findSecretLike(identifier, ["nodes", 0, "attrs", "identifier"], { declaredAttrType: "identifier" })).toBeNull();
    expect(matchesAllowlistedAttrType("identifier", identifier)).toBe(true);

    expect(findSecretLike(ssh, ["nodes", 0, "attrs", "key"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(fingerprint, ["nodes", 0, "attrs", "fingerprint"], { declaredAttrType: "public_key" })).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("ssh-rsa ", "A".repeat(40)), ["nodes", 0, "attrs", "key"], { declaredAttrType: "public_key" })).toMatchObject({ rule: "high_entropy" });

    const marker = runtime("-----BEGIN RSA ", "PRIVATE KEY-----");
    expect(findSecretLike(marker, ["nodes", 0, "attrs", "key"], { declaredAttrType: "public_key" })).toMatchObject({ rule: "private_key" });
    expect(findSecretLike(runtime("github", "_pat_fixture"), ["nodes", 0, "attrs", "key"], { declaredAttrType: "public_key" })).toMatchObject({ rule: "known_prefix" });
    const completeUserUrl = runtime("https://user", ":fixture@", "example.test");
    expect(findSecretLike(completeUserUrl, ["nodes", 0, "attrs", "key"], { declaredAttrType: "public_key" })).toMatchObject({ rule: "url_credentials" });
    expect(JSON.stringify(findSecretLike(marker, ["nodes", 0, "attrs", marker], { declaredAttrType: "public_key" }))).not.toContain(marker);
  });

  it("redacts string and array paths containing credential substrings", () => {
    const value = runtime("steed", "c_fixture_suffix");
    const issueFromSubstring = findSecretLike(value, ["nodes", 0, "fixture", runtime("prefix-", value)]);
    expect(issueFromSubstring?.path).toEqual(["nodes", 0]);
    expect(JSON.stringify(issueFromSubstring)).not.toContain("fixture");
    expect(JSON.stringify(issueFromSubstring)).not.toContain(value);

    const issueFromString = findSecretLike(value, runtime("label:", value.slice(-8)));
    expect(issueFromString?.path).toBe("[redacted]");
    expect(JSON.stringify(issueFromString)).not.toContain(value);
  });

  it("does not allow malformed URLs to bypass high-entropy detection", () => {
    const malformed = runtime("https:///", "A7!mQ2zX9cV4$pL8&oR3%nK5+");
    expect(findSecretLike(malformed, ["url"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike("https:///api.example.test/health", ["url"])).toBeNull();
    expect(findSecretLike("https://api.example.test/health", ["url"])).toBeNull();
  });

  it("does not exempt other rules or expose scanned values in paths", () => {
    const entropy = "A".repeat(40);
    expect(findSecretLike(entropy, ["label"])).toMatchObject({ rule: "high_entropy" });
    expect(findSecretLike(runtime("steed", "c_fixture"), ["label"], { declaredAttrType: "identifier" })).toMatchObject({ rule: "known_prefix" });

    const privateKey = runtime("-----BEGIN RSA PRIVATE ", "KEY-----");
    const issue = findSecretLike(privateKey, ["nodes", 0, "description", privateKey]);
    const serialized = JSON.stringify(issue);
    expect(issue).toMatchObject({ rule: "private_key" });
    expect(serialized).not.toContain(privateKey);
  });
});
