import type { Role } from '../../types/api';
import { imageFileToCanvas } from './ocr';

const referenceColors: Record<Role, [number, number, number]> = {
  red: [176, 69, 72],
  blue: [64, 119, 174],
  neutral: [221, 202, 153],
  assassin: [27, 28, 35],
};

function colorDistance(
  color: [number, number, number],
  reference: [number, number, number],
): number {
  const red = color[0] - reference[0];
  const green = color[1] - reference[1];
  const blue = color[2] - reference[2];
  return red * red * 0.3 + green * green * 0.59 + blue * blue * 0.11;
}

function classify(color: [number, number, number]): Role {
  const lightness = (Math.max(...color) + Math.min(...color)) / 2;
  if (lightness < 55) return 'assassin';

  return (Object.entries(referenceColors) as Array<[Role, [number, number, number]]>)
    .sort(
      ([, left], [, right]) =>
        colorDistance(color, left) - colorDistance(color, right),
    )[0][0];
}

export async function classifyKeyCard(file: File): Promise<Role[]> {
  const canvas = await imageFileToCanvas(file);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('הדפדפן לא הצליח לדגום את כרטיס המפתח');

  const insetX = canvas.width * 0.08;
  const insetY = canvas.height * 0.08;
  const usableWidth = canvas.width - insetX * 2;
  const usableHeight = canvas.height - insetY * 2;

  return Array.from({ length: 25 }, (_, index) => {
    const row = Math.floor(index / 5);
    const rtlColumn = index % 5;
    const centerX = insetX + usableWidth * ((4 - rtlColumn + 0.5) / 5);
    const centerY = insetY + usableHeight * ((row + 0.5) / 5);
    const patchWidth = Math.max(2, Math.round(usableWidth / 5 / 3));
    const patchHeight = Math.max(2, Math.round(usableHeight / 5 / 3));
    const pixels = context.getImageData(
      Math.max(0, Math.round(centerX - patchWidth / 2)),
      Math.max(0, Math.round(centerY - patchHeight / 2)),
      patchWidth,
      patchHeight,
    ).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let samples = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] < 128) continue;
      red += pixels[offset];
      green += pixels[offset + 1];
      blue += pixels[offset + 2];
      samples += 1;
    }
    return classify([
      red / Math.max(1, samples),
      green / Math.max(1, samples),
      blue / Math.max(1, samples),
    ]);
  });
}

export function rotateRolesClockwise(roles: Role[]): Role[] {
  // The grid renders with direction: rtl, so column 0 sits on the screen's
  // right edge. Rotating clockwise as the user sees it maps to this
  // index-space formula (mirrored from the plain row/column rotation).
  return roles.map((_, index) => {
    const row = Math.floor(index / 5);
    const column = index % 5;
    return roles[column * 5 + (4 - row)];
  });
}
