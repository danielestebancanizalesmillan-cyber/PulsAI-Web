import { NextRequest } from "next/server";
import { getGatewayUrl } from "@/lib/gateway";
import { searchInternet, SearchResult } from "@/lib/search";

export const maxDuration = 300;

const GATEWAY_TOKEN = process.env.PULSAI_GATEWAY_TOKEN || "";
const TARGET_MODEL = process.env.PULSAI_MODEL || "gemma4:e2b";

const SYSTEM_PROMPT = `
Eres PulsAI, la inteligencia artificial analítica de élite del ecosistema Pulso.
Tu creador es Daniel Canizales.
Te caracterizas por respuestas rigurosas, objetivas, analíticas y con estilo refinado.
Usa formato Markdown con precisión: negritas para ideas fuerza, listas para desglosar información y bloques de código cuando sea pertinente.
Si recibes fuentes de búsqueda web, cita siempre el dominio relevante de forma natural.
No inventes datos ni afirmes poder ver lo que no tienes.
`;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { messages = [], enableSearch = false, attachedContext = "" } = body;

        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ error: "Se requiere un arreglo de mensajes válido." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        const lastUserMessage = messages[messages.length - 1]?.content || "";
        let usedSources: SearchResult[] = [];

        // 1. Búsqueda web opcional con Tavily si el usuario la activa
        if (enableSearch && lastUserMessage.length > 3) {
            try {
                usedSources = await searchInternet(lastUserMessage, 4);
            } catch (searchErr) {
                console.error("[PulsAI Chat] Error en búsqueda:", searchErr);
            }
        }

        // 2. Construir contexto enriquecido
        let contextAugmentation = "";
        if (usedSources.length > 0) {
            contextAugmentation += "\n\nINFORMACIÓN ACTUALIZADA DE LA WEB EN TIEMPO REAL:\n";
            usedSources.forEach((s, idx) => {
                contextAugmentation += `[Fuente ${idx + 1}: ${s.title} (${s.url})]\n${s.content}\n\n`;
            });
        }

        if (attachedContext) {
            contextAugmentation += `\n\nCONTENIDO DE DOCUMENTO ADJUNTO:\n${attachedContext.slice(0, 15000)}\n\n`;
        }

        const gatewayUrl = await getGatewayUrl();
        const ollamaMessages = [
            { role: "system", content: SYSTEM_PROMPT + contextAugmentation },
            ...messages.slice(-10) // Mantener últimos 10 mensajes para respetar ventana y memoria
        ];

        // 3. Conexión con el Gateway local con streaming activado
        const gatewayRes = await fetch(`${gatewayUrl}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${GATEWAY_TOKEN}`
            },
            body: JSON.stringify({
                model: TARGET_MODEL,
                messages: ollamaMessages,
                stream: true,
                options: {
                    temperature: 0.7,
                    num_predict: 1024,
                    num_ctx: 2048,
                    num_thread: 2
                }
            }),
            signal: AbortSignal.timeout(300000)
        });

        if (!gatewayRes.ok) {
            const errBody = await gatewayRes.text();
            return new Response(JSON.stringify({
                error: `El Gateway de PulsAI respondió con error (${gatewayRes.status})`,
                details: errBody
            }), {
                status: gatewayRes.status,
                headers: { "Content-Type": "application/json" }
            });
        }

        if (!gatewayRes.body) {
            return new Response(JSON.stringify({ error: "El gateway no devolvió flujo de datos." }), {
                status: 502,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 4. Transformar NDJSON del Gateway en SSE (Server-Sent Events) hacia el cliente
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = gatewayRes.body.getReader();

        const stream = new ReadableStream({
            async start(controller) {
                // Emitir fuentes encontradas primero si existen
                if (usedSources.length > 0) {
                    controller.enqueue(encoder.encode(`event: sources\ndata: ${JSON.stringify(usedSources)}\n\n`));
                }

                let buffer = "";
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed) continue;
                            try {
                                const parsed = JSON.parse(trimmed);
                                const token = parsed.message?.content || "";
                                const thinking = parsed.message?.thinking || "";

                                if (thinking) {
                                    controller.enqueue(encoder.encode(`event: thinking\ndata: ${JSON.stringify({ thinking })}\n\n`));
                                }
                                if (token) {
                                    controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`));
                                }
                                if (parsed.done) {
                                    controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ done: true })}\n\n`));
                                }
                            } catch {
                                // Fragmento no terminado
                            }
                        }
                    }

                    if (buffer.trim()) {
                        try {
                            const parsed = JSON.parse(buffer.trim());
                            const token = parsed.message?.content || "";
                            if (token) {
                                controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token })}\n\n`));
                            }
                        } catch {}
                    }

                    controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
                    controller.close();
                } catch (streamErr: any) {
                    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: streamErr.message })}\n\n`));
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive"
            }
        });

    } catch (error: any) {
        console.error("[PulsAI Chat Route Error]:", error);
        return new Response(JSON.stringify({
            error: "No se pudo conectar con el Gateway local de PulsAI. Asegúrate de que el portátil esté encendido y el gateway activo en el puerto 11435.",
            details: error.message
        }), {
            status: 503,
            headers: { "Content-Type": "application/json" }
        });
    }
}
