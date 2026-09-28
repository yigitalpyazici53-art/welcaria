import { envOrUndefined } from "../env";

// Restaurant-mode configuration (BUSINESS_TYPE=restaurant).
//
// Every reader goes through envOrUndefined(), so a key that is present but empty or
// whitespace-only counts as NOT configured. That matters here more than anywhere:
// an empty RESTAURANT_INFO_TEXT must switch the bot to "hand off to the business",
// never to answering from nothing. All values are read at call time.

/**
 * Free-text menu, prices, opening hours, address and directions. The ONLY source the
 * bot may answer from. "" when unset — callers treat that as "no information", and
 * the bot hands the conversation to the business instead of answering.
 */
export function getRestaurantInfoText(): string {
  return envOrUndefined("RESTAURANT_INFO_TEXT")?.trim() ?? "";
}

/**
 * Takeaway / delivery guidance sent verbatim when the customer wants to order
 * (e.g. "Paket sipariş için Yemeksepeti'nden 'X' diye aratabilirsiniz."). "" when
 * unset — the order request is then handed off to the business.
 */
export function getRestaurantOrderInfo(): string {
  return envOrUndefined("RESTAURANT_ORDER_INFO")?.trim() ?? "";
}

// Default KVKK notice for restaurant mode. General personal-data wording only — it
// deliberately says nothing about patients or health data. It names the AI assistant
// and the processing abroad because every non-reservation reply is generated through
// Anthropic's API (a US-based processor), which is a cross-border transfer under KVKK.
// Have the business's legal adviser review it; override with RESTAURANT_KVKK_TEXT.
export const DEFAULT_RESTAURANT_KVKK_TEXT =
  "Bu hatta mesajlarınız yapay zeka destekli bir asistan tarafından yanıtlanmaktadır. " +
  "Mesajlaşmaya devam ederek, talebinizin yanıtlanması amacıyla telefon numaranızın ve " +
  "mesaj içeriğinizin, yurt dışındaki hizmet sağlayıcılar dahil, işlenmesini kabul etmiş olursunuz.";

/** KVKK disclosure text for restaurant mode; the default above when unset/empty. */
export function getRestaurantKvkkText(): string {
  return envOrUndefined("RESTAURANT_KVKK_TEXT")?.trim() ?? DEFAULT_RESTAURANT_KVKK_TEXT;
}
