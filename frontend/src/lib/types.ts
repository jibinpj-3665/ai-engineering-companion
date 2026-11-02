export interface Subject {
  id: number;
  name: string;
  code: string;
  semester: string;
  department: string;
  description: string;
  color: string;
  academic_year?: string;
  credits?: number;
  ltp?: string;
  preamble?: string;
  prerequisites?: string;
  corequisites?: string;
  semester_source?: string;
  assessment?: Record<string, unknown>;
  books?: Record<string, string[]>;
  syllabus_updated_at?: string | null;
  created_at: string;
  topic_count?: number;
  mastered_count?: number;
  document_count?: number;
}

export type DocumentStatus = "uploading" | "queued" | "processing" | "extracting" | "indexing" | "ready" | "unindexed" | "failed";

export interface DocumentRecord {
  id: number;
  subject_id: number | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  stage: string;
  progress: number;
  error: string;
  page_count: number;
  doc_kind: string;
  sha256?: string;
  source_path?: string;
  source_identity?: string;
  academic_year?: string;
  semester?: string;
  semester_confidence?: string;
  import_batch_id?: number | null;
  version?: number;
  active?: boolean;
  created_at: string;
  processed_at: string | null;
  preview: { page: number; text: string }[];
}

export interface DocumentCapabilities {
  ocr_available: boolean;
  max_upload_mb: number;
  allowed_extensions: string[];
  note: string;
}

export interface Topic {
  id: number;
  subject_id: number;
  subject_name: string;
  module: string;
  module_id?: number | null;
  unit: string;
  topic_number?: string;
  content_type?: string;
  source_page?: number;
  source_document_id?: number | null;
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
  label?: string;
  cited?: boolean;
  document: string;
  document_id?: number;
  page: number;
  heading?: string;
  snippet: string;
  score?: number;
}

export interface CitationInfo {
  labels: string[];
  unknown_labels: string[];
  uncited: boolean;
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
  semesters?: SemesterProgress[];
  daily: DayPoint[];
  weak_topics: WeakTopic[];
  revision: RevisionStats;
  has_data: boolean;
}

export interface SemesterProgress {
  semester: string;
  academic_year: string;
  subjects: number;
  modules: number;
  topics: number;
  mastered: number;
  learned: number;
  in_progress: number;
  completion: number;
  credits: number;
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
  ai_provider: string;
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
  effective_embedding_mode?: "local" | "remote";
  effective_embedding_provider?: string;
  effective_embedding_model?: string;
  embedding_configured?: boolean;
  embedding_dimensions?: number;
  embedding_signature?: string;
  embedding_index?: EmbeddingIndex;
  needs_reindex?: boolean;
  key_source?: "environment" | "account" | "none";
  env_key_set?: boolean;
  env_keys_only?: boolean;
}

export interface EmbeddingIndex {
  signatures: Record<string, number>;
  total_chunks: number;
  matching_chunks: number;
  needs_reindex: boolean;
}

export interface AIStatus {
  provider: string;
  configured: boolean;
  model: string;
  base_url?: string;
  key_source?: string;
  env_key_set?: boolean;
  embedding_provider: string;
  embedding_model?: string;
  embedding_configured?: boolean;
  embedding_signature?: string;
  embedding_index?: EmbeddingIndex;
  needs_reindex?: boolean;
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
  error: string;
  sources: Source[];
  citations?: CitationInfo;
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

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  is_local: boolean;
  created_at: string | null;
}

export interface AuthStatus {
  auth_required: boolean;
  registration_allowed: boolean;
  smtp_configured: boolean;
  env_keys_only: boolean;
  provider_keys: Record<string, boolean>;
  user: AuthUser | null;
}

export interface ProviderPreset {
  id: string;
  label: string;
  base_url: string;
  model: string;
  embedding_model?: string;
  supports_remote_embeddings?: boolean;
  requires_key: boolean;
  note: string;
  env_key_set: boolean;
  selected: boolean;
}

export interface ProviderList {
  providers: ProviderPreset[];
  current: string;
  key_source: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  input_token_limit?: number | null;
  output_token_limit?: number | null;
}

export interface ModelList {
  provider: string;
  models: string[];
  chat_models: ModelInfo[];
  embedding_models: ModelInfo[];
  message: string;
}

export interface ModelDiscoveryInput {
  provider?: string;
  base_url?: string;
  api_key?: string;
  embedding_provider?: "local" | "remote";
}

export interface AITestPart {
  ok: boolean;
  skipped?: boolean;
  provider: string;
  model: string;
  message: string;
  signature?: string;
  dimensions?: number;
}

export interface AITestResult {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  chat: AITestPart;
  embedding: AITestPart;
}

export interface AIUsageLog {
  id: number;
  provider: string;
  model: string;
  operation: string;
  status: string;
  input_chars: number;
  output_chars: number;
  latency_ms: number;
  error: string;
  created_at: string;
}

export interface AIUsageResponse {
  summary: { requests: number; errors: number };
  logs: AIUsageLog[];
}

export interface EvaluationResult {
  generator: string;
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  corrected_answer: string;
  next_step: string;
  sources: Source[];
  mastery_recorded: boolean;
  note?: string;
}

export interface LibrarySemester {
  semester: string;
  subjects: number;
  modules: number;
  topics: number;
  completed_topics: number;
  mastered: number;
  documents: number;
  credits: number;
  progress: number;
}

export interface LibrarySubject extends Subject {
  module_count: number;
  topic_count: number;
  completed_topics: number;
  mastered_count: number;
  in_progress_count: number;
  outcome_count: number;
  document_count: number;
  progress: number;
}

export interface LibraryBatchFile {
  relative_path: string;
  source_path: string;
  filename: string;
  size_bytes: number;
  sha256: string;
  status: "imported" | "duplicate" | "unsupported" | "skipped" | "failed";
  document_id: number | null;
  subject_id: number | null;
  course_code: string;
  course_title: string;
  semester: string;
  academic_year: string;
  pages: number;
  modules: number;
  topics: number;
  course_outcomes: number;
  warnings: string[];
  message: string;
}

export interface LibraryBatch {
  id: number;
  source_root: string;
  status: string;
  total_files: number;
  imported_files: number;
  duplicate_files: number;
  unsupported_files: number;
  skipped_files: number;
  failed_files: number;
  error: string;
  manifest: LibraryBatchFile[];
  created_at: string | null;
  completed_at: string | null;
}

export interface LibraryOverview {
  semesters: LibrarySemester[];
  subjects: LibrarySubject[];
  totals: {
    subjects: number;
    semesters: number;
    modules: number;
    topics: number;
    documents: number;
    indexed_documents: number;
    import_batches: number;
  };
  recent_batches: LibraryBatch[];
  note: string;
}

export interface SyllabusModuleRecord {
  id: number;
  subject_id: number;
  document_id: number | null;
  number: number;
  label: string;
  title: string;
  description: string;
  lecture_hours: number;
  tutorial_hours: number;
  practical_hours: number;
  self_study_hours: number;
  page_start: number;
  page_end: number;
  topic_count: number;
  mastered: number;
  learned: number;
  in_progress: number;
  topic_ids: number[];
}

export interface CourseOutcome {
  id: number;
  subject_id: number;
  document_id: number | null;
  code: string;
  description: string;
  bloom_level: string;
  po_mapping: (number | null)[];
  page: number;
}

export interface LibrarySubjectDetail {
  subject: Subject;
  modules: SyllabusModuleRecord[];
  course_outcomes: CourseOutcome[];
  topics: Topic[];
  documents: DocumentRecord[];
  progress: {
    topics: number;
    modules: number;
    mastered: number;
    learned: number;
    in_progress: number;
    not_started: number;
    completion: number;
  };
  note: string;
}

export interface LibrarySearchResult {
  kind: "subject" | "module" | "topic";
  subject_id: number;
  subject: string;
  course_code: string;
  semester: string;
  title: string;
  module: string;
  page: number | null;
  document: string;
  document_id: number | null;
}

export interface LibrarySearch {
  results: LibrarySearchResult[];
  note: string;
}
