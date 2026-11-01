import type {
  AIStatus,
  AIUsageResponse,
  AnalyticsData,
  AuthStatus,
  AuthUser,
  ChatResponse,
  ConversationDetail,
  ConversationSummary,
  Coverage,
  DashboardData,
  DocumentCapabilities,
  DocumentRecord,
  EvaluationResult,
  LibraryBatch,
  LibraryOverview,
  LibrarySearch,
  LibrarySubjectDetail,
  Exam,
  Flashcard,
  LabDetail,
  LabSummary,
  ModelList,
  Notification,
  PhaseInfo,
  ProviderList,
  Quiz,
  QuizAttempt,
  RevisionStats,
  SavedQuestion,
  ScheduleSession,
  SearchResult,
  Settings,
  Subject,
  TeachingContent,
  Topic,
  TopicProgress,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE || "";

export class ApiError extends Error {
  status: number;
  authRequired: boolean;
  constructor(message: string, status: number, authRequired = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.authRequired = authRequired;
  }
}

function unauthorized(payload: { detail?: unknown; auth_required?: unknown }) {
  window.dispatchEvent(new CustomEvent("aec:unauthorized", {
    detail: { detail: typeof payload.detail === "string" ? payload.detail : "", authRequired: Boolean(payload.auth_required) },
  }));
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${BASE}/api${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    let authRequired = response.status === 401;
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((item: { msg: string }) => item.msg).join(", ");
      if (response.status === 401) {
        unauthorized(data);
        authRequired = Boolean(data.auth_required);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, response.status, authRequired);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  authStatus: () => request<AuthStatus>("/auth/status"),
  login: (email: string, password: string) =>
    request<{ ok: boolean; user: AuthUser }>("/auth/login", json({ email, password })),
  register: (name: string, email: string, password: string) =>
    request<{ ok: boolean; user: AuthUser }>("/auth/register", json({ name, email, password })),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<AuthUser>("/auth/me"),
  updateProfile: (name: string) => request<AuthUser>("/auth/profile", { method: "PATCH", body: JSON.stringify({ name }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>("/auth/password", json({ current_password: currentPassword, new_password: newPassword })),
  requestPasswordReset: (email: string) =>
    request<{ ok: boolean; message: string }>("/auth/password-reset/request", json({ email })),
  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>("/auth/password-reset/confirm", json({ token, new_password: newPassword })),

  dashboard: () => request<DashboardData>("/dashboard"),
  analytics: () => request<AnalyticsData>("/analytics"),

  subjects: () => request<Subject[]>("/subjects"),
  subject: (id: number) => request<Subject>(`/subjects/${id}`),
  createSubject: (body: Partial<Subject>) => request<Subject>("/subjects", json(body)),
  updateSubject: (id: number, body: Partial<Subject>) =>
    request<Subject>(`/subjects/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteSubject: (id: number) => request<{ ok: boolean }>(`/subjects/${id}`, { method: "DELETE" }),

  documents: (subjectId?: number) =>
    request<DocumentRecord[]>(`/documents${subjectId ? `?subject_id=${subjectId}` : ""}`),
  document: (id: number) => request<DocumentRecord>(`/documents/${id}`),
  documentPages: (id: number) =>
    request<{ document: DocumentRecord; pages: { page: number; text: string; heading: string }[] }>(`/documents/${id}/pages`),
  documentCapabilities: () => request<DocumentCapabilities>("/documents/capabilities"),
  documentDownloadUrl: (id: number) => `${BASE}/api/documents/${id}/download`,
  uploadDocument: (file: File, subjectId?: number, docKind?: string, onProgress?: (percent: number) => void) =>
    uploadWithProgress(file, subjectId, docKind, onProgress),
  deleteDocument: (id: number) => request<{ ok: boolean }>(`/documents/${id}`, { method: "DELETE" }),
  reprocessDocument: (id: number) => request<DocumentRecord>(`/documents/${id}/reprocess`, { method: "POST" }),
  searchDocuments: (query: string, subjectId?: number, topK = 8) =>
    request<SearchResult>("/documents/search", json({ query, subject_id: subjectId, top_k: topK })),

  parseSyllabus: (subjectId: number, documentId: number, useAi = true) =>
    request<{ count: number; topics: Topic[]; note: string }>(
      "/syllabus/parse",
      json({ subject_id: subjectId, document_id: documentId, use_ai: useAi }),
    ),
  topics: (subjectId?: number) => request<Topic[]>(`/syllabus/topics${subjectId ? `?subject_id=${subjectId}` : ""}`),
  createTopic: (body: { subject_id: number; title: string; module?: string; description?: string; priority?: string; marks?: number }) =>
    request<Topic>("/syllabus/topics", json(body)),
  updateTopic: (id: number, body: Record<string, unknown>) =>
    request<Topic>(`/syllabus/topics/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTopic: (id: number) => request<{ ok: boolean }>(`/syllabus/topics/${id}`, { method: "DELETE" }),
  coverage: (subjectId: number) => request<Coverage>(`/syllabus/coverage/${subjectId}`),
  library: () => request<LibraryOverview>("/syllabus/library"),
  librarySubject: (subjectId: number) => request<LibrarySubjectDetail>(`/syllabus/library/subjects/${subjectId}`),
  librarySearch: (query: string) => request<LibrarySearch>(`/syllabus/library/search?q=${encodeURIComponent(query)}`),
  libraryImport: (path: string) => request<LibraryBatch>("/syllabus/library/import", json({ path })),
  libraryImports: () => request<LibraryBatch[]>("/syllabus/library/imports"),
  libraryBatch: (id: number) => request<LibraryBatch>(`/syllabus/library/imports/${id}`),
  libraryUnindex: (documentId: number) => request<DocumentRecord>(`/syllabus/library/documents/${documentId}/unindex`, { method: "POST" }),
  libraryReparse: (documentId: number) => request<Record<string, unknown>>(`/syllabus/library/documents/${documentId}/reparse`, { method: "POST" }),
  libraryRebuild: () => request<{ count: number; failed: number; note: string }>("/syllabus/library/rebuild", { method: "POST" }),
  libraryManifestUrl: () => `${BASE}/api/syllabus/library/manifest`,

  aiStatus: () => request<AIStatus>("/ai/status"),
  testAI: () => request<{ ok: boolean; provider: string; message: string }>("/ai/test", { method: "POST" }),
  aiProviders: () => request<ProviderList>("/ai/providers"),
  aiModels: () => request<ModelList>("/ai/models", { method: "POST" }),
  aiUsage: (limit = 30) => request<AIUsageResponse>(`/ai/usage?limit=${limit}`),
  evaluateAnswer: (body: { question: string; answer: string; subject_id?: number; topic_id?: number }) =>
    request<EvaluationResult>("/ai/evaluate", json(body)),
  conversations: (subjectId?: number) =>
    request<ConversationSummary[]>(`/ai/conversations${subjectId ? `?subject_id=${subjectId}` : ""}`),
  conversation: (id: number) => request<ConversationDetail>(`/ai/conversations/${id}`),
  createConversation: (body: { subject_id?: number; title?: string; personality?: string }) =>
    request<{ id: number }>("/ai/conversations", json(body)),
  deleteConversation: (id: number) => request<{ ok: boolean }>(`/ai/conversations/${id}`, { method: "DELETE" }),
  chat: (body: {
    message: string;
    conversation_id?: number;
    subject_id?: number;
    topic_id?: number;
    personality?: string;
    mode?: string;
  }) => request<ChatResponse>("/ai/chat", json(body)),
  chatStream: (body: {
    message: string;
    conversation_id?: number;
    subject_id?: number;
    topic_id?: number;
    personality?: string;
    mode?: string;
  }, handlers: StreamHandlers, signal?: AbortSignal) => streamChat(body, handlers, signal),

  phases: () => request<PhaseInfo[]>("/teaching/phases"),
  topicProgress: (topicId: number) => request<TopicProgress>(`/teaching/${topicId}/progress`),
  teachPhase: (topicId: number, phase: number, regenerate = false, personality = "study_buddy") =>
    request<TeachingContent>(`/teaching/${topicId}/phase`, json({ phase, regenerate, personality })),
  resetTeaching: (topicId: number) => request<{ ok: boolean }>(`/teaching/${topicId}/reset`, { method: "POST" }),

  generateQuiz: (body: {
    subject_id: number;
    topic_id?: number;
    mode?: string;
    count?: number;
    difficulty?: string;
    title?: string;
  }) => request<Quiz>("/quizzes/generate", json(body)),
  quizzes: (subjectId?: number) => request<Quiz[]>(`/quizzes${subjectId ? `?subject_id=${subjectId}` : ""}`),
  quiz: (id: number) => request<Quiz>(`/quizzes/${id}`),
  submitQuiz: (id: number, answers: Record<string, string>, durationSeconds: number) =>
    request<QuizAttempt>(`/quizzes/${id}/submit`, json({ answers, duration_seconds: durationSeconds })),
  deleteQuiz: (id: number) => request<{ ok: boolean }>(`/quizzes/${id}`, { method: "DELETE" }),
  attempts: (subjectId?: number) => request<QuizAttempt[]>(`/quizzes/attempts${subjectId ? `?subject_id=${subjectId}` : ""}`),
  attempt: (id: number) => request<QuizAttempt>(`/quizzes/attempts/${id}`),
  savedQuestions: () => request<SavedQuestion[]>("/quizzes/saved"),
  saveQuestion: (body: Record<string, unknown>) => request<{ id: number }>("/quizzes/saved", json(body)),
  deleteSavedQuestion: (id: number) => request<{ ok: boolean }>(`/quizzes/saved/${id}`, { method: "DELETE" }),

  revisionStats: () => request<RevisionStats>("/revision/stats"),
  flashcards: (subjectId?: number) =>
    request<Flashcard[]>(`/revision/cards${subjectId ? `?subject_id=${subjectId}` : ""}`),
  dueFlashcards: () => request<Flashcard[]>("/revision/cards?due_only=true"),
  generateFlashcards: (subjectId: number, topicId?: number, limit = 12) =>
    request<Flashcard[]>("/revision/generate", json({ subject_id: subjectId, topic_id: topicId, limit })),
  reviewFlashcard: (id: number, grade: number) =>
    request<Flashcard>(`/revision/${id}/review`, json({ grade })),
  deleteFlashcard: (id: number) => request<{ ok: boolean }>(`/revision/${id}`, { method: "DELETE" }),

  exams: () => request<Exam[]>("/exams"),
  createExam: (body: { subject_id: number; title: string; exam_date: string; weight?: number; notes?: string }) =>
    request<Exam>("/exams", json(body)),
  deleteExam: (id: number) => request<{ ok: boolean }>(`/exams/${id}`, { method: "DELETE" }),
  generatePlan: (dailyMinutes: number, horizonDays: number) =>
    request<{ count: number; sessions: ScheduleSession[] }>(
      "/planner/generate",
      json({ daily_minutes: dailyMinutes, horizon_days: horizonDays }),
    ),
  plan: (days = 14) => request<ScheduleSession[]>(`/planner?days=${days}`),
  updateSchedule: (id: number, status: string) =>
    request<ScheduleSession>(`/planner/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  logStudy: (body: { minutes: number; subject_id?: number; topic_id?: number; kind?: string; notes?: string }) =>
    request<{ id: number; minutes: number }>("/study-sessions", json(body)),
  studySessions: (days = 7) => request<Record<string, unknown>[]>(`/study-sessions?days=${days}`),
  rankedTopics: () =>
    request<{ id: number; title: string; subject: string; priority: string; mastery: number; score: number; exam_date: string | null }[]>(
      "/planner/ranked-topics",
    ),

  labs: () => request<LabSummary[]>("/labs"),
  lab: (slug: string) => request<LabDetail>(`/labs/${slug}`),
  saveLabArtifact: (slug: string, code: string, language: string) =>
    request<{ ok: boolean }>(`/labs/${slug}/artifact`, { method: "PUT", body: JSON.stringify({ code, language }) }),

  settings: () => request<Settings>("/settings"),
  updateSettings: (body: Partial<Record<string, string>>) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
  reindex: () => request<{ ok: boolean; message: string }>("/settings/reindex", { method: "POST" }),

  notifications: () => request<Notification[]>("/notifications"),
  readNotification: (id: number) => request<{ ok: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  readAllNotifications: () => request<{ ok: boolean }>("/notifications/read-all", { method: "POST" }),
  deleteNotification: (id: number) => request<{ ok: boolean }>(`/notifications/${id}`, { method: "DELETE" }),

  backupUrl: () => `${BASE}/api/backup/download`,
  restoreBackup: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ ok: boolean; message: string; reload: boolean; counts?: Record<string, number> }>("/backup/restore", { method: "POST", body: form });
  },
};

interface StreamMeta {
  conversation_id: number;
  conversation_title: string;
  generator: string;
  sources: import("./types").Source[];
  user_message_id: number;
  mode: string;
}

interface StreamDone {
  message_id: number;
  conversation_id: number;
  conversation_title: string;
  generator: string;
  note: string;
  sources: import("./types").Source[];
  citations?: import("./types").CitationInfo;
}

export interface StreamHandlers {
  onMeta?: (meta: StreamMeta) => void;
  onDelta?: (text: string) => void;
  onError?: (detail: string) => void;
  onDone?: (done: StreamDone) => void;
}

function uploadWithProgress(
  file: File,
  subjectId: number | undefined,
  docKind: string | undefined,
  onProgress?: (percent: number) => void,
): Promise<DocumentRecord> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (subjectId) form.append("subject_id", String(subjectId));
    if (docKind) form.append("doc_kind", docKind);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/api/documents/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new ApiError("Could not reach the backend while uploading.", 0));
    xhr.onload = () => {
      let payload: unknown = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as DocumentRecord);
        return;
      }
      const data = payload as { detail?: unknown; auth_required?: unknown } | null;
      const detail = typeof data?.detail === "string" ? data.detail : `Upload failed (${xhr.status})`;
      if (xhr.status === 401 && data) unauthorized(data);
      reject(new ApiError(detail, xhr.status, xhr.status === 401));
    };
    xhr.send(form);
  });
}

async function streamChat(
  body: {
    message: string;
    conversation_id?: number;
    subject_id?: number;
    topic_id?: number;
    personality?: string;
    mode?: string;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
) {
  const response = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    let authRequired = response.status === 401;
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
      if (response.status === 401) {
        unauthorized(data);
        authRequired = Boolean(data.auth_required);
      }
    } catch { /* ignore */ }
    throw new ApiError(detail, response.status, authRequired);
  }
  if (!response.body) throw new ApiError("Streaming is not supported by this browser.", 0);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let payload: Record<string, unknown>;
        try { payload = JSON.parse(dataLines.join("\n")); } catch { continue; }
        if (event === "meta") handlers.onMeta?.(payload as unknown as StreamMeta);
        else if (event === "delta" && typeof payload.text === "string") handlers.onDelta?.(payload.text);
        else if (event === "error") handlers.onError?.(String(payload.detail || "AI provider error"));
        else if (event === "done") handlers.onDone?.(payload as unknown as StreamDone);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
