import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import heIL from 'antd/locale/he_IL'
import 'antd/dist/reset.css'
import './index.css'
import App from './App.tsx'
import { antdTheme, cssVars } from './theme/tokens.ts'

const tokenStyles = document.createElement('style')
tokenStyles.textContent = `:root {${cssVars()}}`
document.head.appendChild(tokenStyles)

if (import.meta.env.DEV) {
  void import('react-grab')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider direction="rtl" locale={heIL} theme={antdTheme}>
      <App />
    </ConfigProvider>
  </StrictMode>,
)
