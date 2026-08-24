import { getRedis } from "./redis";
import { maskPhone } from "./sanitize";
import type { OperatorIdentity } from "./inboxOperators";

// ── Inbox operator access log (KVKK erişim izi) ───────────────────────────────
//
// Answers "which operator did what, to which thread, when" for every inbox read
// and mutation. This is the accountability half of finding O-6: per-operator
// identity is worthless without a record of what each identity did.
//
// WHY A SEPARATE LOG AND NOT compliance:log.
// lib/compliance.ts owns a Meta ban-protection decision trail, and its KVKK
// erasure routine (deleteThreadFromComplianceLog) is built on one invariant:
// `thread` is the ONLY field that can carry personal data, and every entry for a
// patient is *deleted* on erasure. An access log wants the opposite of both:
//   - erasure must NOT wipe it. Article 12 accountability means the clinic has to
//     be able to show who touched a record — including the record it later
//     erased. Folding these entries into compliance:log would make the erasure
//     filter destroy exactly the evidence that erasure was performed lawfully.
//   - it must never hold a raw number in the first place. Every thread written
//     here goes through maskPhone(), so the log is not itself a store of patient
//     phone numbers and needs no erasure path at all.
// Keeping them apart also preserves compliance:log's single-PII-field invariant,
// which its erasure code depends on for correctness.
//
// The console line is emitted FIRST and unconditionally, so the trail survives in
// the platform log even when Redis is unreachable; the Redis list is the queryable
// copy. Logging never throws and never blocks the action it records.

const LOG_KEY = "inbox:auditLog";
const LOG_MAX_ENTRIES = 2000;
// Longer than the 90-day compliance log: the access trail should outlive the
// patient data it describes, and it holds only masked identifiers.
const LOG_TTL_S = 180 * 24 * 60 * 60;

export type InboxAction =
  | "login"
  | "login_failed"
  | "logout"
  | "list_conversations"
  | "read_conversation"
  | "reply"
  | "handoff"
  | "erase";

export type InboxOutcome = "ok" | "denied" | "error";

export interface InboxAuditEntry {
  ts: string;
  operatorId: string;
  operatorName: string;
  action: InboxAction;
  /** Masked phone (***1234) or omitted. NEVER a raw number. */
  thread?: string;
  outcome: InboxOutcome;
  detail?: string;
}

export interface AuditInput {
  operator: OperatorIdentity;
  action: InboxAction;
  /** Raw phone/thread key — masked here so no call site can forget to. */
  phone?: string;
  outcome?: InboxOutcome;
  detail?: string;
}

export async function logInboxAction(input: AuditInput): Promise<void> {
  const entry: InboxAuditEntry = {
    ts: new Date().toISOString(),
    operatorId: input.operator.operatorId,
    operatorName: input.operator.name,
    action: input.action,
    ...(input.phone ? { thread: maskPhone(input.phone) } : {}),
    outcome: input.outcome ?? "ok",
    ...(input.detail ? { detail: input.detail } : {}),
  };

  const line = JSON.stringify(entry);
  if (entry.outcome === "ok") {
    console.log(`[InboxAudit] ${line}`);
  } else {
    console.warn(`[InboxAudit] ${line}`);
  }

  const r = getRedis();
  if (!r) return;
  try {
    await r.lpush(LOG_KEY, line);
    await r.ltrim(LOG_KEY, 0, LOG_MAX_ENTRIES - 1);
    await r.expire(LOG_KEY, LOG_TTL_S);
  } catch (err) {
    // The console copy above is already written, so the trail is not lost.
    console.error(
      "[InboxAudit] failed to persist audit entry:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Most recent entries, newest first. For operator/DPO review. */
export async function readInboxAuditLog(limit = 100): Promise<InboxAuditEntry[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    const rows = await r.lrange<unknown>(LOG_KEY, 0, Math.max(0, limit - 1));
    const entries: InboxAuditEntry[] = [];
    for (const raw of rows ?? []) {
      if (typeof raw === "string") {
        try {
          entries.push(JSON.parse(raw) as InboxAuditEntry);
        } catch {
          // skip an unparseable line rather than fail the whole read
        }
      } else if (raw && typeof raw === "object") {
        entries.push(raw as InboxAuditEntry);
      }
    }
    return entries;
  } catch (err) {
    console.error(
      "[InboxAudit] failed to read audit log:",
      err instanceof Error ? err.message : err
    );
    return [];
  }
}
