"use client";

import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { 
  Sparkles, 
  Send, 
  Square, 
  Globe, 
  Paperclip, 
  Trash2, 
  Plus, 
  Menu, 
  X, 
  ExternalLink,
  Cpu,
  Brain,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from "lucide-react";
import styles from "./page.module.css";

interface SearchSource {
  title: string;
  url: string;
  content?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  sources?: SearchSource[];
  images?: string[]; // Array de strings base64
  createdAt: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
}

interface SystemStatus {
  online: boolean;
  model: string;
  targetUrl: string;
  latencyMs: number;
  error?: string;
}

export default function PulsAIApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [attachedImages, setAttachedImages] = useState<{ name: string; dataUrl: string; base64: string }[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});

  // Estados de voz y audio
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(false);
  
  // Historial de chats locales
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("default");

  // Estado del Gateway / Ollama
  const [status, setStatus] = useState<SystemStatus>({
    online: false,
    model: "gemma4:e2b",
    targetUrl: "127.0.0.1:11435",
    latencyMs: 0
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);

  // 1. Cargar historial persistente desde localStorage
  useEffect(() => {
    try {
      const savedSessions = localStorage.getItem("pulsai_sessions");
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions);
        setSessions(parsed);
      } else {
        const initial = [{ id: "default", title: "Conversación inicial", updatedAt: new Date().toISOString() }];
        setSessions(initial);
        localStorage.setItem("pulsai_sessions", JSON.stringify(initial));
      }

      const savedMessages = localStorage.getItem("pulsai_messages_default");
      if (savedMessages) {
        setMessages(JSON.parse(savedMessages));
      }
    } catch (e) {
      console.warn("Error al cargar localStorage:", e);
    }
  }, []);

  // 2. Monitorear salud del Gateway periódicamente
  const checkStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus(prev => ({ ...prev, online: false, error: "Gateway HTTP " + res.status }));
      }
    } catch {
      setStatus(prev => ({ ...prev, online: false, error: "Sin conexión con el backend" }));
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll al recibir tokens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Guardar mensajes por sesión
  const saveMessagesForSession = (sessionId: string, msgs: Message[]) => {
    setMessages(msgs);
    try {
      localStorage.setItem(`pulsai_messages_${sessionId}`, JSON.stringify(msgs));
    } catch (e) {}
  };

  const switchSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    if (window.innerWidth <= 768) setSidebarOpen(false);
    try {
      const saved = localStorage.getItem(`pulsai_messages_${sessionId}`);
      setMessages(saved ? JSON.parse(saved) : []);
    } catch {
      setMessages([]);
    }
  };

  const createNewSession = () => {
    const newId = "chat_" + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: "Nueva conversación",
      updatedAt: new Date().toISOString()
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    setActiveSessionId(newId);
    setMessages([]);
    if (window.innerWidth <= 768) setSidebarOpen(false);
    try {
      localStorage.setItem("pulsai_sessions", JSON.stringify(updated));
    } catch (e) {}
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = sessions.filter(s => s.id !== id);
    setSessions(updated);
    try {
      localStorage.setItem("pulsai_sessions", JSON.stringify(updated));
      localStorage.removeItem(`pulsai_messages_${id}`);
    } catch (e) {}

    if (activeSessionId === id) {
      if (updated.length > 0) {
        switchSession(updated[0].id);
      } else {
        createNewSession();
      }
    }
  };

  // 3. Inicializar soporte de reconocimiento de voz (Web Speech API) y SpeechSynthesis
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
      }
    }
    return () => {
      // Detener cualquier síntesis de voz al desmontar
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Función para optimizar y redimensionar imágenes en el navegador antes de enviarlas
  // Esto reduce fotos de 10MB a ~150-250KB, resolviendo el error 502 (payload límite) y 524 (timeout en CPU)
  const optimizeAndAttachImage = async (file: File) => {
    return new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round((width * MAX_HEIGHT) / height);
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve();
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          // Exportar en JPEG optimizado (0.82 de calidad)
          const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          const base64Data = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");

          setAttachedImages(prev => [
            ...prev,
            {
              name: file.name || "foto_optimizada.jpg",
              dataUrl: dataUrl,
              base64: base64Data
            }
          ]);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = readerEvent.target?.result as string;
      };
      reader.onerror = () => resolve();
      reader.readAsDataURL(file);
    });
  };

  // Manejo de carga de imágenes (Cámara o Galería)
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) {
        alert("Solo se admiten archivos de imagen (JPG, PNG, WEBP, GIF).");
        continue;
      }
      await optimizeAndAttachImage(file);
    }

    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages(prev => prev.filter((_, idx) => idx !== index));
  };

  // Soporte para pegar imágenes directamente desde el portapapeles (Ctrl+V)
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (!file) continue;
        await optimizeAndAttachImage(file);
      }
    }
  };

  // Control de entrada de voz por micrófono (Web Speech API)
  const toggleVoiceRecording = () => {
    if (!speechSupported) {
      alert("Tu navegador no soporta reconocimiento de voz nativo (Web Speech API). Usa Google Chrome, Edge o Safari.");
      return;
    }

    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsRecording(false);
      return;
    }

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = "es-ES";
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputText(prev => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed} ${transcript}` : transcript;
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.error("Error en reconocimiento de voz:", event.error);
        setIsRecording(false);
        if (event.error === "not-allowed") {
          alert("Acceso al micrófono denegado. Permite el uso del micrófono en tu navegador.");
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e: any) {
      console.error("No se pudo iniciar el micrófono:", e);
      setIsRecording(false);
    }
  };

  // Control de síntesis de voz (Text-to-Speech)
  const speakMessage = (text: string, messageId: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Tu navegador no soporta lectura de texto en voz alta (SpeechSynthesis).");
      return;
    }

    // Si ya está leyendo este mismo mensaje, pausar/detener
    if (speakingMessageId === messageId) {
      window.speechSynthesis.cancel();
      setSpeakingMessageId(null);
      return;
    }

    // Detener cualquier lectura previa
    window.speechSynthesis.cancel();

    // Limpiar Markdown y etiquetas antes de leer
    const cleanText = text
      .replace(/```[\s\S]*?```/g, " [bloque de código omitido] ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_#>[\]()]/g, "")
      .replace(/\n+/g, ". ")
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = "es-ES";
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    // Buscar una voz en español de calidad si está disponible
    const voices = window.speechSynthesis.getVoices();
    const esVoice = voices.find(v => v.lang.startsWith("es") || v.lang.includes("es-"));
    if (esVoice) utterance.voice = esVoice;

    utterance.onend = () => {
      setSpeakingMessageId(null);
    };

    utterance.onerror = () => {
      setSpeakingMessageId(null);
    };

    setSpeakingMessageId(messageId);
    window.speechSynthesis.speak(utterance);
  };

  // Manejo de carga de archivos de texto/documentos
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setAttachedFile({ name: data.name, content: data.content });
      } else {
        alert(data.error || "Error al subir el archivo.");
      }
    } catch (err: any) {
      alert("Error en la subida: " + err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Enviar mensaje con streaming nativo SSE
  const handleSendMessage = async () => {
    const hasText = inputText.trim().length > 0;
    const hasImages = attachedImages.length > 0;
    if ((!hasText && !hasImages) || isGenerating) return;

    const userPrompt = inputText.trim() || (hasImages ? "¿Qué observas en esta imagen? Analízala detalladamente." : "");
    const imagesToSend = attachedImages.map(img => img.base64);
    const imageUrlsToDisplay = attachedImages.map(img => img.dataUrl);

    setInputText("");
    setAttachedImages([]);

    const newUserMsg: Message = {
      id: "usr_" + Date.now(),
      role: "user",
      content: userPrompt,
      images: imageUrlsToDisplay.length > 0 ? imageUrlsToDisplay : undefined,
      createdAt: new Date().toISOString()
    };

    const assistantMsgId = "ai_" + Date.now();
    const placeholderMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      thinking: "",
      sources: [],
      createdAt: new Date().toISOString()
    };

    const updatedMessages = [...messages, newUserMsg, placeholderMsg];
    saveMessagesForSession(activeSessionId, updatedMessages);
    setIsGenerating(true);

    // Actualizar título del chat si es el primer mensaje
    if (messages.length === 0) {
      const title = userPrompt.slice(0, 32) + (userPrompt.length > 32 ? "..." : "");
      const updatedSessions = sessions.map(s => s.id === activeSessionId ? { ...s, title } : s);
      setSessions(updatedSessions);
      try {
        localStorage.setItem("pulsai_sessions", JSON.stringify(updatedSessions));
      } catch (e) {}
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      // Construir historial de mensajes incluyendo las imágenes enviadas en el formato que espera el backend
      const messagesPayload = [...messages, newUserMsg].map(m => {
        const payloadObj: { role: string; content: string; images?: string[] } = {
          role: m.role,
          content: m.content
        };
        // Si es el mensaje actual y tiene imágenes base64
        if (m.id === newUserMsg.id && imagesToSend.length > 0) {
          payloadObj.images = imagesToSend;
        }
        return payloadObj;
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesPayload,
          enableSearch: enableWebSearch,
          attachedContext: attachedFile?.content || ""
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: "Error desconocido del gateway" }));
        throw new Error(errJson.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let accumulatedContent = "";
      let accumulatedThinking = "";
      let accumulatedSources: SearchSource[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            let event = "";
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) event = line.slice(7).trim();
              if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
            }

            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              if (event === "token" && data.token) {
                accumulatedContent += data.token;
              } else if (event === "thinking" && data.thinking) {
                accumulatedThinking += data.thinking;
              } else if (event === "sources" && Array.isArray(data)) {
                accumulatedSources = data;
              }

              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: accumulatedContent,
                        thinking: accumulatedThinking,
                        sources: accumulatedSources
                      }
                    : m
                )
              );
            } catch (e) {}
          }
        }
      }

      // Guardar versión final
      const finalMessages = updatedMessages.map(m =>
        m.id === assistantMsgId
          ? {
              ...m,
              content: accumulatedContent || "No se obtuvo respuesta del modelo.",
              thinking: accumulatedThinking,
              sources: accumulatedSources
            }
          : m
      );
      saveMessagesForSession(activeSessionId, finalMessages);

      // Auto-collapse thinking after generation completes
      if (accumulatedThinking) {
        setCollapsedThinking(prev => ({ ...prev, [assistantMsgId]: true }));
      }

      // Lectura por voz automática si el usuario la activó
      if (autoSpeak && accumulatedContent) {
        speakMessage(accumulatedContent, assistantMsgId);
      }

    } catch (err: any) {
      if (err.name === "AbortError") {
        // Detenido por el usuario
      } else {
        const errorMsg: Message = {
          id: "err_" + Date.now(),
          role: "assistant",
          content: `⚠️ **Aviso del Sistema PulsAI:**\n\n${err.message}\n\n*Verifica que tu portátil tenga el gateway ejecutándose en el puerto 11435.*`,
          createdAt: new Date().toISOString()
        };
        saveMessagesForSession(activeSessionId, [...updatedMessages.filter(m => m.id !== assistantMsgId), errorMsg]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
      setAttachedFile(null); // Consumir archivo adjunto
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={styles.layout}>
      {/* OVERLAY PARA MÓVIL */}
      {sidebarOpen && (
        <div 
          className={styles.mobileOverlay} 
          onClick={() => setSidebarOpen(false)} 
        />
      )}

      {/* SIDEBAR */}
      <aside className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarClosed : ""}`}>
        <div className={styles.brandHeader}>
          <div className={styles.brandLogo}>
            <div className={styles.brandIcon}>P</div>
            <span>PulsAI</span>
          </div>
          <button className={styles.actionIconBtn} onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <button className={styles.newChatBtn} onClick={createNewSession}>
          <Plus size={16} />
          <span>Nueva conversación</span>
        </button>

        <div className={styles.historyList}>
          <div className={styles.historyTitle}>Conversaciones</div>
          {sessions.map(s => (
            <div 
              key={s.id} 
              className={`${styles.historyItem} ${s.id === activeSessionId ? styles.historyItemActive : ""}`}
              onClick={() => switchSession(s.id)}
            >
              <span className={styles.historyText}>{s.title}</span>
              <div className={styles.historyActions}>
                <button className={styles.actionIconBtn} onClick={(e) => deleteSession(s.id, e)} title="Eliminar">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ESTADO DEL GATEWAY */}
        <div className={styles.sidebarFooter}>
          <div className={styles.statusCard}>
            <div className={`${styles.statusIndicator} ${status.online ? styles.statusOnline : styles.statusOffline}`} />
            <div className={styles.statusText}>
              <span className={styles.statusTitle}>
                {status.online ? "IA Local Online" : "IA Desconectada"}
              </span>
              <span className={styles.statusSubtitle}>
                {status.online ? `${status.model} · ${status.latencyMs}ms` : (status.error || "Portátil apagado")}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL */}
      <main className={styles.mainContent}>
        {/* Topbar */}
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            {!sidebarOpen && (
              <button className={styles.toggleSidebarBtn} onClick={() => setSidebarOpen(true)}>
                <Menu size={18} />
              </button>
            )}
            <div className={styles.modelBadge}>
              <Cpu size={14} color="#00e5ff" />
              <span>{status.model}</span>
            </div>
          </div>
        </header>

        {/* Mensajes */}
        <div className={styles.messagesScroll}>
          {messages.length === 0 ? (
            <div className={styles.welcomeContainer}>
              <div className={styles.welcomeIconWrapper}>
                <Sparkles size={32} color="#00e5ff" />
              </div>
              <h1 className={styles.welcomeTitle}>PulsAI Analytics</h1>
              <p className={styles.welcomeSubtitle}>
                Inteligencia analítica conectada directamente a tu modelo local {status.model}.
                Capacidad de análisis táctico, búsqueda web en tiempo real y lectura de documentos.
              </p>

              <div className={styles.suggestionGrid}>
                <div 
                  className={styles.suggestionCard}
                  onClick={() => setInputText("Analiza las diferencias clave entre economías de mercado y modelos mixtos en 2026")}
                >
                  "Analiza las diferencias clave entre economías de mercado y modelos mixtos..."
                </div>
                <div 
                  className={styles.suggestionCard}
                  onClick={() => {
                    setEnableWebSearch(true);
                    setInputText("¿Cuáles son los eventos tecnológicos más destacados de esta semana?");
                  }}
                >
                  🌐 Activar búsqueda web e investigar noticias tecnológicas de esta semana
                </div>
                <div 
                  className={styles.suggestionCard}
                  onClick={() => setInputText("Explica cómo optimizar un pipeline de inferencia local con Ollama y bajo consumo de RAM")}
                >
                  "Explica cómo optimizar inferencia local con Ollama en equipos de 8 GB..."
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.messagesContainer}>
              {messages.map((m) => (
                <div 
                  key={m.id} 
                  className={`${styles.messageRow} ${m.role === "user" ? styles.messageUser : ""}`}
                >
                  <div className={`${styles.avatar} ${m.role === "user" ? styles.avatarUser : styles.avatarAI}`}>
                    {m.role === "user" ? "U" : <Sparkles size={16} />}
                  </div>

                  <div className={`${styles.messageBubble} ${m.role === "user" ? styles.bubbleUser : styles.bubbleAI}`}>
                    {/* Caja de Pensamiento / Razonamiento — Estilo Grok */}
                    {m.thinking && (() => {
                      const isCurrentlyThinking = isGenerating && m.id === messages[messages.length - 1]?.id && !m.content;
                      const isCollapsed = collapsedThinking[m.id] ?? false;
                      const toggleCollapse = () => {
                        setCollapsedThinking(prev => ({ ...prev, [m.id]: !prev[m.id] }));
                      };

                      return (
                        <div className={`${styles.thinkingBox} ${isCurrentlyThinking ? styles.thinkingBoxLive : styles.thinkingBoxDone}`}>
                          <button 
                            className={styles.thinkingToggle}
                            onClick={toggleCollapse}
                            type="button"
                          >
                            <div className={styles.thinkingToggleLeft}>
                              {isCurrentlyThinking ? (
                                <div className={styles.thinkingPulse}>
                                  <Brain size={15} />
                                </div>
                              ) : (
                                <Brain size={15} className={styles.thinkingIconDone} />
                              )}
                              <span className={styles.thinkingLabel}>
                                {isCurrentlyThinking ? "Pensando..." : "Razonamiento analítico"}
                              </span>
                              {isCurrentlyThinking && (
                                <div className={styles.thinkingDots}>
                                  <span className={styles.dot1} />
                                  <span className={styles.dot2} />
                                  <span className={styles.dot3} />
                                </div>
                              )}
                            </div>
                            <div className={styles.thinkingChevron}>
                              {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </div>
                          </button>
                          <div className={`${styles.thinkingContent} ${isCollapsed ? styles.thinkingContentCollapsed : ""}`}>
                            <div className={styles.thinkingInner}>
                              {m.thinking}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Imágenes adjuntas si el usuario las envió */}
                    {m.images && m.images.length > 0 && (
                      <div className={styles.messageImagesGrid}>
                        {m.images.map((imgUrl, imgIdx) => (
                          <img 
                            key={imgIdx} 
                            src={imgUrl} 
                            alt={`Imagen ${imgIdx + 1}`} 
                            className={styles.messageImage} 
                            onClick={() => window.open(imgUrl, "_blank")}
                            title="Haz clic para ver imagen en tamaño completo"
                          />
                        ))}
                      </div>
                    )}

                    {/* Contenido principal en Markdown */}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>

                    {/* Barra de acciones para respuestas del asistente */}
                    {m.role === "assistant" && m.content && (
                      <div className={styles.messageActionsRow}>
                        <button 
                          className={styles.actionIconBtn} 
                          onClick={() => copyToClipboard(m.content, m.id)}
                          title="Copiar respuesta"
                        >
                          {copiedId === m.id ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        </button>

                        <button 
                          className={`${styles.actionIconBtn} ${speakingMessageId === m.id ? styles.speakingBtnActive : ""}`} 
                          onClick={() => speakMessage(m.content, m.id)}
                          title={speakingMessageId === m.id ? "Detener lectura en voz alta" : "Leer en voz alta"}
                        >
                          {speakingMessageId === m.id ? <VolumeX size={14} color="#00e5ff" /> : <Volume2 size={14} />}
                        </button>
                      </div>
                    )}

                    {/* Fuentes de búsqueda web */}
                    {m.sources && m.sources.length > 0 && (
                      <div className={styles.sourcesContainer}>
                        <div className={styles.sourcesTitle}>Fuentes consultadas en la web</div>
                        <div className={styles.sourcesList}>
                          {m.sources.map((s, idx) => (
                            <a 
                              key={idx} 
                              href={s.url} 
                              target="_blank" 
                              rel="noreferrer" 
                              className={styles.sourceBadge}
                            >
                              <span>{s.title}</span>
                              <ExternalLink size={12} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* INPUT INFERIOR */}
        <div className={styles.bottomArea}>
          {!status.online && (
            <div className={styles.offlineBanner}>
              <Cpu size={16} />
              <span>
                <strong>Aviso:</strong> El conector local de PulsAI no responde en 127.0.0.1:11435. Asegúrate de ejecutar el gateway en tu portátil para chatear con el modelo.
              </span>
            </div>
          )}

          <div className={`${styles.inputCard} ${isInputFocused ? styles.inputCardFocus : ""}`}>
            {/* Banner de grabación de voz activa */}
            {isRecording && (
              <div className={styles.voiceRecordingBanner}>
                <span className={styles.recordingPulseDot} />
                <span>Escuchando tu voz... Habla con naturalidad hacia tu micrófono.</span>
              </div>
            )}

            {/* Documento de texto adjunto */}
            {attachedFile && (
              <div className={styles.attachedBadge}>
                <Paperclip size={13} />
                <span>{attachedFile.name}</span>
                <button 
                  className={styles.actionIconBtn} 
                  onClick={() => setAttachedFile(null)}
                  style={{ marginLeft: 4 }}
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Miniaturas de imágenes seleccionadas */}
            {attachedImages.length > 0 && (
              <div className={styles.imagePreviewsContainer}>
                {attachedImages.map((img, idx) => (
                  <div key={idx} className={styles.imagePreviewCard}>
                    <img src={img.dataUrl} alt={img.name} className={styles.imagePreviewThumb} />
                    <button 
                      className={styles.imagePreviewRemove} 
                      onClick={() => removeAttachedImage(idx)}
                      title="Eliminar imagen"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.inputRow}>
              <textarea
                className={styles.textarea}
                placeholder="Pregunta a PulsAI, pega imágenes (Ctrl+V) o pulsa el micrófono... (Shift + Enter para salto de línea)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                rows={1}
              />

              {isGenerating ? (
                <button className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={handleStopGeneration} title="Detener generación">
                  <Square size={16} fill="white" />
                </button>
              ) : (
                <button 
                  className={styles.sendBtn} 
                  onClick={handleSendMessage}
                  disabled={!inputText.trim() && attachedImages.length === 0}
                  title="Enviar mensaje"
                >
                  <Send size={16} />
                </button>
              )}
            </div>

            <div className={styles.controlsRow}>
              <div className={styles.controlsLeft}>
                {/* Botón de búsqueda en la web */}
                <button 
                  className={`${styles.toolBtn} ${enableWebSearch ? styles.toolBtnActive : ""}`}
                  onClick={() => setEnableWebSearch(!enableWebSearch)}
                  title="Búsqueda web en vivo con Tavily"
                >
                  <Globe size={14} />
                  <span>Búsqueda web</span>
                </button>

                {/* Input y botón para imágenes */}
                <input 
                  type="file" 
                  ref={imageInputRef} 
                  style={{ display: "none" }} 
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                />
                <button 
                  className={styles.toolBtn}
                  onClick={() => imageInputRef.current?.click()}
                  title="Adjuntar imágenes para análisis visual (JPG, PNG, WEBP)"
                >
                  <ImageIcon size={14} />
                  <span>Imagen</span>
                </button>

                {/* Input y botón para archivos de texto */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: "none" }} 
                  onChange={handleFileUpload}
                  accept=".txt,.md,.json,.pdf,.csv"
                />
                <button 
                  className={styles.toolBtn}
                  onClick={() => fileInputRef.current?.click()}
                  title="Adjuntar documento o archivo de texto"
                >
                  <Paperclip size={14} />
                  <span>Documento</span>
                </button>

                {/* Botón de micrófono / dictado por voz */}
                <button 
                  className={`${styles.toolBtn} ${isRecording ? styles.voiceBtnActive : ""}`}
                  onClick={toggleVoiceRecording}
                  title={isRecording ? "Detener grabación de voz" : "Dictar mensaje con el micrófono (Web Speech API)"}
                >
                  {isRecording ? <MicOff size={14} color="#f43f5e" /> : <Mic size={14} />}
                  <span>{isRecording ? "Grabando..." : "Voz"}</span>
                </button>
              </div>

              {/* Controles del lado derecho: Auto-lectura de respuestas */}
              <div className={styles.controlsRight}>
                <button 
                  className={`${styles.toolBtn} ${autoSpeak ? styles.toolBtnActive : ""}`}
                  onClick={() => setAutoSpeak(!autoSpeak)}
                  title={autoSpeak ? "Desactivar lectura en voz alta automática" : "Activar lectura en voz alta automática de cada respuesta"}
                >
                  {autoSpeak ? <Volume2 size={14} color="#00e5ff" /> : <VolumeX size={14} />}
                  <span>Voz automática</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
