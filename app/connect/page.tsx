"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

// ── Facebook SDK types ──────────────────────────────────────────────────────
declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (params: {
        appId: string;
        cookie: boolean;
        xfbml: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FBLoginResponse) => void,
        params: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: { setup: Record<string, unknown>; featureType: string; sessionInfoVersion: number };
        }
      ) => void;
    };
  }
}

interface FBLoginResponse {
  authResponse?: {
    code?: string;
    accessToken?: string;
  };
  status: string;
}

// ── Meta App config ─────────────────────────────────────────────────────────
const META_APP_ID = process.env.NEXT_PUBLIC_META_APP_ID ?? "";
const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? ""; // Embedded Signup config

function ConnectContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token"); // onboarding token

  const [status, setStatus] = useState<
    "idle" | "loading" | "connecting" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [clinicInfo, setClinicInfo] = useState<{
    clinic?: string;
    phone?: string;
    verifiedName?: string;
  }>({});

  // Load Facebook SDK
  useEffect(() => {
    if (!META_APP_ID) return;

    window.fbAsyncInit = function () {
      window.FB?.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: true,
        version: "v21.0",
      });
    };

    // Load SDK script
    if (!document.getElementById("facebook-jssdk")) {
      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, []);

  const handleConnect = useCallback(() => {
    if (!window.FB) {
      setStatus("error");
      setMessage("Facebook SDK yüklenemedi. Sayfayı yenileyin.");
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("Geçersiz bağlantı. Lütfen size gönderilen linki kullanın.");
      return;
    }

    setStatus("loading");

    window.FB.login(
      async (response: FBLoginResponse) => {
        if (!response.authResponse?.code) {
          setStatus("idle");
          setMessage("Bağlantı iptal edildi.");
          return;
        }

        setStatus("connecting");
        setMessage("WhatsApp hesabınız bağlanıyor...");

        try {
          const res = await fetch("/api/meta/embedded-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: response.authResponse.code,
              onboardingToken: token,
            }),
          });

          const data = (await res.json()) as {
            success?: boolean;
            clinic?: string;
            phone?: string;
            verifiedName?: string;
            error?: string;
          };

          if (data.success) {
            setStatus("success");
            setClinicInfo({
              clinic: data.clinic,
              phone: data.phone,
              verifiedName: data.verifiedName,
            });
          } else {
            setStatus("error");
            setMessage(data.error ?? "Bağlantı sırasında bir hata oluştu.");
          }
        } catch {
          setStatus("error");
          setMessage("Sunucu hatası. Lütfen tekrar deneyin.");
        }
      },
      {
        config_id: META_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
          sessionInfoVersion: 2,
        },
      }
    );
  }, [token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0ecff 0%, #ffffff 50%, #ede9fe 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', 'Outfit', system-ui, sans-serif",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 8px 40px rgba(91,76,240,0.10)",
          padding: "48px 36px",
          textAlign: "center",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "linear-gradient(135deg, #5b4cf0, #7c6ff7)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
                fill="white"
              />
            </svg>
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#1a1a2e",
              margin: "0 0 8px",
              letterSpacing: "-0.02em",
            }}
          >
            Welcaria
          </h1>
          <p style={{ color: "#64748b", fontSize: 15, margin: 0 }}>
            WhatsApp Business Hesabınızı Bağlayın
          </p>
        </div>

        {/* Status: Idle */}
        {status === "idle" && (
          <>
            <div
              style={{
                background: "#f8f7ff",
                borderRadius: 12,
                padding: "20px 24px",
                marginBottom: 24,
                textAlign: "left",
              }}
            >
              <p
                style={{
                  fontSize: 14,
                  color: "#4a4a6a",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                Aşağıdaki butona tıklayarak WhatsApp Business hesabınızı
                Welcaria&apos;ya bağlayabilirsiniz. Bu işlem{" "}
                <strong>30 saniye</strong> sürer ve hiçbir belge paylaşmanıza
                gerek yoktur.
              </p>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                marginBottom: 24,
                textAlign: "left",
                fontSize: 14,
                color: "#64748b",
              }}
            >
              {[
                "Facebook/Meta hesabınızla giriş yapın",
                "WhatsApp Business hesabınızı seçin",
                "İzinleri onaylayın — bitti!",
              ].map((step, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "#5b4cf0",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {i + 1}
                  </div>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleConnect}
              disabled={!token}
              style={{
                width: "100%",
                padding: "16px 32px",
                background: !token ? "#ccc" : "linear-gradient(135deg, #5b4cf0, #7c6ff7)",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 600,
                cursor: !token ? "not-allowed" : "pointer",
                transition: "transform 0.15s, box-shadow 0.15s",
                boxShadow: "0 4px 16px rgba(91,76,240,0.25)",
              }}
              onMouseOver={(e) => {
                if (token) (e.target as HTMLElement).style.transform = "translateY(-1px)";
              }}
              onMouseOut={(e) => {
                (e.target as HTMLElement).style.transform = "translateY(0)";
              }}
            >
              WhatsApp&apos;ı Bağla
            </button>

            {!token && (
              <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>
                Geçersiz bağlantı. Lütfen size e-posta ile gönderilen linki kullanın.
              </p>
            )}

            {message && (
              <p style={{ color: "#64748b", fontSize: 13, marginTop: 12 }}>{message}</p>
            )}
          </>
        )}

        {/* Status: Loading / Connecting */}
        {(status === "loading" || status === "connecting") && (
          <div style={{ padding: "40px 0" }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: "3px solid #e2e8f0",
                borderTopColor: "#5b4cf0",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                margin: "0 auto 20px",
              }}
            />
            <p style={{ color: "#4a4a6a", fontSize: 15 }}>
              {status === "loading"
                ? "Facebook ile bağlanılıyor..."
                : "WhatsApp hesabınız bağlanıyor..."}
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Status: Success */}
        {status === "success" && (
          <div style={{ padding: "20px 0" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #22c55e, #16a34a)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: "0 0 8px" }}>
              Bağlantı Başarılı!
            </h2>

            <div
              style={{
                background: "#f0fdf4",
                borderRadius: 12,
                padding: "16px 20px",
                marginTop: 16,
                textAlign: "left",
              }}
            >
              {clinicInfo.clinic && (
                <p style={{ margin: "0 0 8px", fontSize: 14, color: "#15803d" }}>
                  <strong>Klinik:</strong> {clinicInfo.clinic}
                </p>
              )}
              {clinicInfo.phone && (
                <p style={{ margin: "0 0 8px", fontSize: 14, color: "#15803d" }}>
                  <strong>Numara:</strong> {clinicInfo.phone}
                </p>
              )}
              {clinicInfo.verifiedName && (
                <p style={{ margin: 0, fontSize: 14, color: "#15803d" }}>
                  <strong>İşletme:</strong> {clinicInfo.verifiedName}
                </p>
              )}
            </div>

            <p style={{ color: "#64748b", fontSize: 14, marginTop: 16, lineHeight: 1.6 }}>
              WhatsApp botunuz artık aktif! Hastalarınız bu numaradan yazdığında
              Welcaria otomatik olarak yanıt verecek.
            </p>
          </div>
        )}

        {/* Status: Error */}
        {status === "error" && (
          <div style={{ padding: "20px 0" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ef4444, #dc2626)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
              }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 18L18 6M6 6l12 12"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1a1a2e", margin: "0 0 8px" }}>
              Bağlantı Başarısız
            </h2>

            <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 20 }}>{message}</p>

            <button
              onClick={() => {
                setStatus("idle");
                setMessage("");
              }}
              style={{
                padding: "12px 32px",
                background: "linear-gradient(135deg, #5b4cf0, #7c6ff7)",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Tekrar Dene
            </button>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: "1px solid #f1f5f9",
            fontSize: 12,
            color: "#94a3b8",
          }}
        >
          <p style={{ margin: 0 }}>
            Welcaria · AI WhatsApp Asistanı
            <br />
            Sorularınız için{" "}
            <a href="mailto:info@welcaria.com" style={{ color: "#5b4cf0" }}>
              info@welcaria.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          Yükleniyor...
        </div>
      }
    >
      <ConnectContent />
    </Suspense>
  );
}
