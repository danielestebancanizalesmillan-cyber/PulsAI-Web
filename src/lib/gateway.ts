/**
 * PulsAI Gateway Connector & Status Monitor
 * Gestiona de forma privada la verificación y comunicación con el gateway local
 */

export interface PulsAIStatus {
    online: boolean;
    model: string;
    targetUrl: string;
    latencyMs: number;
    error?: string;
}

const GATEWAY_URL = process.env.PULSAI_GATEWAY_URL || "http://127.0.0.1:11435";
const GATEWAY_TOKEN = process.env.PULSAI_GATEWAY_TOKEN || "";
const TARGET_MODEL = process.env.PULSAI_MODEL || "gemma4:e2b";

let cachedTunnelUrl: { url: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 25000;

export async function getGatewayUrl(): Promise<string> {
    // Si estamos en localhost y responde, usarlo directamente
    try {
        const ping = await fetch(`${GATEWAY_URL}/api/health`, {
            headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
            signal: AbortSignal.timeout(1000)
        });
        if (ping.ok) {
            return GATEWAY_URL.replace(/\/$/, "");
        }
    } catch {}

    if (process.env.PULSAI_TUNNEL_URL) {
        return process.env.PULSAI_TUNNEL_URL.replace(/\/$/, "");
    }

    const now = Date.now();
    if (cachedTunnelUrl && (now - cachedTunnelUrl.fetchedAt < CACHE_TTL_MS)) {
        return cachedTunnelUrl.url;
    }

    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (blobToken) {
        try {
            const listRes = await fetch("https://blob.vercel-storage.com?prefix=pulsai-tunnel-url&limit=5", {
                headers: { Authorization: `Bearer ${blobToken}` },
                cache: "no-store",
                signal: AbortSignal.timeout(3000),
            } as any);

            if (listRes.ok) {
                const listData = await listRes.json();
                const blobs: any[] = listData?.blobs || [];
                blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

                if (blobs.length > 0 && blobs[0].url) {
                    const blobRes = await fetch(blobs[0].url, {
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    } as any);
                    if (blobRes.ok) {
                        const data = await blobRes.json();
                        if (data?.url && typeof data.url === "string" && data.url.startsWith("https://")) {
                            cachedTunnelUrl = { url: data.url.replace(/\/$/, ""), fetchedAt: now };
                            return cachedTunnelUrl.url;
                        }
                    }
                }
            }
        } catch (e: any) {
            // Silencioso: fallback a GATEWAY_URL local
        }
    }

    return GATEWAY_URL.replace(/\/$/, "");
}

/**
 * Consulta la salud del Gateway existente (GET /api/health)
 */
export async function checkGatewayStatus(): Promise<PulsAIStatus> {
    const startTime = Date.now();
    
    // 1. Probar primero el gateway local directo (más rápido y directo en tu portátil)
    const localUrl = GATEWAY_URL.replace(/\/$/, "");
    try {
        const localRes = await fetch(`${localUrl}/api/health`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${GATEWAY_TOKEN}` },
            cache: "no-store",
            signal: AbortSignal.timeout(1500)
        });

        if (localRes.ok) {
            const data = await localRes.json();
            return {
                online: data.status === "online",
                model: data.model || TARGET_MODEL,
                targetUrl: localUrl,
                latencyMs: Date.now() - startTime
            };
        }
    } catch {
        // Si no responde localmente, probamos el túnel remoto (despliegue público)
    }

    // 2. Si no está en localhost, probar URL resuelta (túnel Cloudflare)
    const url = await getGatewayUrl();
    try {
        const res = await fetch(`${url}/api/health`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${GATEWAY_TOKEN}`
            },
            cache: "no-store",
            signal: AbortSignal.timeout(4500)
        });

        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
            const errData = await res.json().catch(() => ({ reason: `HTTP ${res.status}` }));
            return {
                online: false,
                model: TARGET_MODEL,
                targetUrl: url,
                latencyMs,
                error: errData.reason || `Gateway respondió con código ${res.status}`
            };
        }

        const data = await res.json();
        return {
            online: data.status === "online",
            model: data.model || TARGET_MODEL,
            targetUrl: url,
            latencyMs
        };
    } catch (err: any) {
        return {
            online: false,
            model: TARGET_MODEL,
            targetUrl: url,
            latencyMs: Date.now() - startTime,
            error: err.name === "TimeoutError" ? "Tiempo de espera agotado al conectar con el gateway" : "Portátil o gateway desconectado (127.0.0.1:11435 no accesible)"
        };
    }
}
