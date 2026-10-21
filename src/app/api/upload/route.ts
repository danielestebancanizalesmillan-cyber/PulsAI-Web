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
            // Extracción segura de fragmentos legibles de PDF sin librerías binarias nativas pesadas
            const arrayBuffer = await file.arrayBuffer();
            const raw = Buffer.from(arrayBuffer).toString("binary");
            const textMatches = raw.match(/\(([^)]+)\)\s*Tj/g) || [];
            
            if (textMatches.length > 0) {
                extractedText = textMatches.map(m => m.replace(/^\(|\)\s*Tj$/g, "")).join(" ");
            } else {
                // Fallback de strings ASCII extraídos
                const asciiOnly = raw.replace(/[^\x20-\x7E\n\r\t]/g, " ");
                extractedText = asciiOnly.replace(/\s{2,}/g, " ").trim().slice(0, 10000);
            }

            if (!extractedText || extractedText.length < 20) {
                extractedText = `[Documento PDF: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]`;
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
