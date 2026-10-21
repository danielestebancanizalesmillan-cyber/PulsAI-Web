# PulsAI Web — Plataforma de Inteligencia Artificial Independiente

PulsAI Web es la aplicación de interfaz conversacional y analítica del ecosistema Pulso, inspirada en la agilidad y experiencia de usuario de Grok, pero dotada de una identidad visual propia, refinada y táctica.

---

## 🏗️ Arquitectura del Sistema

```
[ Navegador Web ] (Escritorio / Móvil)
       │  ▲
       │  │ SSE (Server-Sent Events: Streaming, Pensamiento analítico, Fuentes)
       ▼  │
[ PulsAI Web - Next.js 16 + React 19 ]
  ├─ API /api/status : Monitor de salud y latencia en vivo
  ├─ API /api/chat   : Streaming con abort controller y contexto web
  ├─ API /api/upload : Extracción segura de documentos (TXT, MD, JSON, PDF)
  └─ Tavily API      : Búsqueda fáctica y verificación en tiempo real
       │
       ▼ (Túnel Cloudflare o Red Local)
[ PulsAI Gateway ] (127.0.0.1:11435)
  └─ Ollama Engine (127.0.0.1:11434) ─── Modelo: gemma4:e2b
```

---

## 🚀 Puesta en Marcha

### 1. Iniciar el Gateway en el portátil
Asegúrate de que Ollama y el gateway local estén ejecutándose en tu equipo:
```cmd
cd ..\new-twtr\gateway
call INICIAR-PULSAI.bat
```

### 2. Iniciar PulsAI Web
En esta carpeta (`PulsAI-web`):
```cmd
npm run dev -- -p 3001
```
o haz doble clic sobre:
`start-pulsai-web.bat`

Accede en tu navegador a:
👉 **http://localhost:3001**

---

## ⚙️ Variables de Entorno (`.env`)

| Variable | Descripción |
|---|---|
| `PULSAI_GATEWAY_TOKEN` | Token Bearer para autorizar las peticiones al gateway local |
| `PULSAI_GATEWAY_URL` | Dirección del gateway local (`http://127.0.0.1:11435`) |
| `PULSAI_TUNNEL_URL` | URL pública de Cloudflare Tunnel si se despliega en la nube |
| `PULSAI_MODEL` | Nombre del modelo (`gemma4:e2b`) |
| `TAVILY_API_KEY` | Clave para búsqueda fáctica en la web |
| `BLOB_READ_WRITE_TOKEN` | Auto-descubrimiento dinámico de URL pública de túnel |

---

## 🛡️ Características de Seguridad y Rendimiento

1. **Protección de Memoria (RAM 8 GB):** La aplicación no envía archivos binarios pesados al modelo. Extrae texto formateado de hasta 12 KB para no exceder los límites del gateway.
2. **Streaming Directo:** Emisión progresiva de tokens y razonamiento `<thought>` en tiempo real sin acumular búferes innecesarios.
3. **Indicador de Desconexión Real:** Si el portátil está apagado o el gateway cerrado, la interfaz muestra el estado exacto sin fingir respuestas ni fallar silenciosamente.
4. **Detención Inmediata:** Botón de detención con `AbortController` nativo.
