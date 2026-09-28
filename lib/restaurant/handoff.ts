// Restaurant-mode handoff: pause the bot on the thread, then alert the owner.
//
// Called by BOTH inbound routes (Meta webhook, Twilio SMS) after the handoff reply has
// been attempted, whenever the pipeline returned requestHandoff: true. One shared
// module so the two routes cannot drift (same reasoning as lib/bookingHandoff.ts).
//
// Ordering is the point:
//   1. humanHandoff = true — ALWAYS, before and regardless of the alert. The customer
//      has just been told "bunu hemen işletmeye iletiyorum"; the bot must not keep
//      talking after that, even if the owner can't be reached. The thread stays
//      visible in the inbox, where the operator picks it up.
//   2. Owner alert — best effort, never throws:
//        a. Meta WhatsApp to OWNER_PHONE, through sendOutbound() and therefore the
//           full compliance gate (kill switch, circuit breaker, inbound-only, 24h
//           window). NOTE: Meta only delivers free-form text inside the owner's own
//           24h window, i.e. the owner must have written to the business number in
//           the last 24h; otherwise the gate blocks it (BLOCKED_NO_INBOUND_HISTORY /
//           BLOCKED_WINDOW_CLOSED) and that verdict is logged.
//        b. Twilio SMS to OWNER_PHONE — only if Twilio is fully configured. Twilio is
//           optional in restaurant deployments.
//        c. Neither delivered → logged loudly; the handoff from step 1 stands.

import type { ConversationState, RestaurantHandoffReason } from "../conversationState";
import { updateState } from "../conversationState";
import { sendOutbound, type OutboundResult } from "../outboundSend";
import { sendSms } from "../twilio";
import { maskPhone } from "../sanitize";
import { envOrUndefined } from "../env";
import { formatPartySize } from "./intent";

const REASON_LABELS: Record<RestaurantHandoffReason, string> = {
  reservation: "Yeni rezervasyon talebi",
  reservation_stalled: "Rezervasyon talebi (bilgiler tamamlanamadı)",
  info_missing: "Bot cevaplayamadı (bilgi metninde yok)",
  info_not_configured: "Bot cevaplayamadı (RESTAURANT_INFO_TEXT tanımlı değil)",
  order_not_configured: "Paket sipariş talebi (RESTAURANT_ORDER_INFO tanımlı değil)",
  ai_unavailable: "Bot cevaplayamadı (yapay zeka servisine ulaşılamadı)",
  ungrounded_reply: "Bot cevaplayamadı (doğrulanamayan bilgi içeren cevap engellendi)",
};

const LAST_MESSAGE_MAX_CHARS = 300;

function displayNumber(from: string): string {
  const bare = from.replace(/^whatsapp:/i, "");
  return /^\d+$/.test(bare) ? `+${bare}` : bare;
}

/**
 * Owner-facing alert. Carries the customer's number in full (the owner needs it to
 * call back) and, for non-reservation handoffs, the customer's last message so the
 * owner knows what to answer. Goes only to OWNER_PHONE — never to a customer.
 */
export function buildRestaurantOwnerAlert(from: string, state: ConversationState): string {
  const reason = state.restaurantHandoffReason;
  const lines: string[] = [];
  lines.push(`[Restoran] ${reason ? REASON_LABELS[reason] : "Konuşma işletmeye devredildi"}`);
  lines.push(`Müşteri: ${displayNumber(from)}`);

  if (reason === "reservation" || reason === "reservation_stalled") {
    lines.push(`Tarih: ${state.reservationDate || "-"}`);
    lines.push(`Saat: ${state.reservationTime || "-"}`);
    lines.push(`Kişi: ${state.reservationPartySize ? formatPartySize(state.reservationPartySize) : "-"}`);
  }
  if (reason !== "reservation") {
    const lastUser = [...state.history].reverse().find((h) => h.role === "user");
    if (lastUser) {
      const text = lastUser.content;
      lines.push(
        `Mesaj: ${text.length > LAST_MESSAGE_MAX_CHARS ? `${text.slice(0, LAST_MESSAGE_MAX_CHARS)}...` : text}`
      );
    }
  }
  lines.push("Bot bu konuşmada durduruldu; cevabı inbox'tan verebilirsiniz.");
  return lines.join("\n");
}

export type OwnerAlertChannel = "meta" | "sms";

export interface RestaurantHandoffResult {
  handoffApplied: boolean;
  ownerNotified: boolean;
  channel: OwnerAlertChannel | null;
  /** Enumerated, PII-free reason when the alert was not delivered. */
  notDeliveredReason?: string;
}

export interface RestaurantHandoffDeps {
  /** Replaces the Meta transport inside sendOutbound (the gate still runs). */
  metaTransport?: (to: string, body: string) => Promise<void>;
  /** Replaces sendSms for the Twilio fallback. */
  smsTransport?: (to: string, body: string) => Promise<void>;
}

function metaConfigured(): boolean {
  return !!(envOrUndefined("META_WHATSAPP_TOKEN") && envOrUndefined("META_WHATSAPP_PHONE_NUMBER_ID"));
}

function twilioConfigured(): boolean {
  return !!(
    envOrUndefined("TWILIO_ACCOUNT_SID") &&
    envOrUndefined("TWILIO_AUTH_TOKEN") &&
    envOrUndefined("TWILIO_PHONE_NUMBER")
  );
}

async function notifyRestaurantOwner(
  body: string,
  tenantId: string | undefined,
  deps: RestaurantHandoffDeps
): Promise<Omit<RestaurantHandoffResult, "handoffApplied">> {
  const ownerPhone = envOrUndefined("OWNER_PHONE")?.trim();
  if (!ownerPhone) {
    console.error("[RestaurantOwnerAlert] OWNER_PHONE not configured — owner alert NOT sent (handoff still applied)");
    return { ownerNotified: false, channel: null, notDeliveredReason: "no_owner_phone" };
  }

  const reasons: string[] = [];

  if (metaConfigured() || deps.metaTransport) {
    // Meta addresses (and the compliance store keys) threads by bare digits.
    const ownerThread = ownerPhone.replace(/\D/g, "");
    let r: OutboundResult;
    try {
      r = await sendOutbound(
        { to: ownerThread, body, kind: "system", channel: "meta", tenantId, threadKey: ownerThread },
        deps.metaTransport ? { transport: deps.metaTransport } : {}
      );
    } catch (err) {
      console.error("[RestaurantOwnerAlert] Meta send threw:", err instanceof Error ? err.message : err);
      r = { sent: false, decision: "ALLOWED", error: "threw", bodyIntact: false };
    }
    if (r.sent) {
      console.log(`[RestaurantOwnerAlert] sent via meta to=${maskPhone(ownerPhone)}`);
      return { ownerNotified: true, channel: "meta" };
    }
    const why = r.error ? "meta_transport_failed" : `meta_${r.decision.toLowerCase()}`;
    console.error(`[RestaurantOwnerAlert] Meta alert not delivered reason=${why}`);
    reasons.push(why);
  } else {
    reasons.push("meta_not_configured");
  }

  if (twilioConfigured() || deps.smsTransport) {
    try {
      await (deps.smsTransport ?? sendSms)(ownerPhone, body);
      console.log(`[RestaurantOwnerAlert] sent via sms to=${maskPhone(ownerPhone)}`);
      return { ownerNotified: true, channel: "sms" };
    } catch (err) {
      console.error("[RestaurantOwnerAlert] SMS fallback failed:", err instanceof Error ? err.message : err);
      reasons.push("sms_failed");
    }
  } else {
    reasons.push("sms_not_configured");
  }

  const notDeliveredReason = reasons.join(",");
  console.error(
    `[RestaurantOwnerAlert] owner alert NOT delivered (${notDeliveredReason}) — handoff still applied, thread visible in inbox`
  );
  return { ownerNotified: false, channel: null, notDeliveredReason };
}

export async function completeRestaurantHandoff(
  params: { from: string; state: ConversationState; tenantId?: string },
  deps: RestaurantHandoffDeps = {}
): Promise<RestaurantHandoffResult> {
  const { from, state, tenantId } = params;

  // 1. Pause the bot first. updateState() already falls back to memory on a Redis
  //    error; the catch is for anything unexpected, and the alert still goes out.
  let handoffApplied = false;
  try {
    await updateState(from, { humanHandoff: true });
    handoffApplied = true;
  } catch (err) {
    console.error(
      `[RestaurantHandoff] failed to set humanHandoff for ${maskPhone(from)}:`,
      err instanceof Error ? err.message : err
    );
  }
  console.log(
    `[RestaurantHandoff] humanHandoff=${handoffApplied} reason=${state.restaurantHandoffReason ?? "unknown"} thread=${maskPhone(from)}`
  );

  // 2. Alert the owner — never throws.
  const alert = await notifyRestaurantOwner(buildRestaurantOwnerAlert(from, state), tenantId, deps);
  return { handoffApplied, ...alert };
}
