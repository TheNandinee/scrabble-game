import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('💥 ErrorBoundary caught:', error);
    console.error('📍 Component stack:', info?.componentStack);
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {String(this.state.error?.message || this.state.error)}
          </p>
          {this.state.info?.componentStack && (
            <details style={{ textAlign: 'left', marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                Show component stack
              </summary>
              <pre style={{
                fontSize: 11,
                background: 'var(--bg)',
                padding: 12,
                borderRadius: 8,
                overflow: 'auto',
                color: 'var(--muted)',
                marginTop: 8,
              }}>
                {this.state.info.componentStack}
              </pre>
            </details>
          )}
          <button className="btn primary" onClick={() => window.location.reload()} style={{ marginTop: 16 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}