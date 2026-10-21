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
  ChevronRight
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [collapsedThinking, setCollapsedThinking] = useState<Record<string, boolean>>({});
  
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

  // Manejo de carga de archivos
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
    if (!inputText.trim() || isGenerating) return;

    const userPrompt = inputText.trim();
    setInputText("");

    const newUserMsg: Message = {
      id: "usr_" + Date.now(),
      role: "user",
      content: userPrompt,
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, newUserMsg].map(m => ({ role: m.role, content: m.content })),
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

                    {/* Contenido principal en Markdown */}
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content}
                    </ReactMarkdown>

                    {/* Botón de copiar */}
                    {m.role === "assistant" && m.content && (
                      <button 
                        className={styles.actionIconBtn} 
                        style={{ marginTop: 8 }}
                        onClick={() => copyToClipboard(m.content, m.id)}
                        title="Copiar respuesta"
                      >
                        {copiedId === m.id ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      </button>
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

            <div className={styles.inputRow}>
              <textarea
                className={styles.textarea}
                placeholder="Pregunta a PulsAI o pide un análisis... (Shift + Enter para salto de línea)"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
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
                  disabled={!inputText.trim()}
                  title="Enviar mensaje"
                >
                  <Send size={16} />
                </button>
              )}
            </div>

            <div className={styles.controlsRow}>
              <div className={styles.controlsLeft}>
                <button 
                  className={`${styles.toolBtn} ${enableWebSearch ? styles.toolBtnActive : ""}`}
                  onClick={() => setEnableWebSearch(!enableWebSearch)}
                  title="Búsqueda web en vivo con Tavily"
                >
                  <Globe size={14} />
                  <span>Búsqueda web</span>
                </button>

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
                  <span>Adjuntar</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
