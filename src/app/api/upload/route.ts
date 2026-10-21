import { NextRequest, NextResponse } from "next/server";

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB máximo en la web
const ALLOWED_TYPES = ["text/plain", "text/markdown", "application/json", "application/pdf"];

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No se proporcionó ningún archivo." }, { status: 400 });
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: "El archivo excede el límite de 4 MB." }, { status: 400 });
        }

        const fileName = file.name.toLowerCase();
        let extractedText = "";

        if (fileName.endsWith(".txt") || fileName.endsWith(".md") || fileName.endsWith(".json") || fileName.endsWith(".csv") || fileName.endsWith(".js") || fileName.endsWith(".ts")) {
            extractedText = await file.text();
        } else if (fileName.endsWith(".pdf")) {
            // Extracción avanzada de texto de PDF descomprimiendo streams FlateDecode
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const raw = buffer.toString("binary");
            let pieces: string[] = [];

            // 1. Intentar descomprimir streams internos de PDF (FlateDecode)
            const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
            let match;
            const zlib = await import("node:zlib");

            while ((match = streamRegex.exec(raw)) !== null) {
                const streamData = Buffer.from(match[1], "binary");
                try {
                    const decompressed = zlib.inflateSync(streamData).toString("utf-8");
                    // Buscar texto contenido en operadores de texto PDF: (texto) Tj o [(texto)] TJ
                    const textMatches = decompressed.match(/\(([^)]+)\)\s*Tj/g);
                    if (textMatches) {
                        pieces.push(textMatches.map(m => m.replace(/^\(|\)\s*Tj$/g, "")).join(" "));
                    }
                    const tjMatches = decompressed.match(/\[([^\]]+)\]\s*TJ/g);
                    if (tjMatches) {
                        pieces.push(
                            tjMatches.map(m => {
                                const innerMatches = m.match(/\(([^)]+)\)/g) || [];
                                return innerMatches.map(im => im.replace(/^\(|\)$/g, "")).join("");
                            }).join(" ")
                        );
                    }
                    // Si no tiene Tj pero tiene texto legible
                    if (!textMatches && !tjMatches) {
                        const clean = decompressed.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s{2,}/g, " ").trim();
                        if (clean.length > 50 && !clean.includes("/Filter") && !clean.includes("endobj")) {
                            pieces.push(clean);
                        }
                    }
                } catch {
                    // No es un stream zlib válido o no está comprimido
                }
            }

            // 2. Extraer textos directos sin comprimir (Tj / TJ en raw)
            const rawTj = raw.match(/\(([^)]+)\)\s*Tj/g) || [];
            if (rawTj.length > 0) {
                pieces.push(rawTj.map(m => m.replace(/^\(|\)\s*Tj$/g, "")).join(" "));
            }

            extractedText = pieces.join("\n\n").trim();

            // 3. Fallback inteligente si los streams estaban encriptados o son vectoriales
            if (!extractedText || extractedText.length < 30) {
                const asciiOnly = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
                const candidateWords = asciiOnly
                    .split(/\s+/)
                    .filter(w => w.length > 2 && !w.startsWith("/") && !w.includes("obj") && !w.includes("endobj"))
                    .join(" ");
                extractedText = candidateWords.slice(0, 8000);
            }

            if (!extractedText || extractedText.length < 20) {
                extractedText = `Documento: ${file.name}\nTamaño: ${(file.size / 1024).toFixed(1)} KB.\n(El archivo no contiene texto seleccionable directo o es un documento escaneado/imagen).`;
            }
        } else {
            return NextResponse.json({ error: "Formato de archivo no soportado. Usa TXT, MD, JSON o PDF." }, { status: 400 });
        }

        // Truncar para no sobrecargar el prompt ni superar el límite seguro del gateway
        const truncated = extractedText.slice(0, 12000);

        return NextResponse.json({
            name: file.name,
            size: file.size,
            preview: truncated.slice(0, 300) + (truncated.length > 300 ? "..." : ""),
            content: truncated
        });
    } catch (e: any) {
        console.error("[PulsAI Upload Error]:", e);
        return NextResponse.json({ error: "Error al procesar el archivo: " + e.message }, { status: 500 });
    }
}
