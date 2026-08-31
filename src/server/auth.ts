import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
const COOKIE_NAME = "phaseone_monitor_session";

interface SessionPayload {
  sub: string;
  exp: number;
}

export interface SessionOptions {
  username: string;
  sessionSecret: string;
  sessionTtlMs: number;
  cookieSecure: boolean;
}

export interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
  salt: string;
  hash: string;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function deriveKey(
  password: string,
  salt: string,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function parseScryptHash(encodedHash: string): ScryptParameters {
  const normalizedHash = encodedHash.startsWith("b64:")
    ? Buffer.from(encodedHash.slice(4), "base64url").toString("utf8")
    : encodedHash;
  const [algorithm, cost, blockSize, parallelization, salt, hash] =
    normalizedHash.split("$");

  if (
    algorithm !== "scrypt" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !salt ||
    !hash
  ) {
    throw new Error("MONITOR_PASSWORD_HASH has an invalid format");
  }

  const parameters = {
    cost: Number(cost),
    blockSize: Number(blockSize),
    parallelization: Number(parallelization),
    salt,
    hash,
  };

  if (
    !Number.isSafeInteger(parameters.cost) ||
    parameters.cost < 16_384 ||
    !Number.isSafeInteger(parameters.blockSize) ||
    parameters.blockSize <= 0 ||
    !Number.isSafeInteger(parameters.parallelization) ||
    parameters.parallelization <= 0 ||
    !/^[a-f0-9]+$/i.test(parameters.salt) ||
    !/^[a-f0-9]+$/i.test(parameters.hash)
  ) {
    throw new Error("MONITOR_PASSWORD_HASH has unsafe parameters");
  }

  return parameters;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("The monitor password must contain at least 12 characters");
  }

  const cost = 32_768;
  const blockSize = 8;
  const parallelization = 1;
  const salt = randomBytes(16).toString("hex");
  const derived = await deriveKey(password, salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt,
    derived.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parameters = parseScryptHash(encodedHash);
  const expected = Buffer.from(parameters.hash, "hex");
  const actual = await deriveKey(password, parameters.salt, expected.length, {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelization,
    maxmem: 64 * 1024 * 1024,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionCookie(options: SessionOptions): string {
  const payload: SessionPayload = {
    sub: options.username,
    exp: Date.now() + options.sessionTtlMs,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const token = `${encodedPayload}.${sign(encodedPayload, options.sessionSecret)}`;
  const secure = options.cookieSecure ? "; Secure" : "";
  const maxAge = Math.floor(options.sessionTtlMs / 1_000);

  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(cookieSecure: boolean): string {
  const secure = cookieSecure ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (cookieHeader || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

export function verifySessionCookie(
  cookieHeader: string | undefined,
  options: Pick<SessionOptions, "username" | "sessionSecret">,
): boolean {
  const token = parseCookies(cookieHeader).get(COOKIE_NAME);
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const encodedPayload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expectedSignature = sign(encodedPayload, options.sessionSecret);

  if (!safeEqual(signature, expectedSignature)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SessionPayload;
    return payload.sub === options.username && payload.exp > Date.now();
  } catch {
    return false;
  }
}
