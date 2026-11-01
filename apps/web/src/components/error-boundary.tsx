import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@nocoo/basalt";
import { RotateCcw, TriangleAlert } from "lucide-react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short name of the area, shown in the fallback ("Topology canvas"). */
  label: string;
  /** Changing any key clears the error and renders the children again. */
  resetKeys?: readonly unknown[];
  className?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  keys: readonly unknown[];
}

function sameKeys(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

/** Keeps a render error local: shows a fallback with a retry instead of blanking the app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, keys: this.props.resetKeys ?? [] };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    const keys = props.resetKeys ?? [];
    if (sameKeys(keys, state.keys)) return null;
    return { keys, error: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label} failed to render`, error, info.componentStack);
  }

  retry = () => this.setState({ error: null });

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${this.props.className ?? ""}`}>
        <TriangleAlert className="h-6 w-6 text-amber-500" aria-hidden />
        <p className="text-sm font-semibold">{this.props.label} hit an error</p>
        <p className="max-w-md break-words font-mono text-xs text-basalt-muted-foreground">{error.message || String(error)}</p>
        <Button variant="outline" size="sm" onClick={this.retry}><RotateCcw className="h-3.5 w-3.5" />Try again</Button>
      </div>
    );
  }
}
