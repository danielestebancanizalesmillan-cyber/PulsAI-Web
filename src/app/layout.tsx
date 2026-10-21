import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PulsAI — Inteligencia Analítica",
  description: "Web de inteligencia artificial independiente del ecosistema Pulso inspirada en la experiencia conversacional de Grok, impulsada por Gemma 4.",
  keywords: ["PulsAI", "Pulso", "AI", "Gemma 4", "Ollama", "Analytics"],
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
