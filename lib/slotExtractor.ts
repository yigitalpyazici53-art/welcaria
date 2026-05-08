import type { IssueType, Fixture, UrgencyLevel, ConversationState } from "./conversationState";

export interface ExtractedSlots {
  issue_type?: IssueType;
  fixture?: Fixture;
  urgency?: UrgencyLevel;
  preferred_time?: string;
  address?: string;
}

// Order matters: most specific patterns first
const ISSUE_PATTERNS: Array<[RegExp, IssueType]> = [
  // Emergency-specific — must come before generic "burst" or "leak"
  [/\b(pipe\s+burst|burst\s+pipe|pipes?\s+bursting)\b/i, "pipe_burst"],
  [/\b(gas\s*(smell|leak|odor)|smell\s*(of\s*)?gas|smells?\s+like\s+gas|propane\s+leak)\b/i, "gas_smell"],
  [/\b(sewer|sewage|septic)\b/i, "sewer"],
  [/\b(water\s+heater|hot\s+water\s+heater|no\s+hot\s+water|water\s+tank)\b/i, "water_heater"],
  [/\b(clog|clogged|clogs|blocked|backing\s+up|backed\s+up|slow\s+drain)\b/i, "clog"],
  [/\b(leak|leaking|leaks|drip|dripping|drips|burst|bursting|flood|flooding)\b/i, "leak"],
];

// More specific compound patterns before generic single words
const FIXTURE_PATTERNS: Array<[RegExp, Fixture]> = [
  [/\b(kitchen\s+sink|bathroom\s+sink|kitchen\s+faucet|bathroom\s+faucet)\b/i, "sink"],
  [/\b(toilet|commode)\b/i, "toilet"],
  [/\b(shower|bathtub|bath\s+tub|tub)\b/i, "shower"],
  [/\b(pipe|pipes|pipeline)\b/i, "pipe"],
  [/\b(drain)\b/i, "drain"],
  [/\b(sink|faucet)\b/i, "sink"],
];

const URGENCY_PATTERNS: Array<[RegExp, UrgencyLevel]> = [
  [/\b(emergency|urgent|asap|immediately|right\s+now|flood|flooding|burst|no\s+water|water\s+everywhere|pipe\s+burst|burst\s+pipe|gas\s+smell|gas\s+leak)\b/i, "high"],
  [/\b(today|as\s+soon\s+as\s+possible|soon)\b/i, "medium"],
  [/\b(tomorrow|next\s+week|whenever|no\s+rush)\b/i, "low"],
];

const TIME_PATTERNS: RegExp[] = [
  // Combined date + clock time — must come before plain day/time patterns to capture full phrase
  /\b(today|tonight)\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\btomorrow\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\s+(?:tomorrow|today)\b/i,
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  // Plain fallbacks
  /\b(today|tonight|this\s+(?:morning|afternoon|evening))\b/i,
  /\btomorrow(?:\s+(?:morning|afternoon|evening))?\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?\b/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\b(?:morning|afternoon|evening|night)\b/i,
  /\bnext\s+week\b/i,
];

const ADDRESS_PATTERN =
  /\b\d{2,5}\s+[A-Za-z0-9]+(\s+[A-Za-z0-9]+)*\s+(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|way|ct|court|pkwy|parkway)\b/i;

export function extractSlots(message: string): ExtractedSlots {
  const result: ExtractedSlots = {};

  for (const [pattern, type] of ISSUE_PATTERNS) {
    if (pattern.test(message)) {
      result.issue_type = type;
      break;
    }
  }

  for (const [pattern, fixture] of FIXTURE_PATTERNS) {
    if (pattern.test(message)) {
      result.fixture = fixture;
      break;
    }
  }

  for (const [pattern, urgency] of URGENCY_PATTERNS) {
    if (pattern.test(message)) {
      result.urgency = urgency;
      break;
    }
  }

  // Implicit slots for special emergency types — override/supplement pattern results
  if (result.issue_type === "pipe_burst") {
    result.urgency = "high"; // pipe burst is always HIGH regardless of other signals
    if (!result.fixture) result.fixture = "pipe";
  } else if (result.issue_type === "gas_smell") {
    result.urgency = "high"; // gas smell is always HIGH
  }

  for (const pattern of TIME_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      result.preferred_time = match[0].toLowerCase().trim();
      break;
    }
  }

  const addrMatch = message.match(ADDRESS_PATTERN);
  if (addrMatch) {
    result.address = addrMatch[0];
  }

  return result;
}

// Human-readable verb/phrase for each issue type — used in conflict questions
const ISSUE_VERB: Record<IssueType, string> = {
  leak:         "leaking",
  clog:         "clogged",
  water_heater: "water heater issue",
  sewer:        "sewer problem",
  pipe_burst:   "pipe burst",
  gas_smell:    "gas smell",
  other:        "something else",
};

// Returns a clarification question string if new info conflicts with known state.
export function detectConflict(
  state: ConversationState,
  extracted: ExtractedSlots
): string | null {
  if (
    state.issue_type &&
    extracted.issue_type &&
    state.issue_type !== extracted.issue_type
  ) {
    const existingVerb = ISSUE_VERB[state.issue_type] ?? state.issue_type;
    const incomingVerb = ISSUE_VERB[extracted.issue_type] ?? extracted.issue_type;

    // pipe_burst and gas_smell labels are self-contained — no fixture prefix needed
    const needsFixture =
      state.issue_type !== "pipe_burst" && state.issue_type !== "gas_smell";
    const prefix = needsFixture ? `${state.fixture ?? "issue"} ` : "";

    return `Just to confirm - is the ${prefix}${existingVerb} or ${incomingVerb}?`;
  }
  return null;
}
