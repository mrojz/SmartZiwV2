import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './components/ThemeProvider'
import { PageHeaderProvider } from './components/PageHeaderContext'

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <ThemeProvider>
            <PageHeaderProvider>
                <App />
            </PageHeaderProvider>
        </ThemeProvider>
    </StrictMode>,
)

