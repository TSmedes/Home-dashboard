import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  name: string;
}

/**
 * One boundary per widget. A render crash in the task list must not take the
 * clock off the wall with it.
 */
export class WidgetErrorBoundary extends Component<Props, { message: string | null }> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`widget "${this.props.name}" crashed`, error, info);
  }

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="widget-message">
        <p>This widget stopped working.</p>
        <p className="widget-message__detail">{this.state.message}</p>
      </div>
    );
  }
}
