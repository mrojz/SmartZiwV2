import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        // eslint-disable-next-line no-console
        console.error('ErrorBoundary caught an error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback || (
                <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                    <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{this.state.error?.message || 'Please reload the page.'}</p>
                    <button
                        type="button"
                        onClick={() => window.location.reload()}
                        className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    >
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
