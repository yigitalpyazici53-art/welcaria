import { Redis } from "@upstash/redis";
import { envOrUndefined } from "./env";

let _client: Redis | null = null;

export function getRedis(): Redis | null {
  if (_client) return _client;
  const url = envOrUndefined("UPSTASH_REDIS_REST_URL");
  const token = envOrUndefined("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  _client = new Redis({ url, token });
  return _client;
}
