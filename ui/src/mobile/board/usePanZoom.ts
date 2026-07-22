import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react';

import { BOARD_HEIGHT, BOARD_WIDTH, CARD_WIDTH } from './board-model';

interface Point {
  x: number;
  y: number;
}
interface TransformState {
  fitScale: number;
  scale: number;
  x: number;
  y: number;
}
interface PrimaryGesture extends Point {
  moved: boolean;
  word: string | null;
}
interface PinchGesture {
  anchor: Point;
  distance: number;
  scale: number;
}
interface LastTap {
  at: number;
  point: Point;
  word: string;
}

interface GestureContext {
  applyTransform(next: TransformState): void;
  lastTap: MutableRefObject<LastTap | null>;
  onTap(word: string): void;
  panOrigin: MutableRefObject<Point>;
  pinch: MutableRefObject<PinchGesture | null>;
  pointers: MutableRefObject<Map<number, Point>>;
  primary: MutableRefObject<PrimaryGesture | null>;
  resetToFit(): void;
  setGesturing(value: boolean): void;
  settleTimer: MutableRefObject<number | undefined>;
  tapTimer: MutableRefObject<number | undefined>;
  transform: MutableRefObject<TransformState>;
  viewport: RefObject<HTMLDivElement>;
}

const TAP_DISTANCE = 10;
const RUBBER_BAND = 0.32;

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function fitFor(viewport: HTMLDivElement): TransformState {
  const widthScale = Math.max(0.1, (viewport.clientWidth - 16) / BOARD_WIDTH);
  const heightScale = Math.max(0.1, (viewport.clientHeight - 16) / BOARD_HEIGHT);
  const landscape = viewport.clientWidth > viewport.clientHeight;
  const fitScale = landscape ? Math.min(widthScale, 1) : Math.min(widthScale, heightScale, 1);
  return {
    fitScale,
    scale: fitScale,
    x: (viewport.clientWidth - BOARD_WIDTH * fitScale) / 2,
    y: landscape ? 0 : (viewport.clientHeight - BOARD_HEIGHT * fitScale) / 2,
  };
}

function axisBounds(viewportSize: number, contentSize: number): [number, number] {
  if (contentSize <= viewportSize) {
    const centered = (viewportSize - contentSize) / 2;
    return [centered, centered];
  }
  return [viewportSize - contentSize, 0];
}

function constrainAxis(value: number, min: number, max: number, soft: boolean): number {
  if (value < min) return soft ? min + (value - min) * RUBBER_BAND : min;
  if (value > max) return soft ? max + (value - max) * RUBBER_BAND : max;
  return value;
}

function constrain(viewport: HTMLDivElement, next: TransformState, soft: boolean): TransformState {
  const [minX, maxX] = axisBounds(viewport.clientWidth, BOARD_WIDTH * next.scale);
  const [minY, maxY] = axisBounds(viewport.clientHeight, BOARD_HEIGHT * next.scale);
  return {
    ...next,
    x: constrainAxis(next.x, minX, maxX, soft),
    y: constrainAxis(next.y, minY, maxY, soft),
  };
}

function handlePointerDown(
  context: GestureContext,
  event: ReactPointerEvent<HTMLDivElement>,
): void {
  const viewport = context.viewport.current;
  if (!viewport) return;
  window.clearTimeout(context.settleTimer.current);
  const point = { x: event.clientX, y: event.clientY };
  context.pointers.current.set(event.pointerId, point);
  context.setGesturing(true);
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    /* synthetic pointer */
  }

  if (context.pointers.current.size === 1) {
    const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-mobile-tile="true"]');
    context.primary.current = { ...point, moved: false, word: tile?.dataset.word ?? null };
    context.panOrigin.current = { x: context.transform.current.x, y: context.transform.current.y };
    return;
  }

  const [first, second] = [...context.pointers.current.values()];
  const center = midpoint(first, second);
  const rect = viewport.getBoundingClientRect();
  context.pinch.current = {
    anchor: {
      x: (center.x - rect.left - context.transform.current.x) / context.transform.current.scale,
      y: (center.y - rect.top - context.transform.current.y) / context.transform.current.scale,
    },
    distance: Math.max(1, distance(first, second)),
    scale: context.transform.current.scale,
  };
  if (context.primary.current) context.primary.current.moved = true;
}

function handlePinch(context: GestureContext, viewport: HTMLDivElement): boolean {
  if (context.pointers.current.size < 2 || !context.pinch.current) return false;
  const [first, second] = [...context.pointers.current.values()];
  const center = midpoint(first, second);
  const rect = viewport.getBoundingClientRect();
  const current = context.transform.current;
  const maxScale = Math.max(current.fitScale, viewport.clientWidth / CARD_WIDTH);
  const scale = Math.min(
    maxScale,
    Math.max(
      current.fitScale,
      (context.pinch.current.scale * distance(first, second)) / context.pinch.current.distance,
    ),
  );
  context.applyTransform(
    constrain(
      viewport,
      {
        ...current,
        scale,
        x: center.x - rect.left - context.pinch.current.anchor.x * scale,
        y: center.y - rect.top - context.pinch.current.anchor.y * scale,
      },
      true,
    ),
  );
  return true;
}

function handlePointerMove(
  context: GestureContext,
  event: ReactPointerEvent<HTMLDivElement>,
): void {
  const viewport = context.viewport.current;
  if (!viewport || !context.pointers.current.has(event.pointerId)) return;
  const point = { x: event.clientX, y: event.clientY };
  context.pointers.current.set(event.pointerId, point);
  if (handlePinch(context, viewport) || !context.primary.current) return;

  const dx = point.x - context.primary.current.x;
  const dy = point.y - context.primary.current.y;
  if (Math.hypot(dx, dy) >= TAP_DISTANCE) context.primary.current.moved = true;
  context.applyTransform(
    constrain(
      viewport,
      {
        ...context.transform.current,
        x: context.panOrigin.current.x + dx,
        y: context.panOrigin.current.y + dy,
      },
      true,
    ),
  );
}

function zoomToPoint(context: GestureContext, point: Point): void {
  const viewport = context.viewport.current;
  const current = context.transform.current;
  if (!viewport) return;
  if (current.scale > current.fitScale + 0.02) {
    context.resetToFit();
    return;
  }
  const rect = viewport.getBoundingClientRect();
  const local = { x: point.x - rect.left, y: point.y - rect.top };
  const nextScale = Math.min(viewport.clientWidth / CARD_WIDTH, current.fitScale * 2.25);
  const boardPoint = {
    x: (local.x - current.x) / current.scale,
    y: (local.y - current.y) / current.scale,
  };
  context.applyTransform(
    constrain(
      viewport,
      {
        ...current,
        scale: nextScale,
        x: local.x - boardPoint.x * nextScale,
        y: local.y - boardPoint.y * nextScale,
      },
      false,
    ),
  );
}

function settlePan(context: GestureContext, viewport: HTMLDivElement): void {
  const settle = (): void =>
    context.applyTransform(constrain(viewport, context.transform.current, false));
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) settle();
  else context.settleTimer.current = window.setTimeout(settle, 180);
}

function handleTap(context: GestureContext, point: Point, word: string): void {
  const previous = context.lastTap.current;
  const isDoubleTap =
    previous &&
    previous.word === word &&
    Date.now() - previous.at < 320 &&
    distance(previous.point, point) < 24;
  if (isDoubleTap) {
    window.clearTimeout(context.tapTimer.current);
    zoomToPoint(context, point);
    context.lastTap.current = null;
    return;
  }
  window.clearTimeout(context.tapTimer.current);
  context.lastTap.current = { at: Date.now(), point, word };
  context.tapTimer.current = window.setTimeout(() => {
    context.onTap(word);
    context.lastTap.current = null;
  }, 280);
}

function handlePointerEnd(context: GestureContext, event: ReactPointerEvent<HTMLDivElement>): void {
  if (!context.pointers.current.has(event.pointerId)) return;
  const wasPinching = context.pointers.current.size > 1 || context.pinch.current !== null;
  context.pointers.current.delete(event.pointerId);
  if (context.pointers.current.size < 2) context.pinch.current = null;

  const primary = context.primary.current;
  if (!wasPinching && primary) {
    const point = { x: event.clientX, y: event.clientY };
    if (!primary.moved && primary.word) handleTap(context, point, primary.word);
    else if (context.viewport.current) settlePan(context, context.viewport.current);
  }

  if (context.pointers.current.size === 0) {
    context.primary.current = null;
    context.setGesturing(false);
  }
}

function useFitObserver(viewport: RefObject<HTMLDivElement>, resetToFit: () => void): void {
  useEffect(() => {
    const element = viewport.current;
    if (!element) return undefined;
    resetToFit();
    const observer = new ResizeObserver(resetToFit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [resetToFit, viewport]);
}

export function usePanZoom(viewport: RefObject<HTMLDivElement>, onTap: (word: string) => void) {
  const [transform, setTransform] = useState<TransformState>({ fitScale: 1, scale: 1, x: 0, y: 0 });
  const [gesturing, setGesturing] = useState(false);
  const transformRef = useRef(transform);
  const pointers = useRef(new Map<number, Point>());
  const primary = useRef<PrimaryGesture | null>(null);
  const panOrigin = useRef<Point>({ x: 0, y: 0 });
  const pinch = useRef<PinchGesture | null>(null);
  const lastTap = useRef<LastTap | null>(null);
  const settleTimer = useRef<number>();
  const tapTimer = useRef<number>();
  const applyTransform = useCallback((next: TransformState): void => {
    transformRef.current = next;
    setTransform(next);
  }, []);
  const resetToFit = useCallback((): void => {
    if (viewport.current) applyTransform(fitFor(viewport.current));
  }, [applyTransform, viewport]);
  useFitObserver(viewport, resetToFit);
  useEffect(
    () => () => {
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(tapTimer.current);
    },
    [],
  );

  const context: GestureContext = {
    applyTransform,
    lastTap,
    onTap,
    panOrigin,
    pinch,
    pointers,
    primary,
    resetToFit,
    setGesturing,
    settleTimer,
    tapTimer,
    transform: transformRef,
    viewport,
  };
  const fit = viewport.current ? fitFor(viewport.current) : transform;
  const atFit =
    Math.abs(transform.scale - fit.scale) < 0.001 &&
    Math.abs(transform.x - fit.x) < 0.1 &&
    Math.abs(transform.y - fit.y) < 0.1;

  return {
    atFit,
    gesturing,
    pointerDown: (event: ReactPointerEvent<HTMLDivElement>) => handlePointerDown(context, event),
    pointerMove: (event: ReactPointerEvent<HTMLDivElement>) => handlePointerMove(context, event),
    pointerUp: (event: ReactPointerEvent<HTMLDivElement>) => handlePointerEnd(context, event),
    pointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => handlePointerEnd(context, event),
    resetToFit,
    transform,
  };
}
