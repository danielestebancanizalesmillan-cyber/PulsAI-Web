import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cloudflaredPath = resolve(__dirname, "../new-twtr/cloudflared.exe");
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "vercel_blob_rw_kZBRF0dPOnthFfB6_UFRZiQBX8v3gvfkCqrXiOrJqJVWlG4";

console.log("========================================================");
console.log("       PULSAI WEB — CONECTOR TUNEL CLOUDFLARE           ");
console.log("========================================================");

async function publishTunnelUrl(url) {
    try {
        const body = JSON.stringify({
            url,
            model: "gemma4:e2b",
            updatedAt: new Date().toISOString()
        });

        const res = await fetch("https://blob.vercel-storage.com/pulsai-tunnel-url.json", {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${BLOB_TOKEN}`,
                "Content-Type": "application/json",
                "x-content-type": "application/json"
            },
            body
        });

        if (res.ok) {
            console.log("\n[PulsAI] ✅ URL publicada automáticamente en Vercel:");
            console.log(`         👉 ${url}\n`);
            console.log("[PulsAI] ¡Tu web en Vercel ya está conectada con tu portátil!\n");
        } else {
            console.warn("[PulsAI] Error al publicar en Blob:", res.status);
        }
    } catch (e) {
        console.error("[PulsAI] Error:", e.message);
    }
}

function startTunnel() {
    console.log("[PulsAI] Iniciando túnel hacia http://127.0.0.1:11435...");
    
    // Ejecutar cloudflared con argumentos óptimos
    const tunnel = spawn(cloudflaredPath, [
        "tunnel", 
        "--url", "http://127.0.0.1:11435",
        "--no-autoupdate",
        "--protocol", "quic"
    ], {
        stdio: ["ignore", "pipe", "pipe"]
    });

    let detected = false;

    const onData = (data) => {
        const text = data.toString();
        process.stdout.write(text);

        if (!detected) {
            const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (match) {
                detected = true;
                const tunnelUrl = match[0];
                publishTunnelUrl(tunnelUrl);
            }
        }
    };

    tunnel.stdout.on("data", onData);
    tunnel.stderr.on("data", onData);

    tunnel.on("exit", (code) => {
        console.error(`[PulsAI] Túnel cerrado (${code}). Reiniciando en 3s...`);
        detected = false;
        setTimeout(startTunnel, 3000);
    });

    return tunnel;
}

startTunnel();
