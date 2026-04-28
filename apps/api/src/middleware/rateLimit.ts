import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

const getClientId = (req: Request): string => {
  // Use Cloudflare IP if available, otherwise use x-forwarded-for or socket IP
  const cfIp = String(req.headers["cf-connecting-ip"] || "");
  if (cfIp) return cfIp;
  
  const forwarded = String(req.headers["x-forwarded-for"] || "");
  if (forwarded) return forwarded.split(",")[0].trim();
  
  return req.socket.remoteAddress || "unknown";
};

const createRateLimitMiddleware = (
  name: string,
  options: {
    windowMs: number; // Time window in ms
    maxRequests: number; // Max requests per window
  }
) => {
  const store = stores.get(name) || new Map<string, RateLimitEntry>();
  stores.set(name, store);

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = getClientId(req);
    const now = Date.now();
    
    // Clean up old entries
    const entry = store.get(clientId);
    if (entry && entry.resetAt < now) {
      store.delete(clientId);
    }

    // Get or create entry
    const current = store.get(clientId) || { count: 0, resetAt: now + options.windowMs };
    
    if (current.count >= options.maxRequests) {
      const retryAfter = Math.ceil((current.resetAt - now) / 1000);
      res.status(429).set("Retry-After", String(retryAfter)).json({
        error: "rate_limit_exceeded",
        retryAfter
      });
      return;
    }

    current.count += 1;
    store.set(clientId, current);
    next();
  };
};

export const createOAuthRateLimiter = () =>
  createRateLimitMiddleware("oauth", {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10 // 10 requests per minute
  });

export const createCallbackRateLimiter = () =>
  createRateLimitMiddleware("callback", {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 20 // 20 requests per 15 minutes
  });

