import type {
  AIStatus,
  AnalyticsData,
  ChatResponse,
  ConversationDetail,
  ConversationSummary,
  Coverage,
  DashboardData,
  DocumentRecord,
  Exam,
  Flashcard,
  LabDetail,
  LabSummary,
  Notification,
  PhaseInfo,
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
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((item: { msg: string }) => item.msg).join(", ");
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
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
  uploadDocument: (file: File, subjectId?: number, docKind?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (subjectId) form.append("subject_id", String(subjectId));
    if (docKind) form.append("doc_kind", docKind);
    return request<DocumentRecord>("/documents/upload", { method: "POST", body: form });
  },
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

  aiStatus: () => request<AIStatus>("/ai/status"),
  testAI: () => request<{ ok: boolean; provider: string; message: string }>("/ai/test", { method: "POST" }),
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
    return request<{ ok: boolean; message: string; reload: boolean }>("/backup/restore", { method: "POST", body: form });
  },
};
