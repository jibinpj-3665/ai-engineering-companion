export interface Subject {
  id: number;
  name: string;
  code: string;
  semester: string;
  department: string;
  description: string;
  color: string;
  created_at: string;
  topic_count?: number;
  mastered_count?: number;
  document_count?: number;
}

export interface DocumentRecord {
  id: number;
  subject_id: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: "queued" | "processing" | "ready" | "failed";
  error: string;
  page_count: number;
  doc_kind: string;
  created_at: string;
  processed_at: string | null;
  preview: { page: number; text: string }[];
}

export interface Topic {
  id: number;
  subject_id: number;
  subject_name: string;
  module: string;
  unit: string;
  title: string;
  description: string;
  learning_outcome: string;
  priority: "high" | "medium" | "low";
  priority_score: number;
  priority_reason: string;
  marks: number;
  exam_frequency: number;
  status: "not_started" | "in_progress" | "learned" | "mastered";
  mastery_score: number;
  last_studied_at: string | null;
  created_at: string;
}

export interface Source {
  index?: number;
  document: string;
  document_id?: number;
  page: number;
  heading?: string;
  snippet: string;
  score?: number;
}

export interface SearchResult {
  sources: Source[];
  context: string;
  mode: string;
  note: string;
}

export interface CoverageEntry {
  topic_id: number;
  title: string;
  module: string;
  matches: Source[];
}

export interface Coverage {
  total_topics: number;
  covered: number;
  missing_count: number;
  mapped: CoverageEntry[];
  missing: CoverageEntry[];
  note: string;
}

export interface SubjectProgress {
  id: number;
  name: string;
  code: string;
  color: string;
  semester: string;
  topics: number;
  mastered: number;
  learned: number;
  in_progress: number;
  completion: number;
  average_mastery: number;
  documents: number;
  quiz_average: number;
  exam_date: string | null;
  exam_title: string | null;
  readiness: number;
}

export interface DayPoint {
  date: string;
  label: string;
  minutes: number;
}

export interface WeakTopic {
  id: number;
  title: string;
  module: string;
  priority: string;
  mastery: number;
  subject_id: number;
  status: string;
}

export interface RevisionStats {
  total: number;
  due_today: number;
  overdue: number;
  mastered: number;
  retention: number;
  average_ease: number;
}

export interface DashboardData {
  greeting: string;
  student_name: string;
  daily_goal_minutes: number;
  today_minutes: number;
  mission: {
    kind: string;
    title: string;
    detail: string;
    action: string;
    topic_id: number | null;
  } | null;
  continue_topic: {
    id: number;
    title: string;
    module: string;
    subject_id: number;
    subject: string;
    mastery: number;
    priority: string;
    status: string;
  } | null;
  upcoming_exams: {
    id: number;
    title: string;
    subject: string;
    date: string;
    days_left: number;
  }[];
  today_plan: {
    id: number;
    start_time: string;
    duration_minutes: number;
    kind: string;
    status: string;
    rationale: string;
    topic_id: number | null;
  }[];
  unread_notifications: number;
  stats: {
    hours_week: number;
    hours_today: number;
    streak_days: number;
    mastered_topics: number;
    topics_mastered_high: number;
    quiz_average: number;
    due_flashcards: number;
    exam_readiness: number;
  };
  subjects: SubjectProgress[];
  daily: DayPoint[];
  weak_topics: WeakTopic[];
  revision: RevisionStats;
  has_data: boolean;
}

export interface AnalyticsData {
  hours_week: number;
  hours_today: number;
  total_topics: number;
  studied_topics: number;
  mastered_topics: number;
  mastered_high: number;
  quiz_attempts: number;
  quiz_average: number;
  streak_days: number;
  revision: RevisionStats;
  subjects: SubjectProgress[];
  daily: DayPoint[];
  weak_topics: WeakTopic[];
  recent_attempts: {
    id: number;
    quiz_id: number;
    percent: number;
    score: number;
    max_score: number;
    completed_at: string;
  }[];
  exam_readiness: number;
  readiness_note: string;
}

export interface QuizQuestion {
  id: number;
  qtype: string;
  prompt: string;
  options: string[];
  marks: number;
  source: Source | Record<string, never>;
  position: number;
}

export interface Quiz {
  id: number;
  subject_id: number;
  topic_id: number | null;
  title: string;
  mode: string;
  difficulty: string;
  generator: string;
  duration_minutes: number;
  created_at: string;
  question_count: number;
  questions?: QuizQuestion[];
}

export interface FeedbackEntry {
  question_id: number;
  qtype: string;
  prompt: string;
  student_answer: string;
  correct_answer: string;
  explanation: string;
  options: string[];
  source: Source | Record<string, never>;
  score: number;
  marks: number;
  correct: boolean;
  note: string;
  improvement: string;
}

export interface QuizAttempt {
  id: number;
  quiz_id: number;
  quiz_title: string;
  subject_id: number | null;
  topic_id: number | null;
  score: number;
  max_score: number;
  percent: number;
  duration_seconds: number;
  completed_at: string;
  feedback: FeedbackEntry[];
}

export interface Flashcard {
  id: number;
  subject_id: number | null;
  subject_name: string;
  topic_id: number | null;
  topic_title: string;
  front: string;
  back: string;
  source: Record<string, unknown>;
  ease: number;
  interval_days: number;
  repetitions: number;
  due_date: string;
  last_reviewed_at: string | null;
  total_reviews: number;
  lapses: number;
}

export interface Exam {
  id: number;
  subject_id: number;
  subject_name: string;
  title: string;
  exam_date: string;
  days_left: number;
  weight: number;
  notes: string;
}

export interface ScheduleSession {
  id: number;
  subject_id: number | null;
  topic_id: number | null;
  date: string;
  start_time: string;
  duration_minutes: number;
  kind: string;
  status: string;
  rationale: string;
  subject_name?: string;
  topic_title?: string;
}

export interface Notification {
  id: number;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
}

export interface Settings {
  ai_provider: "offline" | "openai" | "openai_compatible" | "local";
  ai_base_url: string;
  ai_api_key: string;
  ai_model: string;
  ai_embedding_model: string;
  ai_temperature: string;
  ai_max_tokens: string;
  embedding_provider: "local" | "remote";
  local_base_url: string;
  local_model: string;
  student_name: string;
  accent: string;
  theme: "dark" | "light";
  daily_goal_minutes: string;
  personality: string;
  voice_enabled: string;
  onboarding_complete: string;
  ai_api_key_set?: boolean;
  ai_configured?: boolean;
  effective_base_url?: string;
  effective_model?: string;
}

export interface AIStatus {
  provider: string;
  configured: boolean;
  model: string;
  embedding_provider: string;
  indexed_chunks: number;
  ready_documents: number;
  message: string;
}

export interface ConversationSummary {
  id: number;
  subject_id: number | null;
  title: string;
  personality: string;
  updated_at: string;
  preview: string;
  message_count: number;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: Source[];
  mode: string;
  created_at: string;
}

export interface ConversationDetail {
  id: number;
  subject_id: number | null;
  title: string;
  personality: string;
  messages: ChatMessage[];
}

export interface ChatResponse {
  conversation_id: number;
  conversation_title: string;
  generator: string;
  note: string;
  sources: Source[];
  message: {
    id: number;
    role: string;
    content: string;
    created_at: string;
  };
}

export interface PhaseInfo {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
}

export interface TeachingContent {
  phase: number;
  phases: PhaseInfo[];
  content: string;
  sources: Source[];
  generator: string;
  viewed_phases: number[];
  progress_percent: number;
  mastery_passed: boolean;
  cached: boolean;
  note: string;
}

export interface TopicProgress {
  topic: Topic;
  phases: PhaseInfo[];
  viewed_phases: number[];
  cached_phases: number[];
  progress_percent: number;
  mastery_passed: boolean;
  note: string;
}

export interface LabSummary {
  slug: string;
  title: string;
  domain: string;
  difficulty: string;
  duration_minutes: number;
  language: string;
  tools: string[];
}

export interface LabDetail extends LabSummary {
  objective: string;
  components: string[];
  theory: string;
  diagram: string;
  algorithm: string[];
  code: string;
  code_explanation: string[];
  expected_output: string;
  result: string;
  troubleshooting: string[];
  viva: string[];
  ltspice: string;
  disclaimer: string;
  saved_code: string;
  saved_language: string;
  saved_at: string | null;
}

export interface SavedQuestion {
  id: number;
  subject_id: number | null;
  topic_id: number | null;
  qtype: string;
  prompt: string;
  answer: string;
  explanation: string;
  source: Record<string, unknown>;
  created_at: string;
}
