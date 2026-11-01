export type SecretLikeRule =
  | "key_name"
  | "private_key"
  | "known_prefix"
  | "jwt"
  | "url_credentials"
  | "high_entropy";

export type AllowlistedAttrType = "public_key" | "fingerprint" | "identifier";
export type SecretLikePath = string | readonly (string | number)[];

export interface SecretLikeIssue<TPath extends SecretLikePath = SecretLikePath> {
  path: TPath;
  code: "secret_like_value";
  rule: SecretLikeRule;
}

export interface SecretScanOptions {
  declaredAttrType?: AllowlistedAttrType;
  attrKey?: boolean;
}

const keyNamePattern = /(?:password|passwd|passphrase|secret|token|apikey|api_key|private_key|credential|cookie|session|mnemonic|otp)/i;
const privateKeyPattern = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/i;
const knownPrefixPattern = /(steedc_[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_-]+|sk_live_[A-Za-z0-9_-]+|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+|(?:[A-Za-z0-9])sk-[A-Za-z0-9_-]{24,}|rk_live_[A-Za-z0-9_-]+|xox[abprs]-[A-Za-z0-9_-]+|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]+|glpat-[A-Za-z0-9_-]+|npm_[A-Za-z0-9]{36}|tskey-[A-Za-z0-9_-]+)/;
const jwtPattern = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;
const sshPublicKeyPattern = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521) ([A-Za-z0-9+/]+={0,2})(?:[ \t]+[^\r\n]*)?$/;
const wireGuardPublicKeyPattern = /^[A-Za-z0-9+/]{43}=$/;
const md5FingerprintPattern = /^MD5:(?:[0-9A-Fa-f]{2}:){15}[0-9A-Fa-f]{2}$/;
const sha256FingerprintPattern = /^SHA256:[A-Za-z0-9+/]+={0,2}$/;
const hexFingerprintPattern = /^(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const base64ValidatorPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const unpaddedBase64ValidatorPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]{3})?$/;

function isCanonicalBase64(value: string, allowUnpadded = true): boolean {
  if (!value || typeof atob !== "function" || typeof btoa !== "function") return false;
  if (value.includes("=")) {
    if (!base64ValidatorPattern.test(value)) return false;
  } else if (!allowUnpadded || (!base64ValidatorPattern.test(value) && !unpaddedBase64ValidatorPattern.test(value))) {
    return false;
  }
  try {
    const padded = value.includes("=") ? value : value + "=".repeat((4 - value.length % 4) % 4);
    const decoded = atob(padded);
    const canonical = btoa(decoded).replace(/={1,2}$/, "");
    return canonical === value.replace(/={1,2}$/, "");
  } catch {
    return false;
  }
}

interface NistCurve {
  bits: number;
  p: bigint;
  b: bigint;
}

function mod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = mod(base, modulus);
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = mod(result * factor, modulus);
    factor = mod(factor * factor, modulus);
    power >>= 1n;
  }
  return result;
}

function bytesToBigInt(value: string): bigint {
  let result = 0n;
  for (let index = 0; index < value.length; index++) result = (result << 8n) | BigInt(value.charCodeAt(index) & 0xff);
  return result;
}

function isValidMpint(value: string, requireOdd: boolean): boolean {
  if (value.length === 0) return false;
  const first = value.charCodeAt(0) & 0xff;
  if ((first & 0x80) !== 0) return false;
  if (value.length > 1 && first === 0 && ((value.charCodeAt(1) & 0xff) & 0x80) === 0) return false;
  const integer = bytesToBigInt(value);
  return integer > 0n && (!requireOdd || (integer & 1n) === 1n);
}

function nistCurve(curveName: string): NistCurve | null {
  if (curveName === "nistp256") return {
    bits: 256,
    p: BigInt("0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF"),
    b: BigInt("0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B"),
  };
  if (curveName === "nistp384") return {
    bits: 384,
    p: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFFFF0000000000000000FFFFFFFF"),
    b: BigInt("0xB3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEF"),
  };
  if (curveName === "nistp521") return {
    bits: 521,
    p: (1n << 521n) - 1n,
    b: BigInt("0x0051953EB9618E1C9A1F929A21A0B68540EEA2DA725B99B315F3B8B489918EF109E156193951EC7E937B1652C0BD3BB1BF073573DF883D2C34F1EF451FD46B503F00"),
  };
  return null;
}

function isOnNistCurve(point: string, curve: NistCurve): boolean {
  const coordinateBytes = Math.ceil(curve.bits / 8);
  if (point.length !== 1 + coordinateBytes * 2 || point.charCodeAt(0) !== 4) return false;
  const x = bytesToBigInt(point.slice(1, 1 + coordinateBytes));
  const y = bytesToBigInt(point.slice(1 + coordinateBytes));
  if (x >= curve.p || y >= curve.p) return false;
  const left = mod(y * y, curve.p);
  const right = mod(modPow(x, 3n, curve.p) - 3n * x + curve.b, curve.p);
  return left === right;
}

function sshBlobMatchesAlgorithm(encoded: string, algorithm: string): boolean {
  if (!isCanonicalBase64(encoded)) return false;
  try {
    const decoded = atob(encoded.includes("=") ? encoded : encoded + "=".repeat((4 - encoded.length % 4) % 4));
    let offset = 0;
    const readBytes = (): string | null => {
      if (offset + 4 > decoded.length) return null;
      const length = ((decoded.charCodeAt(offset) * 0x1000000)
        + (decoded.charCodeAt(offset + 1) << 16)
        + (decoded.charCodeAt(offset + 2) << 8)
        + decoded.charCodeAt(offset + 3));
      offset += 4;
      if (!Number.isSafeInteger(length) || length < 0 || length > decoded.length - offset) return null;
      const value = decoded.slice(offset, offset + length);
      offset += length;
      return value;
    };
    const readString = (): string | null => readBytes();

    if (readString() !== algorithm) return false;
    if (algorithm === "ssh-ed25519") {
      const key = readBytes();
      return offset === decoded.length && key !== null && key.length === 32;
    }
    if (algorithm === "ssh-rsa") {
      const exponent = readBytes();
      const modulus = readBytes();
      if (exponent === null || modulus === null || offset !== decoded.length) return false;
      if (!isValidMpint(exponent, false) || !isValidMpint(modulus, true)) return false;
      const exponentInteger = bytesToBigInt(exponent);
      return exponentInteger >= 3n && (exponentInteger & 1n) === 1n;
    }
    if (algorithm.startsWith("ecdsa-sha2-nistp")) {
      const curve = readString();
      const expectedCurve = algorithm.slice("ecdsa-sha2-".length);
      const point = readBytes();
      const nist = nistCurve(expectedCurve);
      return offset === decoded.length
        && curve === expectedCurve
        && nist !== null
        && point !== null
        && isOnNistCurve(point, nist);
    }
    return false;
  } catch {
    return false;
  }
}

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  let checksum = 1;
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = (((checksum & 0x1ffffff) << 5) ^ value) >>> 0;
    for (let index = 0; index < generators.length; index++) {
      const generator = generators[index];
      if (generator !== undefined && ((top >>> index) & 1) !== 0) checksum = (checksum ^ generator) >>> 0;
    }
  }
  return checksum;
}

function bech32HrpExpand(hrp: string): number[] {
  const codes = Array.from(hrp, (char) => char.charCodeAt(0) & 0xff);
  return [...codes.map((code) => code >>> 5), 0, ...codes.map((code) => code & 31)];
}

function bech32PayloadIs32Bytes(values: readonly number[]): boolean {
  if (values.length !== 52) return false;
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const value of values) {
    if (value > 31 || value < 0) return false;
    accumulator = (accumulator << 5) | value;
    bitCount += 5;
    while (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >>> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
      if (bytes.length > 32) return false;
    }
  }
  return bitCount === 4 && accumulator === 0 && bytes.length === 32;
}

function isValidBech32Age(value: string): boolean {
  if (value.length !== 62 || !/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/.test(value)) return false;
  const separator = value.lastIndexOf("1");
  if (separator !== 3) return false;
  const hrp = value.slice(0, separator);
  const data = value.slice(separator + 1);
  if (hrp !== "age" || data.length !== 58) return false;
  const values: number[] = [];
  for (const char of data) {
    const index = bech32Charset.indexOf(char);
    if (index < 0) return false;
    values.push(index);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...values]) !== 1) return false;
  return bech32PayloadIs32Bytes(values.slice(0, -6));
}

export function isPublicKeyFormat(value: string): boolean {
  const ssh = value.match(sshPublicKeyPattern);
  if (ssh) return sshBlobMatchesAlgorithm(ssh[2] ?? "", ssh[1] ?? "");
  if (/^age1/.test(value)) return isValidBech32Age(value);
  return wireGuardPublicKeyPattern.test(value) && isCanonicalBase64(value) && (() => {
    try {
      return atob(value).length === 32;
    } catch {
      return false;
    }
  })();
}

export function isFingerprintFormat(value: string): boolean {
  if (md5FingerprintPattern.test(value) || hexFingerprintPattern.test(value)) return true;
  const sha256 = /^SHA256:(.+)$/.exec(value);
  if (!sha256) return false;
  const encoded = sha256[1] ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  if (!isCanonicalBase64(encoded)) return false;
  try {
    const decoded = atob(encoded.includes("=") ? encoded : encoded + "=".repeat((4 - encoded.length % 4) % 4));
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function isIdentifierFormat(value: string): boolean {
  return identifierPattern.test(value);
}

export function matchesAllowlistedAttrType(attrType: AllowlistedAttrType, value: string): boolean {
  switch (attrType) {
    case "public_key": return isPublicKeyFormat(value);
    case "fingerprint": return isFingerprintFormat(value);
    case "identifier": return isIdentifierFormat(value);
  }
}


const sensitiveQueryNames = new Set(["token", "key", "secret", "sig", "signature", "password", "auth"]);

function extractUrlMatches(value: string): string[] {
  const normalized = value.replace(/[\t\r\n]/g, "");
  return (normalized.match(/[a-z][a-z0-9+.-]*:(?:\/{1,2}|\\)[^\s]+/gi) ?? [])
    .map((candidate) => candidate.replace(/[),.;!?\]}]+$/, ""));
}

interface DecodedStages {
  stages: string[];
  exhausted: boolean;
}

function safePercentDecode(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeUrlStages(value: string): DecodedStages {
  let current = value.replace(/\+/g, " ");
  const stages = [value];
  if (current !== value && !stages.includes(current)) stages.push(current);

  for (let index = 0; index < 3; index++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      next = safePercentDecode(current);
    }
    if (next === current) break;
    current = next;
    if (!stages.includes(current)) stages.push(current);
  }

  let fourth: string;
  try {
    fourth = decodeURIComponent(current);
  } catch {
    fourth = safePercentDecode(current);
  }
  return { stages, exhausted: fourth !== current };
}

function decodeQueryName(value: string): string {
  return decodeUrlStages(value).stages.at(-1) ?? value;
}

function urlHasCredentials(url: string): boolean {
  if (url.includes("\\")) return true;
  const colon = url.indexOf("://");
  if (colon < 0) return false;
  let authorityStart = colon + 3;
  while (authorityStart < url.length && (url[authorityStart] === "/" || url[authorityStart] === "\\")) authorityStart++;
  const authorityEndOffsets = [url.indexOf("/", authorityStart), url.indexOf("\\", authorityStart), url.indexOf("?", authorityStart), url.indexOf("#", authorityStart)]
    .filter((offset) => offset >= 0);
  const authorityEnd = authorityEndOffsets.length ? Math.min(...authorityEndOffsets) : url.length;
  const authority = url.slice(authorityStart, authorityEnd);
  if (authority.lastIndexOf("@") >= 0) return true;

  const queryStart = url.indexOf("?", authorityStart);
  if (queryStart < 0) return false;
  const fragmentStart = url.indexOf("#", queryStart);
  const query = url.slice(queryStart + 1, fragmentStart >= 0 ? fragmentStart : url.length);
  return query.split("&").some((part) => sensitiveQueryNames.has(decodeQueryName((part.split("=", 1)[0] ?? "")).toLowerCase()));
}

interface UrlCredentialScan {
  rule: SecretLikeRule | null;
  values: string[];
  exhausted: boolean;
}

function hasWholeFieldUrlCredentials(value: string): boolean {
  const schemePattern = /(?:^|[\s"'`<>()\[\]{},;])([A-Za-z][A-Za-z0-9+.-]*):(?:\/{0,2}|\\)?/gi;
  for (const schemeMatch of value.matchAll(schemePattern)) {
    const authorityStart = schemeMatch.index + schemeMatch[0].length;
    const authorityEndOffsets = [value.indexOf("/", authorityStart), value.indexOf("\\", authorityStart), value.indexOf("?", authorityStart), value.indexOf("#", authorityStart)]
      .filter((offset) => offset >= 0);
    const authorityEnd = authorityEndOffsets.length ? Math.min(...authorityEndOffsets) : value.length;
    const authority = value.slice(authorityStart, authorityEnd);
    for (const stage of decodeUrlStages(authority).stages) {
      if (stage.includes("@") || stage.toLowerCase().includes("%40")) return true;
    }
  }

  return false;
}

function scanNestedDecodedUrls(value: string, depth: number): UrlCredentialScan {
  if (depth > 8) return { rule: null, values: [], exhausted: false };
  const decoded = decodeUrlStages(value);
  const matchingValues = new Set<string>();
  let exhausted = decoded.exhausted;
  let rule: SecretLikeRule | null = null;

  for (const stage of decoded.stages) {
    if (privateKeyPattern.test(stage)) {
      rule ??= "private_key";
      matchingValues.add(stage);
    }
    if (knownPrefixPattern.test(stage)) {
      rule ??= "known_prefix";
      matchingValues.add(stage);
    }
    if (jwtPattern.test(stage)) {
      rule ??= "jwt";
      matchingValues.add(stage);
    }
    if (urlHasCredentials(stage) || hasWholeFieldUrlCredentials(stage)) {
      rule ??= "url_credentials";
      matchingValues.add(stage);
    }

    const components = [stage];
    const queryStart = stage.indexOf("?");
    if (queryStart >= 0) {
      const fragmentStart = stage.indexOf("#", queryStart);
      const query = stage.slice(queryStart + 1, fragmentStart >= 0 ? fragmentStart : stage.length);
      for (const part of query.split("&")) components.push(part.split("=", 1)[0] ?? "", part.slice(part.indexOf("=") + 1));
    }
    for (const component of components) {
      const nested = scanNestedDecodedUrls(component, depth + 1);
      if (nested.rule !== null) {
        rule ??= nested.rule;
        for (const nestedValue of nested.values) matchingValues.add(nestedValue);
      }
      exhausted ||= nested.exhausted;
    }
    for (const url of extractUrlMatches(stage)) {
      const nested = scanNestedDecodedUrls(url, depth + 1);
      if (nested.rule !== null) {
        rule ??= nested.rule;
        for (const nestedValue of nested.values) matchingValues.add(nestedValue);
      }
      exhausted ||= nested.exhausted;
    }
  }

  return { rule, values: [...matchingValues], exhausted };
}

function isUrlWithCredentials(value: string): boolean {
  return extractUrlMatches(value).some((url) => urlHasCredentials(url)) || hasWholeFieldUrlCredentials(value);
}

function ipv4(value: string): boolean {
  if (!/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(value)) return false;
  return value.split(".").every((part) => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

function ipv6(value: string): boolean {
  if (!value.includes(":")) return false;
  if (value.includes("%") || value.includes("/") || /\s/.test(value)) return false;
  if ((value.match(/::/g) ?? []).length > 1) return false;

  const validToken = (token: string): number | null => {
    if (/^[0-9A-Fa-f]{1,4}$/.test(token)) return 1;
    if (token.includes(".") && ipv4(token)) return 2;
    return null;
  };

  const validateTailPosition = (tokens: readonly string[]): boolean => {
    const dotTokens = tokens.filter((token) => token.includes("."));
    return dotTokens.length === 0 || (dotTokens.length === 1 && dotTokens[0] === tokens[tokens.length - 1]);
  };

  if (value.includes("::")) {
    const [leftText = "", rightText = ""] = value.split("::");
    if (leftText.includes("..") || rightText.includes("..")) return false;
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    const tokens = [...left, ...right];
    if (left.some((token) => token.includes("."))) return false;
    if (!validateTailPosition(tokens)) return false;
    let units = 0;
    for (const token of tokens) {
      const count = validToken(token);
      if (count === null) return false;
      units += count;
    }
    return units < 8;
  }

  const parts = value.split(":");
  if (!validateTailPosition(parts)) return false;
  let units = 0;
  for (const token of parts) {
    const count = validToken(token);
    if (count === null) return false;
    units += count;
  }
  return units === 8;
}

function isIpOrCidrFormat(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash >= 0) {
    const address = value.slice(0, slash);
    const prefix = Number(value.slice(slash + 1));
    if (!/^\d+$/.test(value.slice(slash + 1))) return false;
    if (ipv4(address)) return prefix >= 0 && prefix <= 32;
    if (ipv6(address)) return prefix >= 0 && prefix <= 128;
    return false;
  }
  return ipv4(value) || ipv6(value);
}

function isUuid(value: string): boolean {
  return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(value);
}

function isDnsName(value: string): boolean {
  if (value.length > 253 || !value.includes(".")) return false;
  return value.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function isSemver(value: string): boolean {
  return /^v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}

function isNumber(value: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim());
}

function isPlainUrl(value: string): boolean {
  const matches = extractUrlMatches(value);
  if (matches.length !== 1 || matches[0] !== value || isUrlWithCredentials(value)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value);
  if (!scheme || value.includes("\\") || /\s/u.test(value) || value.includes("`") || value.includes('"')) return false;
  const authorityStart = scheme[0].length;
  if (value[authorityStart] === "/" || value[authorityStart] === undefined) return false;
  const authorityEndOffsets = [value.indexOf("/", authorityStart), value.indexOf("?", authorityStart), value.indexOf("#", authorityStart)]
    .filter((offset) => offset >= 0);
  const authorityEnd = authorityEndOffsets.length ? Math.min(...authorityEndOffsets) : value.length;
  if (authorityEnd === authorityStart) return false;
  const decodedDepth = decodeUrlStages(value);
  const nestedDepth = scanNestedDecodedUrls(value, 0);
  if (decodedDepth.exhausted || nestedDepth.exhausted) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === `${scheme[1]?.toLowerCase()}:` && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isHighEntropyAllowlisted(value: string): boolean {
  return isIpOrCidrFormat(value)
    || isUuid(value)
    || /^[0-9A-Fa-f]{32}$/.test(value)
    || isDnsName(value)
    || isSemver(value)
    || isIsoDate(value)
    || isNumber(value)
    || isPlainUrl(value);
}

function shannonEntropy(value: string): number {
  const characters = Array.from(value);
  if (characters.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of characters) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / characters.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function characterClasses(value: string): number {
  const characters = Array.from(value);
  return Number(characters.some((char) => /[a-z]/u.test(char)))
    + Number(characters.some((char) => /[A-Z]/u.test(char)))
    + Number(characters.some((char) => /[0-9]/u.test(char)))
    + Number(characters.some((char) => /^[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]$/u.test(char)));
}

function containsFingerprintInText(value: string): boolean {
  const normalized = value.replace(/\s+/gu, "");

  for (let offset = 0; offset < normalized.length;) {
    const marker = normalized.indexOf("SHA256:", offset);
    if (marker < 0) break;
    for (let length = 43; length <= 46; length++) {
      const candidate = normalized.slice(marker, marker + "SHA256:".length + length);
      if (isFingerprintFormat(candidate)) return true;
    }
    offset = marker + "SHA256:".length;
  }

  const md5InTextPattern = /MD5:(?:[0-9A-Fa-f]{2}:){15}[0-9A-Fa-f]{2}/;
  if (md5InTextPattern.test(normalized)) return true;
  return /(?:[0-9A-Fa-f]{40}|[0-9A-Fa-f]{64})/.test(normalized);
}

// Long hex/base64 runs are only secret-like when they look random. Calibrated on 20k samples per
// alphabet: random 40-char hex never fell below 3.13 bits/char and random base64 below 4.18, while
// repeated characters (0) and long dictionary words (~3.5) stay well under the base64 threshold.
const LONG_RUN_LENGTH = 40;
const HEX_RUN_MIN_ENTROPY = 3;
const BASE64_RUN_MIN_ENTROPY = 3.75;

function isLongRandomRun(run: string): boolean {
  if (Array.from(run).length < LONG_RUN_LENGTH) return false;
  if (/^[0-9A-Fa-f]+$/u.test(run)) return shannonEntropy(run) >= HEX_RUN_MIN_ENTROPY;
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(run) && shannonEntropy(run.replace(/=+$/u, "")) >= BASE64_RUN_MIN_ENTROPY;
}

function hasHighEntropy(value: string): boolean {
  if (containsFingerprintInText(value) || sha256FingerprintPattern.test(value) || md5FingerprintPattern.test(value) || hexFingerprintPattern.test(value)) return true;
  for (const run of value.split(/\s+/u)) {
    if (Array.from(run).length >= 24 && shannonEntropy(run) >= 4 && characterClasses(run) >= 3) return true;
    if (isLongRandomRun(run)) return true;
  }
  const compact = value.replace(/\s+/gu, "");
  return /^[0-9A-Fa-f]+$/u.test(compact) && isLongRandomRun(compact);
}

function pathContainsCredential(pathSegment: string, value: string): boolean {
  if (value.length === 0 || pathSegment.length === 0) return false;
  if (pathSegment.includes(value) || value.includes(pathSegment)) return true;

  const minimumOverlap = 4;
  const shorter = pathSegment.length < value.length ? pathSegment : value;
  const longer = pathSegment.length < value.length ? value : pathSegment;
  if (shorter.length < minimumOverlap) return false;
  for (let start = 0; start <= shorter.length - minimumOverlap; start++) {
    for (let length = shorter.length - start; length >= minimumOverlap; length--) {
      if (longer.includes(shorter.slice(start, start + length))) return true;
    }
  }
  return false;
}

function sanitizeIssuePath<TPath extends SecretLikePath>(path: TPath, values: readonly string[], rule: SecretLikeRule): TPath {
  const containsCredential = (segment: string): boolean => values.some((value) => pathContainsCredential(segment, value));
  if (Array.isArray(path)) {
    const segments = (path as readonly (string | number)[]).filter((segment) => {
      if (typeof segment !== "string") return true;
      return !containsCredential(segment)
        && !(rule === "key_name" && keyNamePattern.test(segment));
    });
    return [...segments] as unknown as TPath;
  }
  if (typeof path === "string"
    && (containsCredential(path) || (rule === "key_name" && keyNamePattern.test(path)))) {
    return "[redacted]" as unknown as TPath;
  }
  return path;
}

export function findSecretLike<TPath extends SecretLikePath>(
  value: string,
  path: TPath,
  options?: SecretScanOptions,
): SecretLikeIssue<TPath> | null {
  const decodedUrlScan = scanNestedDecodedUrls(value, 0);
  const matchingDecodedValues = [value, ...decodedUrlScan.values];
  const issue = (rule: SecretLikeRule, values: readonly string[] = [value]): SecretLikeIssue<TPath> => ({
    path: sanitizeIssuePath(path, [...new Set([value, ...values, ...matchingDecodedValues])], rule),
    code: "secret_like_value",
    rule,
  });

  if (options?.attrKey === true && keyNamePattern.test(value)) return issue("key_name");
  if (privateKeyPattern.test(value)) return issue("private_key");
  if (knownPrefixPattern.test(value)) return issue("known_prefix");
  if (jwtPattern.test(value)) return issue("jwt");
  if (decodedUrlScan.rule !== null) return issue(decodedUrlScan.rule, decodedUrlScan.values);
  if (isUrlWithCredentials(value)) return issue("url_credentials");
  if (decodedUrlScan.exhausted) return issue("high_entropy");

  const declaredAttrType = options?.declaredAttrType;
  if (declaredAttrType && matchesAllowlistedAttrType(declaredAttrType, value)) return null;
  if (!isHighEntropyAllowlisted(value) && hasHighEntropy(value)) return issue("high_entropy");
  return null;
}
