import { useEffect, useState } from 'react'
import { Badge, Card, Layout, Space, Spin, Typography } from 'antd'
import { Bot, HeartPulse } from 'lucide-react'
import { api } from './api/client.ts'
import type { HealthResponse } from './api/types.ts'
import './App.css'

const { Header, Content, Footer } = Layout

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        <Card className="welcome-card" bordered>
          <Space direction="vertical" size="middle">
            <Typography.Title level={1}>מוכנים למשחק</Typography.Title>
            <Typography.Paragraph>
              שלד React RTL עם ערכת צבעים מרכזית מוכן לשלב הבא של הלוח.
            </Typography.Paragraph>
          </Space>
        </Card>
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

export default App
