import { maskPhone } from "./sanitize";
import { envOrUndefined } from "./env";

export interface MetaApiError {
  message: string;
  type?: string;
  code?: number;
  fbtrace_id?: string;
}

export class MetaWhatsAppError extends Error {
  status: number;
  metaError?: MetaApiError;

  constructor(status: number, metaError?: MetaApiError) {
    const detail = metaError?.message ? ` — ${metaError.message}` : "";
    super(`Meta WhatsApp API error: ${status}${detail}`);
    this.name = "MetaWhatsAppError";
    this.status = status;
    this.metaError = metaError;
  }
}

/**
 * Thrown before any request is made because the Cloud API credentials are missing.
 * Distinct from MetaWhatsAppError so callers can tell "provably nothing was sent".
 */
export class MetaNotConfiguredError extends Error {
  constructor() {
    super("META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID must be set to send WhatsApp messages");
    this.name = "MetaNotConfiguredError";
  }
}

/**
 * Optional per-tenant credentials. When provided, these override the env-var
 * defaults — enabling multi-tenant message sending without restarting.
 */
export interface TenantCredentials {
  token: string;
  phoneNumberId: string;
}

// Shared Cloud API plumbing for both message types. `payload` is everything after
// messaging_product/to — i.e. the type-specific part of the body.
async function postMessage(
  to: string,
  payload: Record<string, unknown>,
  logLabel: string,
  tenantCreds?: TenantCredentials
): Promise<void> {
  const token = tenantCreds?.token ?? envOrUndefined("META_WHATSAPP_TOKEN");
  const phoneNumberId = tenantCreds?.phoneNumberId ?? envOrUndefined("META_WHATSAPP_PHONE_NUMBER_ID");
  const version = envOrUndefined("META_GRAPH_API_VERSION") ?? "v21.0";

  if (!token || !phoneNumberId) {
    throw new MetaNotConfiguredError();
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...payload,
    }),
  });

  if (!response.ok) {
    let metaError: MetaApiError | undefined;
    try {
      const json = await response.json() as { error?: MetaApiError };
      if (json?.error) metaError = json.error;
    } catch {
      // ignore parse failure
    }
    console.error(
      `[MetaWhatsApp] ${logLabel} send failed: ${response.status} code=${metaError?.code ?? "?"} type=${metaError?.type ?? "?"} msg=${metaError?.message ?? "(unknown)"}`
    );
    throw new MetaWhatsAppError(response.status, metaError);
  }

  const data = await response.json().catch(() => null) as { messages?: Array<{ id: string }> } | null;
  console.log(
    `[MetaWhatsApp] ${logLabel} sent to=${maskPhone(to)} messageId=${data?.messages?.[0]?.id ?? "(unknown)"}`
  );
}

/** Free-form text message. Only valid INSIDE the 24h customer-service window. */
export async function sendWhatsAppText(
  to: string,
  body: string,
  tenantCreds?: TenantCredentials
): Promise<void> {
  return postMessage(to, { type: "text", text: { body } }, "text", tenantCreds);
}

/**
 * Pre-approved template message — the only thing Meta accepts once the 24h window
 * has closed.
 *
 * `templateName` and `languageCode` must match a template that is APPROVED in the
 * Meta WhatsApp Manager for this WABA. Meta rejects an unknown name (error 132001)
 * or a language that the approved template does not have (132000/132001), so a
 * typo here surfaces as a MetaWhatsAppError rather than a silent no-op.
 *
 * `bodyParams` fills the template's {{1}}, {{2}}, … placeholders IN ORDER. The count
 * must match the approved template exactly — Meta rejects a mismatch with 132000.
 * Pass [] for a template with no variables.
 *
 * NOTE: only body parameters are supported. A template with header/button variables
 * needs those components added here too.
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = [],
  tenantCreds?: TenantCredentials
): Promise<void> {
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ]
      : undefined;

  return postMessage(
    to,
    {
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components ? { components } : {}),
      },
    },
    `template:${templateName}`,
    tenantCreds
  );
}
