import { Component, type ReactNode } from 'react';

/** Keeps one broken view from blanking the whole app; remounts (resetKey) when the user switches view or bot. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="chat chat--empty">
        <div className="empty-chat">
          <div className="empty-chat__sub">Something went wrong in this view.</div>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </main>
    );
  }
}
