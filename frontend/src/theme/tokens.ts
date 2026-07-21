import type { ThemeConfig } from 'antd'

// This is the only source file allowed to contain hexadecimal colour values.
export const palette = {
  bg: '#f4f1e8',
  surface: '#fbfaf5',
  line: '#e3ddcb',
  ink: '#2b2a26',
  muted: '#6f6a5c',
  card: '#e9e4cf',
  cardEdge: '#d8d2b8',
  cardLabel: '#faf8ef',
  cardInk: '#3a3630',
  teamBlue: '#2f6fb0',
  teamBlueCard: '#3d7cbf',
  teamRed: '#c0392b',
  teamRedCard: '#cf4436',
  neutral: '#c9b98f',
  neutralCard: '#d8c79a',
  assassin: '#141414',
  assassinInk: '#f2efe6',
  good: '#3f8f5e',
  warn: '#c9962f',
  bad: '#c0392b',
} as const

export const antdTheme: ThemeConfig = {
  cssVar: {},
  hashed: false,
  token: {
    colorPrimary: palette.teamBlue,
    colorBgLayout: palette.bg,
    colorBgContainer: palette.surface,
    colorBorder: palette.line,
    colorText: palette.ink,
    colorTextSecondary: palette.muted,
    borderRadius: 12,
    fontFamily: 'Assistant, system-ui, sans-serif',
  },
}

export const cssVars = () =>
  Object.entries(palette)
    .map(([name, value]) => `--${name}: ${value};`)
    .join('\n')
