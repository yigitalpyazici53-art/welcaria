import { getRedis } from "./redis";

// Inbound webhook deduplication.
//
// Both Twilio and Meta retry a webhook when the first delivery is slow, times
// out, or returns a non-2xx. Without a dedup gate the retry re-runs the whole
// inbound pipeline for a message that was already handled: the patient's text is
// appended to conversation state twice, the LLM is called again, a duplicate
// reply is sent, and a completed lead is written to Sheets a second time.
//
// The provider's own immutable message id is the dedup key. Upstash SET NX is
// the source of truth so the gate holds across serverless instances; the
// in-memory Set is a best-effort fallback for a single warm instance when Redis
// is unconfigured or unreachable — it cannot see other instances, but it is
// strictly better than no gate at all.
//
// Key format and TTL are shared by every channel: `dedup:<providerMessageId>`,
// 300s. Provider ids do not collide (Twilio `SM…`, Meta `wamid.…`).
const DEDUP_TTL_S = 300;
const MAX_ID_CACHE = 200;

const recentIds = new Set<string>();

function markInMemory(messageId: string): boolean {
  if (recentIds.has(messageId)) return true;
  recentIds.add(messageId);
  if (recentIds.size > MAX_ID_CACHE) {
    recentIds.delete(recentIds.values().next().value!);
  }
  return false;
}

/**
 * Claims `messageId` for processing.
 *
 * Returns true when this id has already been seen inside the TTL — the caller
 * MUST skip the message (and still answer the webhook 200, so the provider
 * stops retrying). Returns false when the claim is fresh and processing may
 * continue.
 */
export async function isDuplicateMessage(
  messageId: string,
  logPrefix: string
): Promise<boolean> {
  const r = getRedis();
  if (!r) return markInMemory(messageId);

  try {
    const result = await r.set(`dedup:${messageId}`, "1", { nx: true, ex: DEDUP_TTL_S });
    return result === null;
  } catch (err) {
    console.error(
      `${logPrefix} Redis dedup check failed, falling back to memory:`,
      err instanceof Error ? err.message : err
    );
    return markInMemory(messageId);
  }
}
