import { createContext, useContext, useState, useCallback } from 'react';

const PageHeaderContext = createContext({
    title: '',
    subtitle: '',
    action: null,
    setPageHeader: () => {},
    clearPageHeader: () => {},
});

export function PageHeaderProvider({ children }) {
    const [state, setState] = useState({ title: '', subtitle: '', action: null });

    const setPageHeader = useCallback(({ title, subtitle, action }) => {
        setState({
            title: title ?? '',
            subtitle: subtitle ?? '',
            action: action ?? null,
        });
    }, []);

    const clearPageHeader = useCallback(() => {
        setState({ title: '', subtitle: '', action: null });
    }, []);

    return (
        <PageHeaderContext.Provider
            value={{
                title: state.title,
                subtitle: state.subtitle,
                action: state.action,
                setPageHeader,
                clearPageHeader,
            }}
        >
            {children}
        </PageHeaderContext.Provider>
    );
}

export function usePageHeader() {
    const context = useContext(PageHeaderContext);
    if (!context) {
        throw new Error('usePageHeader must be used within a PageHeaderProvider');
    }
    return context;
}
