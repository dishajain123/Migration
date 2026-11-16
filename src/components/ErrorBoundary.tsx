import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

interface Props { children: ReactNode; resetKey?: string }
interface State { error: Error | null }

/** Catches render errors so one broken screen does not blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) { console.error('UI error', error, info.componentStack); }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 rounded-md border border-bad bg-badbg p-4 text-sm text-bad">
        <div className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> This screen failed to render</div>
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs">{this.state.error.message}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
