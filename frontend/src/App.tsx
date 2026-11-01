import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { AlertTriangle, Compass } from "lucide-react";
import { AppShell } from "./components/layout/AppShell";
import { Button } from "./components/ui/Button";
import { PageLoader } from "./components/ui/Spinner";
import { useApp } from "./contexts/AppContext";
import Dashboard from "./pages/Dashboard";
import Subjects from "./pages/Subjects";
import Documents from "./pages/Documents";
import Syllabus from "./pages/Syllabus";
import SyllabusLibrary from "./pages/SyllabusLibrary";
import Tutor from "./pages/Tutor";
import Learn from "./pages/Learn";
import Practice from "./pages/Practice";
import Revision from "./pages/Revision";
import Planner from "./pages/Planner";
import Analytics from "./pages/Analytics";
import Labs from "./pages/Labs";
import LabDetail from "./pages/LabDetail";
import Visuals from "./pages/Visuals";
import Settings from "./pages/Settings";
import { AuthPage } from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="glass-panel max-w-lg p-8 text-center">
            <AlertTriangle className="mx-auto mb-4 h-9 w-9 text-danger" />
            <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">The interface hit an unexpected error. Your study data is safe on this device.</p>
            <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-left text-[10px] text-muted-foreground">{this.state.error.message}</pre>
            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={() => { this.setState({ error: null }); window.location.href = "/"; }}>Back to dashboard</Button>
              <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 rounded-2xl border border-primary/25 bg-primary/[0.08] p-4 text-primary"><Compass size={28} /></div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold">This page does not exist</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">The route may have moved. Head back to your dashboard to continue studying.</p>
      <Link to="/" className="mt-5"><Button>Back to dashboard</Button></Link>
    </div>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const { loading, authRequired, user } = useApp();
  if (loading) return <PageLoader label="Securing your workspace" />;
  if (authRequired && !user) return <AuthPage />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route element={<AuthGate><AppShell /></AuthGate>}>
          <Route index element={<Dashboard />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="documents" element={<Documents />} />
          <Route path="syllabus" element={<Syllabus />} />
          <Route path="syllabus-library" element={<SyllabusLibrary />} />
          <Route path="tutor" element={<Tutor />} />
          <Route path="learn" element={<Learn />} />
          <Route path="learn/:topicId" element={<Learn />} />
          <Route path="practice" element={<Practice />} />
          <Route path="revision" element={<Revision />} />
          <Route path="planner" element={<Planner />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="labs" element={<Labs />} />
          <Route path="labs/:slug" element={<LabDetail />} />
          <Route path="visuals" element={<Visuals />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
