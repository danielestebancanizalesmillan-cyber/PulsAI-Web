import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024; // 4 MB máximo
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json({ error: "No se proporcionó ninguna imagen." }, { status: 400 });
        }

        if (!ALLOWED_MIME_TYPES.includes(file.type)) {
            return NextResponse.json({
                error: `Formato de imagen no soportado (${file.type || "desconocido"}). Usa JPG, PNG, WEBP o GIF.`
            }, { status: 400 });
        }

        if (file.size > MAX_IMAGE_SIZE) {
            return NextResponse.json({
                error: `La imagen excede el límite de 4 MB (tamaño: ${(file.size / (1024 * 1024)).toFixed(1)} MB).`
            }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const base64Data = Buffer.from(arrayBuffer).toString("base64");

        return NextResponse.json({
            name: file.name,
            size: file.size,
            mimeType: file.type,
            base64: base64Data,
            dataUrl: `data:${file.type};base64,${base64Data}`
        });
    } catch (e: any) {
        console.error("[PulsAI Image Upload Error]:", e);
        return NextResponse.json({ error: "Error al procesar la imagen: " + e.message }, { status: 500 });
    }
}
