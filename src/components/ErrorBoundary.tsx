import React, { ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
          <div className="card max-w-lg p-10 shadow-2xl shadow-navy/5 border-t-4 border-red-500">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-8 animate-bounce">
              <AlertCircle size={40} />
            </div>
            <h2 className="text-3xl font-serif font-bold text-navy mb-4">Something went wrong</h2>
            <p className="text-text-muted mb-8 leading-relaxed">
              We encountered an unexpected error while loading this page. 
              Our team has been notified and we're working on a fix.
            </p>
            
            <div className="bg-bg p-4 rounded-xl mb-10 text-left overflow-x-auto border border-border">
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">Technical Details</p>
              <code className="text-xs text-red-600 font-mono break-all">
                {this.state.error?.message || 'Unknown rendering error'}
              </code>
            </div>

            <button 
              onClick={this.handleReset}
              className="btn-primary w-full flex items-center justify-center gap-2 py-4"
            >
              <RefreshCw size={20} /> Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
