/**
 * PulsAI Gateway Connector
 * Idéntico al sistema probado y funcionando en Pulso.
 * Resuelve la URL dinámica del túnel desde Vercel Blob (limit=100 ordenado desc)
 * con fallback a PULSAI_GATEWAY_URL / OLLAMA_HOST.
 */

export interface PulsAIStatus {
    online: boolean;
    model: string;
    targetUrl: string;
    latencyMs: number;
    error?: string;
}

const GATEWAY_URL_FALLBACK = process.env.PULSAI_GATEWAY_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11435";
const GATEWAY_TOKEN = process.env.PULSAI_GATEWAY_TOKEN || process.env.OLLAMA_AUTH_TOKEN || "";
const TARGET_MODEL = process.env.PULSAI_MODEL || process.env.OLLAMA_MODEL || "gemma4:e2b";

let _tunnelUrlCache: { url: string; fetchedAt: number } | null = null;
const TUNNEL_CACHE_TTL = 30 * 1000; // 30 segundos de cache

export async function getGatewayUrl(): Promise<string> {
    const now = Date.now();

    // 1. Usar cache fresca
    if (_tunnelUrlCache && (now - _tunnelUrlCache.fetchedAt < TUNNEL_CACHE_TTL)) {
        return _tunnelUrlCache.url;
    }

    // 2. Si estamos en local y responde directamente, usar localhost
    try {
        const ping = await fetch(`${GATEWAY_URL_FALLBACK}/api/health`, {
            headers: GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {},
            signal: AbortSignal.timeout(1000)
        });
        if (ping.ok) {
            _tunnelUrlCache = { url: GATEWAY_URL_FALLBACK.replace(/\/$/, ""), fetchedAt: now };
            return _tunnelUrlCache.url;
        }
    } catch {}

    // 3. Resolver desde Vercel Blob (exactamente igual que en Pulso)
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (blobToken) {
        try {
            const listRes = await fetch("https://blob.vercel-storage.com?prefix=pulsai-tunnel-url&limit=100", {
                headers: { Authorization: `Bearer ${blobToken}` },
                cache: "no-store",
                signal: AbortSignal.timeout(4000),
            } as any);

            if (listRes.ok) {
                const listData = await listRes.json();
                const blobs: any[] = listData?.blobs || [];
                // Ordenar por fecha de subida descendente para tomar el más reciente
                blobs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

                if (blobs.length > 0 && blobs[0].url) {
                    const blobRes = await fetch(blobs[0].url, {
                        cache: "no-store",
                        signal: AbortSignal.timeout(4000),
                    } as any);
                    if (blobRes.ok) {
                        const data = await blobRes.json();
                        if (data?.url && typeof data.url === "string" && data.url.startsWith("https://")) {
                            _tunnelUrlCache = { url: data.url.replace(/\/$/, ""), fetchedAt: now };
                            return _tunnelUrlCache.url;
                        }
                    }
                }
            }
        } catch (e: any) {
            console.warn("[PulsAI] Error al leer Blob:", e.message);
        }
    }

    return GATEWAY_URL_FALLBACK.replace(/\/$/, "");
}

/**
 * Consulta la salud del Gateway existente (GET /api/health)
 * Idéntico a /api/ai/status de Pulso
 */
export async function checkGatewayStatus(): Promise<PulsAIStatus> {
    const startTime = Date.now();
    const url = await getGatewayUrl();

    try {
        const headers: Record<string, string> = {};
        if (GATEWAY_TOKEN) headers["Authorization"] = `Bearer ${GATEWAY_TOKEN}`;

        const res = await fetch(`${url}/api/health`, {
            method: "GET",
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(5000)
        });

        const latencyMs = Date.now() - startTime;

        if (!res.ok) {
            return {
                online: false,
                model: TARGET_MODEL,
                targetUrl: url,
                latencyMs,
                error: `Gateway HTTP ${res.status}`
            };
        }

        const data = await res.json();
        return {
            online: data.status === "online",
            model: data.model || TARGET_MODEL,
            targetUrl: url,
            latencyMs,
            error: data.status === "online" ? undefined : (data.reason || "Modelo no cargado")
        };
    } catch (err: any) {
        return {
            online: false,
            model: TARGET_MODEL,
            targetUrl: url,
            latencyMs: Date.now() - startTime,
            error: "No se puede conectar al gateway"
        };
    }
}
