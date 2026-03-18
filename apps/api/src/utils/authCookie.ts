import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

type SessionUser = {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  accessToken: string;
};

type AuthCookiePayload = {
  user: SessionUser;
  exp: number;
};

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "ukrrp_auth";
const AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 8;

const getSessionSecret = () => {
  const secret = String(process.env.SESSION_SECRET || "");
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required");
  }
  return secret;
};

const normalizeOrigin = (value: string) => value.trim().replace(/\/$/, "");

const getCookieSecurityOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const dashboardOrigin = normalizeOrigin(String(process.env.DASHBOARD_ORIGIN || ""));
  const dashboardOverHttps = dashboardOrigin.startsWith("https://");
  const forceSecureCookie = String(process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true";
  const secure = isProduction || dashboardOverHttps || forceSecureCookie;
  const sameSiteEnv = String(process.env.SESSION_COOKIE_SAMESITE || "").toLowerCase();
  const sameSite =
    sameSiteEnv === "none" || sameSiteEnv === "lax" || sameSiteEnv === "strict"
      ? sameSiteEnv
      : secure
        ? "none"
        : "lax";
  return { secure, sameSite: sameSite as "none" | "lax" | "strict" };
};

const base64UrlEncode = (value: string) => Buffer.from(value, "utf-8").toString("base64url");
const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf-8");

const signValue = (value: string) => createHmac("sha256", getSessionSecret()).update(value).digest("base64url");

const parseCookieHeader = (cookieHeader: string) => {
  const result = new Map<string, string>();
  cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const idx = entry.indexOf("=");
      if (idx <= 0) {
        return;
      }
      const key = entry.slice(0, idx).trim();
      const value = entry.slice(idx + 1).trim();
      result.set(key, value);
    });
  return result;
};

const getRawAuthCookie = (req: Request) => {
  const header = String(req.headers.cookie || "");
  if (!header) {
    return "";
  }
  const parsed = parseCookieHeader(header);
  return parsed.get(AUTH_COOKIE_NAME) || "";
};

const getRawAuthHeaderToken = (req: Request) => {
  const headerValue = req.headers["x-auth-token"];
  if (typeof headerValue === "string") {
    return headerValue.trim();
  }
  if (Array.isArray(headerValue) && headerValue.length > 0) {
    return String(headerValue[0] || "").trim();
  }
  return "";
};

const decodeAuthCookie = (rawValue: string): AuthCookiePayload | null => {
  if (!rawValue || !rawValue.includes(".")) {
    return null;
  }
  const [payloadEncoded, signature] = rawValue.split(".");
  if (!payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = signValue(payloadEncoded);
  const provided = Buffer.from(signature, "utf-8");
  const expected = Buffer.from(expectedSignature, "utf-8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payloadJson = base64UrlDecode(payloadEncoded);
    const payload = JSON.parse(payloadJson) as AuthCookiePayload;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (!payload.user || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const decodeAuthToken = (rawValue: string): AuthCookiePayload | null => {
  if (!rawValue || !rawValue.includes(".")) {
    return null;
  }
  const [payloadEncoded, signature] = rawValue.split(".");
  if (!payloadEncoded || !signature) {
    return null;
  }

  const expectedSignature = signValue(payloadEncoded);
  const provided = Buffer.from(signature, "utf-8");
  const expected = Buffer.from(expectedSignature, "utf-8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payloadJson = base64UrlDecode(payloadEncoded);
    const payload = JSON.parse(payloadJson) as AuthCookiePayload;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (!payload.user || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

export const createAuthToken = (user: SessionUser) => {
  // Create signed auth token with full user data (including accessToken)
  // This is safe because:
  // 1. Token is HMAC-signed and cannot be forged
  // 2. Token is short-lived (8 hours)
  // 3. Same token is in the session cookie
  // 4. If token is stolen, the user's device is already compromised
  const payload: AuthCookiePayload = {
    user,
    exp: Date.now() + AUTH_COOKIE_MAX_AGE_MS
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
};

const createAuthCookie = (user: SessionUser) => {
  // Auth cookie includes the full user with accessToken (httpOnly)
  const payload: AuthCookiePayload = {
    user,
    exp: Date.now() + AUTH_COOKIE_MAX_AGE_MS
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = signValue(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
};

export const setAuthCookie = (res: Response, user: SessionUser) => {
  const value = createAuthCookie(user);
  const { secure, sameSite } = getCookieSecurityOptions();
  res.cookie(AUTH_COOKIE_NAME, value, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
    path: "/"
  });
};

export const clearAuthCookie = (res: Response) => {
  const { secure, sameSite } = getCookieSecurityOptions();
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/"
  });
};

export const restoreSessionUserFromAuthCookie = (req: Request) => {
  if (req.session.user) {
    return req.session.user;
  }
  const rawCookie = getRawAuthCookie(req);
  if (!rawCookie) {
    return null;
  }
  const payload = decodeAuthCookie(rawCookie);
  if (!payload) {
    return null;
  }
  req.session.user = payload.user;
  return payload.user;
};

export const restoreSessionUserFromAuthHeader = (req: Request) => {
  if (req.session.user) {
    return req.session.user;
  }
  const rawToken = getRawAuthHeaderToken(req);
  if (!rawToken) {
    return null;
  }
  const payload = decodeAuthToken(rawToken);
  if (!payload) {
    return null;
  }
  // Set session user from header token so middleware checks pass
  req.session.user = payload.user;
  return payload.user;
};
