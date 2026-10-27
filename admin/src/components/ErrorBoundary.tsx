import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Shows a message instead of a white screen when a render error occurs. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: 24,
            fontFamily: 'system-ui, sans-serif',
            background: '#f8fafc',
            color: '#0f172a',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: '0.9rem', color: '#475569', margin: 0, maxWidth: 560 }}>
            {this.state.error.message || 'Unexpected application error.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '9px 18px',
              borderRadius: 10,
              border: 'none',
              background: '#FF6467',
              color: '#ffffff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
