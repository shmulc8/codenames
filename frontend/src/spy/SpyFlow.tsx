import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Alert, Button, Input, Modal, Spin, Typography } from 'antd'
import { Camera, RefreshCw } from 'lucide-react'
import { api } from '../api/client.ts'
import type { SpyCoveredWord } from '../api/types.ts'
import { prepareSpyImage } from './image.ts'
import './spy.css'

type SpyStage = 'capture' | 'verify' | 'decision' | 'static' | 'monitoring'

const BOARD_SIZE = 25
const SCAN_INTERVAL_MS = 60_000

function boardWords(words: string[]): string[] {
  return Array.from({ length: BOARD_SIZE }, (_, index) => words[index] ?? '')
}

function errorMessage(): string {
  return 'הסריקה נכשלה. נסו שוב.'
}

interface SpyBoardProps {
  words: string[]
  covered: SpyCoveredWord[]
}

function SpyBoard({ words, covered }: SpyBoardProps) {
  const coveredByWord = new Map(covered.map((entry) => [entry.word, entry.color]))

  return (
    <div className="spy-word-grid" role="grid" aria-label="לוח מרגל" dir="rtl">
      {words.map((word, index) => {
        const color = coveredByWord.get(word)
        return (
          <div
            className={`spy-board-card${color ? ` is-covered-${color}` : ''}`}
            key={`${word}-${index}`}
            role="gridcell"
          >
            {word || '—'}
          </div>
        )
      })}
    </div>
  )
}

export function SpyFlow() {
  const [stage, setStage] = useState<SpyStage>('capture')
  const [words, setWords] = useState<string[]>([])
  const [confirmedWords, setConfirmedWords] = useState<string[]>([])
  const [covered, setCovered] = useState<SpyCoveredWord[]>([])
  const [initialError, setInitialError] = useState<string | null>(null)
  const [monitorError, setMonitorError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [monitoringScan, setMonitoringScan] = useState(false)
  const [cameraUnavailable, setCameraUnavailable] = useState(false)
  const [logLine, setLogLine] = useState('עדיין לא זוהו קלפים מכוסים חדשים.')
  const initialInputRef = useRef<HTMLInputElement>(null)
  const repeatInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scanInFlightRef = useRef(false)

  const applyMonitoringResult = useCallback((nextCovered: SpyCoveredWord[]) => {
    setCovered((currentCovered) => {
      const knownWords = new Set(currentCovered.map((entry) => entry.word))
      const newlyCovered = nextCovered.filter((entry) => !knownWords.has(entry.word))
      setLogLine(
        newlyCovered.length > 0
          ? `כוסו כעת: ${newlyCovered.map((entry) => entry.word).join(' · ')}`
          : 'לא זוהו קלפים מכוסים חדשים בסריקה האחרונה.',
      )
      return nextCovered
    })
  }, [])

  const scanMonitoringImage = useCallback(async (image: string) => {
    if (scanInFlightRef.current || confirmedWords.length !== BOARD_SIZE) return

    scanInFlightRef.current = true
    setMonitoringScan(true)
    setMonitorError(null)
    try {
      const response = await api.spyScan({ image, words: confirmedWords })
      applyMonitoringResult(response.covered ?? [])
    } catch {
      setMonitorError(errorMessage())
    } finally {
      scanInFlightRef.current = false
      setMonitoringScan(false)
    }
  }, [applyMonitoringResult, confirmedWords])

  const scanInitialFile = useCallback(async (file: File) => {
    setLoading(true)
    setInitialError(null)
    try {
      const image = await prepareSpyImage(file)
      const response = await api.spyScan({ image })
      setWords(boardWords(response.words))
      setStage('verify')
    } catch {
      setInitialError(errorMessage())
    } finally {
      setLoading(false)
    }
  }, [])

  const onInitialFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (file) void scanInitialFile(file)
  }

  const onRepeatFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!file) return

    try {
      const image = await prepareSpyImage(file)
      await scanMonitoringImage(image)
    } catch {
      setMonitorError(errorMessage())
    }
  }

  const captureVideoFrame = useCallback(() => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    void scanMonitoringImage(canvas.toDataURL('image/jpeg', 0.8))
  }, [scanMonitoringImage])

  useEffect(() => {
    if (stage !== 'monitoring') return

    let cancelled = false
    let stream: MediaStream | null = null
    let intervalId: number | null = null
    const video = videoRef.current

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setCameraUnavailable(true)
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (!video) {
          stream.getTracks().forEach((track) => track.stop())
          if (!cancelled) setCameraUnavailable(true)
          return
        }
        video.srcObject = stream
        await video.play()
        intervalId = window.setInterval(captureVideoFrame, SCAN_INTERVAL_MS)
      } catch {
        if (!cancelled) setCameraUnavailable(true)
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      if (intervalId !== null) window.clearInterval(intervalId)
      if (video) video.srcObject = null
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [captureVideoFrame, stage])

  const confirmBoard = () => {
    const nextWords = boardWords(words).map((word) => word.trim())
    if (nextWords.some((word) => !word)) {
      setInitialError('יש למלא את כל 25 המילים לפני אישור הלוח.')
      return
    }
    setInitialError(null)
    setConfirmedWords(nextWords)
    setStage('decision')
  }

  const startMonitoring = () => {
    setCameraUnavailable(false)
    setMonitorError(null)
    setStage('monitoring')
  }

  return (
    <main className="spy-flow" dir="rtl">
      <section className="spy-panel" aria-labelledby="spy-title">
        <div>
          <Typography.Title id="spy-title" level={2}>מצב מרגל</Typography.Title>
          <Typography.Text type="secondary">צלמו את לוח המשחק כדי לזהות ולעקוב אחר קלפים מכוסים.</Typography.Text>
        </div>

        {stage === 'capture' && (
          <>
            {initialError && <Alert type="error" showIcon message={initialError} />}
            <input
              ref={initialInputRef}
              accept="image/*"
              capture="environment"
              hidden
              type="file"
              onChange={onInitialFileChange}
            />
            <Button
              className="spy-capture-button"
              icon={<Camera />}
              loading={loading}
              size="large"
              type="primary"
              block
              onClick={() => initialInputRef.current?.click()}
            >
              צלמו את הלוח
            </Button>
            {loading && <Spin tip="מזהה את מילות הלוח…" />}
          </>
        )}

        {stage === 'verify' && (
          <>
            <Typography.Text>בדקו ותקנו את המילים לפני אישור הלוח.</Typography.Text>
            {initialError && <Alert type="error" showIcon message={initialError} />}
            <div className="spy-word-grid" role="grid" aria-label="עריכת מילות הלוח" dir="rtl">
              {boardWords(words).map((word, index) => (
                <Input
                  aria-label={`מילה ${index + 1}`}
                  dir="rtl"
                  key={index}
                  value={word}
                  onChange={(event) => setWords((current) => {
                    const next = boardWords(current)
                    next[index] = event.target.value
                    return next
                  })}
                />
              ))}
            </div>
            <Button type="primary" size="large" block onClick={confirmBoard}>אישור הלוח</Button>
          </>
        )}

        {stage === 'static' && <SpyBoard words={confirmedWords} covered={covered} />}

        {stage === 'monitoring' && (
          <>
            {cameraUnavailable ? (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="אין גישה למצלמה"
                  description="אפשר להמשיך בסריקה ידנית של תמונת הלוח."
                />
                <input
                  ref={repeatInputRef}
                  accept="image/*"
                  capture="environment"
                  hidden
                  type="file"
                  onChange={onRepeatFileChange}
                />
                <Button icon={<RefreshCw />} loading={monitoringScan} block onClick={() => repeatInputRef.current?.click()}>
                  סרקו שוב
                </Button>
              </>
            ) : (
              <>
                <video ref={videoRef} className="spy-video" autoPlay muted playsInline aria-label="תצוגה חיה של לוח המשחק" />
                <Typography.Text type="secondary">הסריקה הבאה תתבצע בעוד דקה.</Typography.Text>
              </>
            )}
            {monitoringScan && <Spin tip="סורק את הלוח…" />}
            {monitorError && <Alert type="error" showIcon message={monitorError} />}
            <SpyBoard words={confirmedWords} covered={covered} />
            <div className="spy-log" aria-live="polite">{logLine}</div>
          </>
        )}
      </section>

      <Modal
        open={stage === 'decision'}
        title="מעקב אחרי הלוח?"
        okText="כן, להתחיל מעקב"
        cancelText="לא, להציג את הלוח"
        closable={false}
        maskClosable={false}
        onOk={startMonitoring}
        onCancel={() => setStage('static')}
      >
        אפשר להשאיר את המצלמה פתוחה, והלוח ייסרק פעם בדקה כדי לזהות קלפים שכוסו.
      </Modal>
    </main>
  )
}
