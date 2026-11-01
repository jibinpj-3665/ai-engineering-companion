import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  BookOpen,
  Bot,
  Brain,
  ChevronDown,
  ClipboardCheck,
  Headphones,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Plus,
  Sparkles,
  Square,
  Trash2,
  User,
  Volume2,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { ConversationSummary, Source, Topic } from "../lib/types";
import { useApp } from "../contexts/AppContext";
import { useToast } from "../components/ui/Toast";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Input";
import { Markdown } from "../components/ui/Markdown";
import { Spinner } from "../components/ui/Spinner";
import { EvaluateDialog } from "../components/EvaluateDialog";
import { cn, timeAgo } from "../lib/utils";

interface UiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  created_at: string;
  note?: string;
  generator?: string;
  streaming?: boolean;
}

const teachingModes = [
  { id: "chat", label: "Ask", hint: "Direct answer" },
  { id: "explain", label: "Explain", hint: "Structured lesson" },
  { id: "socratic", label: "Socratic", hint: "Guiding questions" },
  { id: "derive", label: "Derive", hint: "First principles" },
  { id: "example", label: "Worked example", hint: "Solved problem" },
  { id: "simplify", label: "Simplify", hint: "Beginner analogy" },
  { id: "quiz", label: "Quiz me", hint: "One question" },
  { id: "debug", label: "Debug coach", hint: "Hint at a time" },
  { id: "evaluate", label: "Examiner", hint: "Evaluate my answer" },
];

const personalities = [
  { id: "study_buddy", label: "Friendly Study Buddy" },
  { id: "professor", label: "Professional Professor" },
  { id: "examiner", label: "Strict Examiner" },
  { id: "mentor", label: "Engineering Mentor" },
  { id: "beginner_teacher", label: "Beginner-Friendly Teacher" },
];

const suggestions = [
  "Explain the sampling theorem using my notes.",
  "Give me a hint before revealing the answer to this topic.",
  "Quiz me on the last module, one question at a time.",
  "Compare FIR and IIR filters with engineering trade-offs.",
];

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[#*_>`$\\]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function Tutor() {
  const { subjects, settings, aiStatus } = useApp();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [topicId, setTopicId] = useState<number | "">("");
  const [personality, setPersonality] = useState(settings?.personality || "study_buddy");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("chat");
  const [sending, setSending] = useState(false);
  const [evaluateOpen, setEvaluateOpen] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ start: () => void; stop: () => void; abort: () => void } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const askedRef = useRef(false);

  useEffect(() => {
    if (settings?.personality) setPersonality(settings.personality);
  }, [settings?.personality]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api.conversations(subjectId === "" ? undefined : Number(subjectId));
      setConversations(data);
    } catch {
      /* silent */
    }
  }, [subjectId]);

  useEffect(() => {
    loadConversations();
    api.topics(subjectId === "" ? undefined : Number(subjectId))
      .then(setTopics)
      .catch(() => setTopics([]));
    setActiveId(null);
    setMessages([]);
  }, [subjectId, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const openConversation = async (id: number, silent = false) => {
    setActiveId(id);
    setLoadingMessages(true);
    setConversationOpen(false);
    try {
      const data = await api.conversation(id);
      setMessages(data.messages.map((message) => ({ ...message, sources: message.sources || [] })));
      if (personalities.some((item) => item.id === data.personality)) setPersonality(data.personality);
    } catch (error) {
      if (!silent) toast("Could not load conversation", error instanceof ApiError ? error.message : "Unexpected error", "error");
    } finally {
      setLoadingMessages(false);
    }
  };

  const patchAssistant = useCallback((id: number, patch: Partial<UiMessage>) => {
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const sendMessage = useCallback(async (text: string, requestedMode?: string) => {
    const message = text.trim();
    if (!message || sending) return;
    const selectedMode = requestedMode || mode;
    setInput("");
    setLastQuestion(message);
    setSending(true);
    const userTempId = Date.now();
    const assistantId = userTempId + 1;
    const temporary: UiMessage = { id: userTempId, role: "user", content: message, sources: [], created_at: new Date().toISOString() };
    const assistant: UiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      sources: [],
      created_at: new Date().toISOString(),
      generator: aiStatus?.configured ? "ai" : "offline",
      streaming: true,
    };
    setMessages((current) => [...current, temporary, assistant]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await api.chatStream(
        {
          message,
          conversation_id: activeId || undefined,
          subject_id: subjectId === "" ? undefined : Number(subjectId),
          topic_id: topicId === "" ? undefined : Number(topicId),
          personality,
          mode: selectedMode,
        },
        {
          onMeta: (meta) => {
            setActiveId(meta.conversation_id);
            patchAssistant(assistantId, { sources: meta.sources || [], generator: meta.generator });
          },
          onDelta: (delta) => {
            setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, content: item.content + delta } : item));
          },
          onError: (detail) => {
            patchAssistant(assistantId, { note: `AI provider error: ${detail} Showing a labelled offline retrieval answer.`, generator: "offline" });
          },
          onDone: (done) => {
            setMessages((current) => current.map((item) => item.id === assistantId ? {
              ...item,
              id: done.message_id,
              sources: done.sources || item.sources,
              note: item.note || done.note || "",
              generator: done.generator,
              streaming: false,
            } : item));
            if (done.note) toast("Tutor notice", done.note, done.generator === "ai" ? "info" : "warning");
          },
        },
        controller.signal,
      );
      await loadConversations();
    } catch (error) {
      if (controller.signal.aborted) {
        patchAssistant(assistantId, { streaming: false, note: "Stopped before the answer was saved. Ask again to save a complete answer." });
      } else {
        setMessages((current) => current.filter((item) => item.id !== userTempId && item.id !== assistantId));
        toast("Could not send message", error instanceof ApiError ? error.message : "Unexpected error", "error");
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }, [activeId, aiStatus?.configured, loadConversations, mode, patchAssistant, personality, sending, subjectId, toast, topicId]);

  const stopStreaming = () => {
    abortRef.current?.abort();
  };

  useEffect(() => {
    const ask = params.get("ask");
    if (!ask || askedRef.current) return;
    askedRef.current = true;
    const next = new URLSearchParams(params);
    next.delete("ask");
    setParams(next, { replace: true });
    sendMessage(ask);
  }, [params, sendMessage, setParams]);

  const startVoice = () => {
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast("Voice input unavailable", "This Windows/Electron build does not expose speech recognition. Use the text composer.", "warning");
      return;
    }
    try {
      const recognition = new SpeechRecognition() as {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        start: () => void;
        stop: () => void;
        abort: () => void;
        onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((event: { error: string }) => void) | null;
        onend: (() => void) | null;
      };
      recognition.lang = "en-US";
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript;
        }
        setInput(transcript);
      };
      recognition.onerror = (event) => {
        setListening(false);
        toast("Voice input error", event.error, "warning");
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      toast("Could not start voice input", "Check microphone permissions.", "error");
    }
  };

  const stopVoice = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const speak = (message: UiMessage) => {
    if (!("speechSynthesis" in window)) {
      toast("Speech output unavailable", "Windows speech synthesis was not found.", "warning");
      return;
    }
    if (speakingId === message.id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(message.content).slice(0, 6000));
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utterance);
    setSpeakingId(message.id);
  };

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setConversationOpen(false);
  };

  const removeConversation = async (id: number) => {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await api.deleteConversation(id);
      if (activeId === id) startNew();
      await loadConversations();
      toast("Conversation deleted", undefined, "success");
    } catch (error) {
      toast("Could not delete conversation", error instanceof ApiError ? error.message : "Unexpected error", "error");
    }
  };

  const conversationsList = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Conversations</p>
        <Button variant="ghost" size="icon-sm" onClick={startNew} aria-label="New conversation"><Plus size={15} /></Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">No conversations yet.</p>
        ) : conversations.map((conversation) => (
          <div key={conversation.id} className={cn("group flex items-start gap-1 rounded-xl border p-2.5 transition", activeId === conversation.id ? "border-primary/30 bg-primary/[0.08]" : "border-transparent hover:bg-muted/50")}>
            <button onClick={() => openConversation(conversation.id)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-xs font-medium">{conversation.title}</p>
              <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{conversation.preview || "Empty conversation"}</p>
              <p className="mt-1 text-[9px] text-muted-foreground">{timeAgo(conversation.updated_at)} · {conversation.message_count} messages</p>
            </button>
            <button onClick={() => removeConversation(conversation.id)} className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-danger group-hover:opacity-100" aria-label="Delete conversation"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-7.5rem)] min-h-[560px] gap-4">
      <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/60 lg:flex">
        {conversationsList}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card/[0.55]">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] text-white">
              <Bot size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold">AI Engineering Tutor</p>
              <p className="text-[10px] text-muted-foreground">{aiStatus?.configured ? `${aiStatus.provider} · ${aiStatus.model}` : "Offline grounded retrieval"}</p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setConversationOpen(true)}><MessageSquarePlus size={14} /> Chats</Button>
            <Select value={subjectId} onChange={(event) => { setSubjectId(event.target.value === "" ? "" : Number(event.target.value)); setTopicId(""); }} className="h-8 w-36 text-xs">
              <option value="">General</option>
              {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
            <Select value={topicId} onChange={(event) => setTopicId(event.target.value === "" ? "" : Number(event.target.value))} className="h-8 w-36 text-xs" disabled={subjectId === ""}>
              <option value="">Any topic</option>
              {topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
            </Select>
            <Select value={personality} onChange={(event) => setPersonality(event.target.value)} className="h-8 w-44 text-xs">
              {personalities.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2">
          {teachingModes.map((item) => (
            <button
              key={item.id}
              onClick={() => setMode(item.id)}
              title={item.hint}
              className={cn(
                "shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-medium transition",
                mode === item.id
                  ? "border-primary/35 bg-primary/[0.12] text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
          <Button variant="ghost" size="sm" className="ml-auto shrink-0 text-[10px]" onClick={() => setEvaluateOpen(true)}>
            <ClipboardCheck size={12} /> Grade answer
          </Button>
        </div>

        {!aiStatus?.configured ? (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/[0.08] px-3 py-2 text-[11px] leading-5 text-warning">
            <Brain size={14} className="mt-0.5 shrink-0" />
            Offline mode: the tutor retrieves passages from your uploaded notes and cites them, but cannot add outside knowledge or generated examples. Configure a provider in Settings for a full tutor.
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loadingMessages ? (
            <div className="py-16"><Spinner label="Loading conversation" /></div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex max-w-xl flex-col items-center py-10 text-center">
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.08] p-4 text-primary"><Sparkles size={26} /></div>
              <h2 className="mt-4 font-display text-xl font-semibold">Think it through together</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Ask a question, get a hint before the answer, or practise viva-style reasoning. Answers cite your uploaded material with page numbers.</p>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => sendMessage(suggestion)} className="rounded-xl border border-border bg-muted/30 p-3 text-left text-xs leading-5 text-muted-foreground transition hover:border-primary/[0.35] hover:text-foreground">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((message) => (
                <div key={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "")}>
                  {message.role === "assistant" ? (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-2)))] text-white"><Bot size={14} /></div>
                  ) : null}
                  <div className={cn("max-w-[85%]", message.role === "user" ? "rounded-2xl rounded-br-md bg-primary/[0.15] px-4 py-3 text-sm leading-6" : "min-w-0 flex-1")}>
                    {message.role === "assistant" ? (
                      <>
                        {message.content ? (
                          <div className="relative">
                            <Markdown content={message.content} />
                            {message.streaming ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary align-middle" /> : null}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs text-muted-foreground">
                            <Loader2 size={13} className="animate-spin" /> Retrieving your notes and thinking…
                          </div>
                        )}
                        {message.note ? (
                          <p className="mt-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-[10px] leading-4 text-warning">{message.note}</p>
                        ) : null}
                        {message.sources.length > 0 ? (
                          <details className="group mt-3 rounded-xl border border-border/70 bg-muted/25 p-3">
                            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-primary">
                              <BookOpen size={12} /> {message.sources.length} source{message.sources.length > 1 ? "s" : ""} from your material
                              <ChevronDown size={12} className="ml-auto transition group-open:rotate-180" />
                            </summary>
                            <div className="mt-2 space-y-2">
                              {message.sources.map((source) => (
                                <div key={`${source.document_id}-${source.page}-${source.index}`} className={cn("rounded-lg border p-2.5", source.cited ? "border-primary/35 bg-primary/[0.06]" : "border-border/60 bg-card/60")}>
                                  <p className="text-[10px] font-medium text-foreground">
                                    {source.label ? <span className="mr-1.5 rounded bg-primary/10 px-1 py-0.5 font-mono text-[9px] text-primary">{source.label}</span> : null}
                                    {source.document} · page {source.page}{source.heading ? ` · ${source.heading}` : ""}
                                  </p>
                                  <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-muted-foreground">{source.snippet}</p>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        <div className="mt-2 flex items-center gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => speak(message)} aria-label="Read answer aloud" disabled={message.streaming || !message.content}>
                            {speakingId === message.id ? <Square size={12} /> : <Volume2 size={13} />}
                          </Button>
                          <span className="text-[9px] text-muted-foreground">
                            {personalities.find((item) => item.id === personality)?.label || "Study Buddy"}
                            {message.generator === "offline" ? " · offline retrieval" : message.generator === "ai" ? " · AI + your sources" : ""}
                          </span>
                        </div>
                      </>
                    ) : message.content}
                  </div>
                  {message.role === "user" ? (
                    <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"><User size={13} /></div>
                  ) : null}
                </div>
              ))}
              {sending ? (
                <div className="flex gap-3">
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.15] text-primary"><Bot size={14} /></div>
                  <div className="flex items-center gap-2 rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" /> Retrieving your notes and thinking…
                  </div>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
            <div className={cn("rounded-2xl border bg-background/60 p-2 transition", listening ? "border-danger/50 shadow-[0_0_0_4px_hsl(var(--danger)/0.08)]" : "border-border focus-within:border-primary/40")}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!sending) sendMessage(input);
                  }
                }}
                rows={2}
                placeholder={listening ? "Listening… speak your question" : "Ask your tutor, request a hint, or practise a viva answer…"}
                className="w-full resize-none bg-transparent px-3 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground/60"
              />
              <div className="flex items-center gap-1.5 px-1 pb-0.5">
                <Button variant="ghost" size="icon-sm" onClick={listening ? stopVoice : startVoice} aria-label="Voice input" className={cn(listening && "bg-danger/10 text-danger")}>
                  {listening ? <MicOff size={15} /> : <Mic size={15} />}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setInput("")} aria-label="Clear input" disabled={!input}><Trash2 size={14} /></Button>
                <span className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
                  <Headphones size={10} /> Voice input where available
                  <span className="kbd ml-2">Enter</span>
                </span>
                {sending ? (
                  <Button size="icon-sm" variant="danger" onClick={stopStreaming} aria-label="Stop generating">
                    <Square size={13} />
                  </Button>
                ) : (
                  <Button size="icon-sm" onClick={() => sendMessage(input)} disabled={!input.trim()} aria-label="Send message">
                    <ArrowUp size={15} />
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-center text-[9px] text-muted-foreground">AI can make mistakes. Verify citations and derivations against your textbook.</p>
          </div>
        </div>
      </div>

      <EvaluateDialog
        open={evaluateOpen}
        onClose={() => setEvaluateOpen(false)}
        subjectId={subjectId === "" ? undefined : Number(subjectId)}
        initialQuestion={lastQuestion}
      />

      <AnimatePresence>
        {conversationOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setConversationOpen(false)} />
            <motion.div initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} className="relative h-full w-72 border-r border-border bg-background">
              {conversationsList}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
