import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Catches any render/lifecycle error in a page and shows a recovery UI
 * instead of a blank white screen.
 *
 * Usage: give it a `resetKey` prop (e.g. pathname) so it auto-resets on
 * route change — a crash on one page never blocks another.
 */
export default class PageErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[PageErrorBoundary]', error.message, info.componentStack);
  }

  // Reset when the parent passes a new resetKey (i.e. the route changed)
  static getDerivedStateFromProps(props, state) {
    if (state.resetKey !== props.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5 px-6 text-center">
          <div className="p-4 rounded-2xl bg-red-500/10 border border-red-700/30">
            <AlertTriangle size={32} className="text-red-500/70 mx-auto" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200 mb-1">This page ran into an error</p>
            <p className="text-xs text-slate-500 max-w-sm">{this.state.error.message}</p>
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-slate-300 text-sm font-medium transition-colors"
          >
            <RefreshCw size={13} /> Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
