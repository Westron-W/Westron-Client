import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Westron renderer failed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="renderer-error" role="alert">
          <div className="renderer-error-card">
            <div className="eyebrow">WSTRON LAUNCHER</div>
            <h1>ArayÃ¼z yÃ¼klenemedi</h1>
            <p>BaÅŸlangÄ±Ã§ sÄ±rasÄ±nda bir hata oluÅŸtu. UygulamayÄ± yeniden baÅŸlatÄ±n.</p>
            <code>{this.state.error.message}</code>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
