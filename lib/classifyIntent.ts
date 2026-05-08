const EMERGENCY_KEYWORDS = [
  "emergency", "urgent", "flood", "flooding", "burst", "sewage",
  "backup", "gas", "overflow", "no water", "asap", "immediately",
  "right now",
];

const BOOKING_KEYWORDS = [
  "book", "schedule", "appointment", "available", "when can",
  "tomorrow", "today", "come out", "send someone",
];

const CALLBACK_KEYWORDS = [
  "call me", "call back", "callback", "phone me", "ring me",
];

export type IntentCategory = "emergency" | "booking" | "callback" | "general";

export interface IntentResult {
  notify: boolean;
  category: IntentCategory;
  urgency: "HIGH" | "MEDIUM" | "LOW";
  shortIssue: string;
}

export function classifyIntent(
  customerMessage: string,
  isFirstMessage: boolean
): IntentResult {
  const lower = customerMessage.toLowerCase();
  const shortIssue =
    customerMessage.length > 50
      ? customerMessage.slice(0, 47) + "..."
      : customerMessage;

  if (EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "emergency", urgency: "HIGH", shortIssue };
  }

  if (BOOKING_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "booking", urgency: "MEDIUM", shortIssue };
  }

  if (CALLBACK_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { notify: true, category: "callback", urgency: "MEDIUM", shortIssue };
  }

  if (isFirstMessage) {
    return { notify: true, category: "general", urgency: "LOW", shortIssue };
  }

  return { notify: false, category: "general", urgency: "LOW", shortIssue };
}
