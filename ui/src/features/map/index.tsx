import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { postSpace } from '../../api/client';
import { RoleIcon, showToast } from '../../components';
import { liveBoard, useAppStore } from '../../state/store';
import type { BoardPayload, ReadEntry, Role, SpaceResponse, TeamColor } from '../../types/api';
import { getRememberedCheckResult } from '../check/result-cache';
import './styles.css';

const VIEWBOX_SIZE = 600;
const MAP_PADDING = 46;
const MAP_SURFACE_INSET = 1;
const REQUEST_DEBOUNCE_MS = 400;

const roleLabels: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

const roleShapes: Record<Role, string> = {
  red: '●',
  blue: '●',
  neutral: '−',
  assassin: '☠',
};

const mapCache = new Map<string, SpaceResponse>();

interface Point {
  x: number;
  y: number;
}

interface DotData extends Point {
  coord: [number, number];
  distance: number;
  role: Role;
  score: number;
  target: boolean;
  word: string;
}

function toPoint(coord: [number, number], viewBoxWidth: number): Point {
  const usableWidth = viewBoxWidth - MAP_PADDING * 2;
  const usableHeight = VIEWBOX_SIZE - MAP_PADDING * 2;
  return {
    x: MAP_PADDING + ((coord[0] + 1) / 2) * usableWidth,
    y: MAP_PADDING + (1 - (coord[1] + 1) / 2) * usableHeight,
  };
}

function distanceBetween(left: [number, number], right: [number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function cacheKey(board: BoardPayload, target: TeamColor, clue: string | null): string {
  return JSON.stringify([target, clue, board.words.map((word) => [word, board.roles[word]])]);
}

function normalizedScores(
  coords: Record<string, [number, number]>,
  hint: [number, number] | null,
): Map<string, number> {
  if (!hint) return new Map(Object.keys(coords).map((word) => [word, 0]));

  const distances = Object.entries(coords).map(
    ([word, coord]) => [word, distanceBetween(coord, hint)] as const,
  );
  const values = distances.map(([, distance]) => distance);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, Number.EPSILON);

  return new Map(
    distances.map(([word, distance]) => [
      word,
      Math.round(100 - ((distance - minimum) / range) * 100),
    ]),
  );
}

function readScores(read: ReadEntry[] | null): Map<string, number> {
  return new Map(
    (read ?? []).map((entry) => [
      entry.word,
      Math.round(Math.max(0, Math.min(1, entry.conf)) * 100),
    ]),
  );
}

export function SemanticMap(): JSX.Element {
  const activeTab = useAppStore((state) => state.activeTab);
  const checkedClue = useAppStore((state) => state.checkedClue);
  const clueResult = useAppStore((state) => state.clue.current);
  const optionIndex = useAppStore((state) => state.clue.optionIndex);
  const hoverWord = useAppStore((state) => state.hoverWord);
  const target = useAppStore((state) => state.target);
  const tiles = useAppStore((state) => state.tiles);
  const setHoverWord = useAppStore((state) => state.setHoverWord);
  const [space, setSpace] = useState<SpaceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredWord, setHoveredWord] = useState<string | null>(null);
  const [pinnedWord, setPinnedWord] = useState<string | null>(null);
  const [viewBoxWidth, setViewBoxWidth] = useState(VIEWBOX_SIZE);
  const mapRef = useRef<SVGSVGElement>(null);
  const requestSequence = useRef(0);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateViewBox = () => {
      if (map.clientWidth === 0 || map.clientHeight === 0) return;
      const nextWidth = VIEWBOX_SIZE * (map.clientWidth / map.clientHeight);
      setViewBoxWidth((currentWidth) =>
        Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth,
      );
    };

    updateViewBox();
    const observer = new ResizeObserver(updateViewBox);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  const currentOption = clueResult?.options[optionIndex] ?? null;
  const clue = activeTab === 'clue' ? (currentOption?.word ?? null) : checkedClue;
  const targets = useMemo(
    () => (activeTab === 'clue' && currentOption ? currentOption.intended : []),
    [activeTab, currentOption],
  );
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const board = useMemo(() => {
    const liveTiles = tiles.filter((tile) => tile.lifecycle === 'inPlay');
    return {
      words: liveTiles.map((tile) => tile.word),
      roles: Object.fromEntries(liveTiles.map((tile) => [tile.word, tile.role])),
    } satisfies BoardPayload;
  }, [tiles]);
  const key = useMemo(() => cacheKey(board, target, clue), [board, target, clue]);

  useEffect(() => {
    if (board.words.length === 0) {
      setSpace(null);
      setLoading(false);
      return;
    }

    const cached = mapCache.get(key);
    if (cached) {
      setSpace(cached);
      setLoading(false);
      return;
    }

    const sequence = ++requestSequence.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void postSpace(liveBoard(useAppStore.getState()), target, clue ?? undefined)
        .then((response) => {
          if (requestSequence.current !== sequence) return;
          mapCache.set(key, response);
          setSpace(response);
        })
        .catch((error: unknown) => {
          if (requestSequence.current !== sequence) return;
          setSpace(null);
          showToast(error instanceof Error ? error.message : 'לא הצלחנו לטעון את המפה', {
            tone: 'error',
          });
        })
        .finally(() => {
          if (requestSequence.current === sequence) setLoading(false);
        });
    }, REQUEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, [board.words.length, clue, key, target]);

  useEffect(() => {
    if (pinnedWord && !board.words.includes(pinnedWord)) {
      setPinnedWord(null);
    }
  }, [board.words, pinnedWord]);

  const hintCoord = space?.clue_xy ?? null;
  const hintPoint = hintCoord ? toPoint(hintCoord, viewBoxWidth) : null;
  const fallbackScores = useMemo(
    () => normalizedScores(space?.coords ?? {}, hintCoord),
    [hintCoord, space?.coords],
  );
  const preferredRead =
    activeTab === 'clue' && currentOption?.word === clue
      ? currentOption.read
      : getRememberedCheckResult(clue);
  const preferredScores = useMemo(() => readScores(preferredRead), [preferredRead]);

  const dots = useMemo<DotData[]>(() => {
    if (!space) return [];
    return Object.entries(space.coords).map(([word, coord]) => {
      const point = toPoint(coord, viewBoxWidth);
      return {
        ...point,
        coord,
        distance: hintCoord ? distanceBetween(coord, hintCoord) : Infinity,
        role: space.roles[word] ?? board.roles[word] ?? 'neutral',
        score: preferredScores.get(word) ?? fallbackScores.get(word) ?? 0,
        target: targetSet.has(word),
        word,
      };
    });
  }, [board.roles, fallbackScores, hintCoord, preferredScores, space, targetSet, viewBoxWidth]);

  const farthestTargetDistance = dots
    .filter((dot) => dot.target)
    .reduce((maximum, dot) => Math.max(maximum, dot.distance), 0);
  const defaultLabels = useMemo(
    () =>
      new Set(
        [...dots]
          .sort((left, right) => left.distance - right.distance)
          .slice(0, 5)
          .map((dot) => dot.word),
      ),
    [dots],
  );
  const activeWord = pinnedWord ?? hoveredWord ?? hoverWord;
  const activeDot = dots.find((dot) => dot.word === activeWord) ?? null;

  const isDanger = (dot: DotData): boolean =>
    dot.role === 'assassin' ||
    (Boolean(hintCoord) &&
      dot.role !== target &&
      farthestTargetDistance > 0 &&
      dot.distance <= farthestTargetDistance);

  const handleLeave = () => {
    setHoveredWord(null);
    if (!pinnedWord) setHoverWord(null);
  };

  const togglePin = (word: string) => {
    const next = pinnedWord === word ? null : word;
    setPinnedWord(next);
    setHoverWord(next);
  };

  const handleDotKeyDown = (event: KeyboardEvent<SVGGElement>, word: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      togglePin(word);
    }
    if (event.key === 'Escape') {
      setPinnedWord(null);
      setHoverWord(null);
    }
  };

  return (
    <section className="semantic-panel" aria-labelledby="semantic-map-title" data-testid="stub-map">
      <header className="semantic-panel__header">
        <div>
          <p className="semantic-panel__eyebrow">מפת משיכה</p>
          <h2 id="semantic-map-title">המרחב הסמנטי</h2>
        </div>
        {clue ? (
          <span className="semantic-panel__clue">
            הרמז: <strong>{clue}</strong>
          </span>
        ) : (
          <span className="semantic-panel__clue is-empty">ללא רמז פעיל</span>
        )}
      </header>

      <div className="semantic-map__frame">
        <svg
          ref={mapRef}
          className="semantic-map"
          data-testid="semantic-map"
          viewBox={`0 0 ${viewBoxWidth} ${VIEWBOX_SIZE}`}
          role="img"
          aria-label={clue ? `מפה סמנטית עבור הרמז ${clue}` : 'מפה סמנטית של מילות הלוח'}
        >
          <defs>
            <pattern id="semantic-grid" width="38" height="38" patternUnits="userSpaceOnUse">
              <path d="M 38 0 L 0 0 0 38" className="semantic-map__grid-line" />
            </pattern>
            <radialGradient id="semantic-hint-glow">
              <stop offset="0%" stopColor="var(--cn-map-hint-glow)" />
              <stop offset="100%" stopColor="var(--cn-map-hint)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect
            className="semantic-map__background"
            x={MAP_SURFACE_INSET}
            y={MAP_SURFACE_INSET}
            width={viewBoxWidth - MAP_SURFACE_INSET * 2}
            height={VIEWBOX_SIZE - MAP_SURFACE_INSET * 2}
            rx="16"
          />
          <rect
            className="semantic-map__grid"
            x={MAP_SURFACE_INSET}
            y={MAP_SURFACE_INSET}
            width={viewBoxWidth - MAP_SURFACE_INSET * 2}
            height={VIEWBOX_SIZE - MAP_SURFACE_INSET * 2}
            rx="16"
          />

          {hintPoint
            ? dots
                .filter((dot) => dot.target)
                .map((dot) => (
                  <line
                    className="semantic-map__target-line"
                    key={`line-${dot.word}`}
                    x1={hintPoint.x}
                    y1={hintPoint.y}
                    x2={dot.x}
                    y2={dot.y}
                  />
                ))
            : null}

          {dots.map((dot) => {
            const danger = isDanger(dot);
            const linked = dot.word === hoverWord || dot.word === activeWord;
            const showLabel =
              linked || dot.target || defaultLabels.has(dot.word) || dot.role === 'assassin';

            return (
              <g
                className={`semantic-map__dot role-${dot.role}${
                  dot.target ? ' is-target' : ''
                }${linked ? ' is-linked' : ''}`}
                data-testid={`map-dot-${dot.word}`}
                data-role={dot.role}
                data-target={dot.target ? 'true' : 'false'}
                key={dot.word}
                role="button"
                aria-label={`${dot.word}, ${roleLabels[dot.role]}, קרבה ${dot.score}`}
                aria-pressed={pinnedWord === dot.word}
                tabIndex={0}
                onMouseEnter={() => {
                  setHoveredWord(dot.word);
                  setHoverWord(dot.word);
                }}
                onMouseLeave={handleLeave}
                onFocus={() => {
                  setHoveredWord(dot.word);
                  setHoverWord(dot.word);
                }}
                onBlur={handleLeave}
                onClick={() => togglePin(dot.word)}
                onKeyDown={(event) => handleDotKeyDown(event, dot.word)}
              >
                <circle className="semantic-map__dot-hit-area" cx={dot.x} cy={dot.y} r="20" />
                {danger ? (
                  <circle
                    className={`semantic-map__danger${
                      dot.role === 'assassin' ? ' is-assassin' : ''
                    }`}
                    data-testid={`map-danger-${dot.word}`}
                    cx={dot.x}
                    cy={dot.y}
                    r={dot.role === 'assassin' ? 19 : 16}
                  />
                ) : null}
                <circle
                  className="semantic-map__dot-circle"
                  cx={dot.x}
                  cy={dot.y}
                  r={dot.target ? 9 : 7}
                />
                <text
                  className="semantic-map__dot-shape"
                  x={dot.x}
                  y={dot.y + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  aria-hidden="true"
                >
                  {roleShapes[dot.role]}
                </text>
                {linked ? (
                  <circle className="semantic-map__linked-ring" cx={dot.x} cy={dot.y} r="14" />
                ) : null}
                {showLabel ? (
                  <text
                    className="semantic-map__word-label"
                    x={dot.x}
                    y={dot.y - 17}
                    textAnchor="middle"
                    aria-hidden="true"
                  >
                    {dot.word}
                  </text>
                ) : null}
              </g>
            );
          })}

          {hintPoint && clue ? (
            <g className="semantic-map__hint" data-testid="map-hint-node">
              <circle
                className="semantic-map__hint-glow"
                cx={hintPoint.x}
                cy={hintPoint.y}
                r="62"
              />
              <circle
                className="semantic-map__hint-node"
                cx={hintPoint.x}
                cy={hintPoint.y}
                r="12"
              />
              <text
                className="semantic-map__hint-label"
                x={hintPoint.x}
                y={hintPoint.y - 23}
                textAnchor="middle"
              >
                {clue}
              </text>
            </g>
          ) : null}
        </svg>

        {loading ? (
          <div className="semantic-map__loading" role="status" aria-label="טוען מפה סמנטית">
            <span className="cn-loading-spinner" data-testid="loading-spinner" aria-hidden="true" />
            <span>ממקמים את מילות הלוח…</span>
          </div>
        ) : null}

        {activeDot ? (
          <div className={`semantic-map__tooltip role-${activeDot.role}`} role="status">
            <RoleIcon role={activeDot.role} />
            <strong>{activeDot.word}</strong>
            <span>קרבה משוערת · {activeDot.score}</span>
            {pinnedWord === activeDot.word ? <span aria-label="נעוץ">⌖</span> : null}
          </div>
        ) : null}
      </div>

      <div className="semantic-map__legend" data-testid="map-legend">
        <strong>קרוב למרכז = קרוב לרמז</strong>
        <span className="semantic-map__legend-separator" aria-hidden="true">
          ·
        </span>
        {(['red', 'blue', 'neutral', 'assassin'] as const).map((role) => (
          <span className={`semantic-map__legend-role role-${role}`} key={role}>
            <RoleIcon role={role} /> {roleLabels[role]}
          </span>
        ))}
        {!clue ? (
          <span className="semantic-map__legend-hintless">
            בחרו רמז או בדקו מילה כדי לראות את מרכז המשיכה
          </span>
        ) : null}
      </div>
    </section>
  );
}
