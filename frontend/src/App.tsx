import { useEffect, useState } from 'react'
import { Badge, Button, Layout, Space, Spin, Typography } from 'antd'
import { Bot, Eye, EyeOff, HeartPulse } from 'lucide-react'
import { api } from './api/client.ts'
import type { HealthResponse } from './api/types.ts'
import { Board } from './components/board/Board.tsx'
import { CountChips } from './components/board/CountChips.tsx'
import { GameProvider, useGame } from './state/GameProvider.tsx'
import './App.css'

const { Header, Content, Footer } = Layout

function GameShell() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { state, dispatch, loadDeal } = useGame()

  useEffect(() => {
    let active = true

    void api.health()
      .then((result) => {
        if (active) setHealth(result)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'לא ניתן להתחבר לשרת')
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    void loadDeal()
  }, [loadDeal])

  const status = health ? 'success' : error ? 'error' : 'processing'
  const statusText = health
    ? JSON.stringify(health)
    : error ?? 'בודק את חיבור ה־API…'

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <Space size="middle">
          <Bot aria-hidden="true" size={27} strokeWidth={1.75} />
          <div>
            <Typography.Title level={2}>קופיילוט · שם קוד</Typography.Title>
            <Typography.Text type="secondary">עוזר אימון למשחק הקופסה</Typography.Text>
          </div>
        </Space>
      </Header>

      <Content className="app-content">
        <section className="board-stage" aria-labelledby="board-title">
          <div className="board-stage-heading">
            <div>
              <Typography.Title id="board-title" level={1}>הלוח</Typography.Title>
              <Typography.Text type="secondary">לוח הדגמה · לחיצה על קלף חושפת אותו</Typography.Text>
            </div>
            <Button
              icon={state.revealed.size === state.words.length && state.words.length > 0 ? <EyeOff /> : <Eye />}
              onClick={() => dispatch({
                type: 'REVEAL_ALL',
                revealed: state.revealed.size !== state.words.length,
              })}
              disabled={state.words.length === 0}
            >
              {state.revealed.size === state.words.length && state.words.length > 0 ? 'הסתר הכול' : 'חשוף הכול'}
            </Button>
          </div>
          <CountChips />
          {state.busy ? <Spin aria-label="טוען לוח" /> : <Board />}
          {state.error && <Typography.Text className="board-note">{state.error}</Typography.Text>}
        </section>
      </Content>

      <Footer className="status-footer" aria-live="polite">
        <Space size="small" align="start">
          <HeartPulse aria-hidden="true" size={18} strokeWidth={1.75} />
          <Badge status={status} text={health || error ? 'מצב API' : <Spin size="small" />} />
          <Typography.Text className="health-result">{statusText}</Typography.Text>
        </Space>
      </Footer>
    </Layout>
  )
}

function App() {
  return (
    <GameProvider>
      <GameShell />
    </GameProvider>
  )
}

export default App
