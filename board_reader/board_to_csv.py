"""Turn a photo of a 5x5 Hebrew Codenames board into a CSV grid.

Card detection and ordering are image based.  Tesseract is only used after each
card has been found and rectified, which is substantially more reliable than
asking an OCR engine to understand the whole photograph at once.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

import cv2
import numpy as np


HEBREW_RE = re.compile(r"[א-ת]+(?:[-־'][א-ת]+)*")


class BoardReadError(RuntimeError):
    """The input could not be interpreted as the requested board."""


@dataclass(frozen=True)
class Card:
    corners: np.ndarray
    center: np.ndarray
    long_side: float
    short_side: float
    rectangularity: float


@dataclass(frozen=True)
class OCRResult:
    text: str
    confidence: float


OCRFunction = Callable[[np.ndarray], OCRResult]


def load_image(path: str | Path) -> np.ndarray:
    """Load an image, including paths containing non-ASCII characters."""
    path = Path(path)
    if not path.is_file():
        raise BoardReadError(f"input image does not exist: {path}")
    encoded = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise BoardReadError(f"could not decode image: {path}")
    return image


def _resize_for_detection(image: np.ndarray, max_dimension: int = 2200) -> tuple[np.ndarray, float]:
    height, width = image.shape[:2]
    scale = min(1.0, max_dimension / max(height, width))
    if scale == 1.0:
        return image.copy(), scale
    resized = cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    return resized, scale


def _contour_candidates(image: np.ndarray) -> list[Card]:
    height, width = image.shape[:2]
    image_area = float(height * width)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    masks: list[np.ndarray] = []
    # The fixed masks handle the light cards on the dark play surface. Otsu and
    # Canny retain useful edges under shadows or on a lighter surface.
    for threshold in (105, 135, 165):
        masks.append(cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)[1])
    masks.append(cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1])
    masks.append(cv2.Canny(gray, 45, 135))

    cards: list[Card] = []
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    for mask in masks:
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = float(abs(cv2.contourArea(contour)))
            if not image_area * 0.0007 <= area <= image_area * 0.075:
                continue
            rect = cv2.minAreaRect(contour)
            side_a, side_b = rect[1]
            short, long = sorted((float(side_a), float(side_b)))
            if short < 18 or not 1.35 <= long / max(short, 1.0) <= 2.75:
                continue
            box_area = short * long
            rectangularity = area / max(box_area, 1.0)
            if rectangularity < 0.52:
                continue
            corners = cv2.boxPoints(rect).astype(np.float32)
            cards.append(
                Card(
                    corners=corners,
                    center=np.asarray(rect[0], dtype=np.float32),
                    long_side=long,
                    short_side=short,
                    rectangularity=rectangularity,
                )
            )
    return cards


def _intersection_ratio(a: Card, b: Card) -> float:
    area_a = a.long_side * a.short_side
    area_b = b.long_side * b.short_side
    try:
        intersection, _ = cv2.intersectConvexConvex(a.corners, b.corners)
    except cv2.error:
        return 0.0
    return float(intersection) / max(min(area_a, area_b), 1.0)


def _deduplicate(cards: Sequence[Card]) -> list[Card]:
    # Outer card borders and inner white labels often produce nested contours.
    # Prefer the larger, more rectangular contour at the same location.
    ranked = sorted(
        cards,
        key=lambda card: (card.long_side * card.short_side) * (0.5 + card.rectangularity),
        reverse=True,
    )
    kept: list[Card] = []
    for card in ranked:
        duplicate = False
        for other in kept:
            distance = float(np.linalg.norm(card.center - other.center))
            if distance < 0.28 * min(card.short_side, other.short_side) or _intersection_ratio(card, other) > 0.58:
                duplicate = True
                break
        if not duplicate:
            kept.append(card)
    return kept


def detect_cards(image: np.ndarray) -> list[Card]:
    """Return plausible card rectangles in original-image coordinates."""
    resized, scale = _resize_for_detection(image)
    cards = _deduplicate(_contour_candidates(resized))
    if scale != 1.0:
        inverse = 1.0 / scale
        cards = [
            Card(
                corners=card.corners * inverse,
                center=card.center * inverse,
                long_side=card.long_side * inverse,
                short_side=card.short_side * inverse,
                rectangularity=card.rectangularity,
            )
            for card in cards
        ]
    return cards


def _bright_card_candidates(image: np.ndarray, threshold: int) -> list[Card]:
    """Detect card exteriors without closing gaps between touching cards."""
    resized, scale = _resize_for_detection(image)
    height, width = resized.shape[:2]
    image_area = float(height * width)
    gray = cv2.GaussianBlur(cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    mask = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)[1]
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cards: list[Card] = []
    for contour in contours:
        area = float(abs(cv2.contourArea(contour)))
        if not image_area * 0.0007 <= area <= image_area * 0.075:
            continue
        rect = cv2.minAreaRect(contour)
        short, long = sorted(map(float, rect[1]))
        if short < 18 or not 1.35 <= long / max(short, 1.0) <= 2.75:
            continue
        rectangularity = area / max(short * long, 1.0)
        if rectangularity < 0.52:
            continue
        cards.append(
            Card(
                corners=cv2.boxPoints(rect).astype(np.float32),
                center=np.asarray(rect[0], dtype=np.float32),
                long_side=long,
                short_side=short,
                rectangularity=rectangularity,
            )
        )
    cards = _deduplicate(cards)
    if scale != 1.0:
        inverse = 1.0 / scale
        cards = [
            Card(
                corners=card.corners * inverse,
                center=card.center * inverse,
                long_side=card.long_side * inverse,
                short_side=card.short_side * inverse,
                rectangularity=card.rectangularity,
            )
            for card in cards
        ]
    return cards


def _axis_corners(card: Card) -> tuple[np.ndarray, np.ndarray]:
    points = card.corners
    vectors = np.roll(points, -1, axis=0) - points
    lengths = np.linalg.norm(vectors, axis=1)
    long_vector = vectors[int(np.argmax(lengths))]
    long_axis = long_vector / max(float(np.linalg.norm(long_vector)), 1.0)
    # Axis sign is deliberately unresolved here.
    short_axis = np.asarray((-long_axis[1], long_axis[0]), dtype=np.float32)
    return long_axis, short_axis


def _ordered_corners(card: Card, right: np.ndarray, down: np.ndarray) -> np.ndarray:
    relative = card.corners - card.center
    horizontal = relative @ right
    vertical = relative @ down
    top = np.argsort(vertical)[:2]
    bottom = np.argsort(vertical)[-2:]
    top = top[np.argsort(horizontal[top])]
    bottom = bottom[np.argsort(horizontal[bottom])]
    # top-left, top-right, bottom-right, bottom-left
    return np.asarray(
        [card.corners[top[0]], card.corners[top[1]], card.corners[bottom[1]], card.corners[bottom[0]]],
        dtype=np.float32,
    )


def rectify_card(
    image: np.ndarray,
    card: Card,
    right: np.ndarray,
    down: np.ndarray,
    width: int = 640,
    height: int = 360,
) -> np.ndarray:
    source = _ordered_corners(card, right, down)
    destination = np.asarray(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32
    )
    transform = cv2.getPerspectiveTransform(source, destination)
    return cv2.warpPerspective(image, transform, (width, height))


def _label_whiteness(rectified: np.ndarray, bottom: bool) -> float:
    height, width = rectified.shape[:2]
    y0, y1 = ((0.54, 0.90) if bottom else (0.10, 0.46))
    roi = rectified[round(height * y0) : round(height * y1), round(width * 0.10) : round(width * 0.90)]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    brightness = hsv[:, :, 2].astype(np.float32) / 255.0
    saturation = hsv[:, :, 1].astype(np.float32) / 255.0
    # White label: bright and neutral. Beige card stock is penalized by saturation.
    return float(np.mean(brightness - 0.55 * saturation))


def infer_board_axes(image: np.ndarray, cards: Sequence[Card]) -> tuple[np.ndarray, np.ndarray]:
    """Infer viewer-right and viewer-down from the large white word labels."""
    down_votes: list[np.ndarray] = []
    vote_weights: list[float] = []
    for card in cards:
        long_axis, short_axis = _axis_corners(card)
        # Make the long axis point roughly toward image-right for a stable warp.
        if long_axis[0] < 0:
            long_axis = -long_axis
            short_axis = -short_axis
        rectified = rectify_card(image, card, long_axis, short_axis)
        bottom_score = _label_whiteness(rectified, bottom=True)
        top_score = _label_whiteness(rectified, bottom=False)
        difference = bottom_score - top_score
        down_votes.append(short_axis if difference >= 0 else -short_axis)
        vote_weights.append(max(abs(difference), 0.01))

    if not down_votes:
        raise BoardReadError("could not infer board orientation")
    # Sign-align votes to resist a few ambiguous or partially occluded labels.
    reference = down_votes[int(np.argmax(vote_weights))]
    aligned = [vote if float(vote @ reference) >= 0 else -vote for vote in down_votes]
    down = np.average(np.stack(aligned), axis=0, weights=np.asarray(vote_weights))
    down = down / max(float(np.linalg.norm(down)), 1e-6)
    right = np.asarray((down[1], -down[0]), dtype=np.float32)
    return right, down.astype(np.float32)


def _kmeans_1d(values: np.ndarray, groups: int) -> tuple[np.ndarray, np.ndarray]:
    centers = np.quantile(values, np.linspace(0.0, 1.0, groups))
    labels = np.zeros(len(values), dtype=np.int32)
    for _ in range(50):
        distances = np.abs(values[:, None] - centers[None, :])
        new_labels = np.argmin(distances, axis=1)
        new_centers = np.asarray(
            [np.mean(values[new_labels == group]) if np.any(new_labels == group) else centers[group] for group in range(groups)]
        )
        if np.array_equal(labels, new_labels) and np.allclose(centers, new_centers):
            break
        labels, centers = new_labels, new_centers
    order = np.argsort(centers)
    relabel = np.empty(groups, dtype=np.int32)
    relabel[order] = np.arange(groups)
    return relabel[labels], centers[order]


def _grid_score(cards: Sequence[Card], right: np.ndarray, down: np.ndarray, rows: int, columns: int) -> float:
    centers = np.stack([card.center for card in cards])
    xs = centers @ right
    ys = centers @ down
    labels, row_centers = _kmeans_1d(ys, rows)
    column_labels, column_centers = _kmeans_1d(xs, columns)
    row_counts = np.bincount(labels, minlength=rows)
    column_counts = np.bincount(column_labels, minlength=columns)
    occupancy = np.zeros((rows, columns), dtype=np.int32)
    for row, column in zip(labels, column_labels):
        occupancy[row, column] += 1
    count_penalty = float(
        np.sum(np.abs(row_counts - columns))
        + np.sum(np.abs(column_counts - rows))
        + np.sum(np.abs(occupancy - 1))
    )
    residual = float(
        np.mean(np.abs(ys - row_centers[labels])) / max(np.median([card.short_side for card in cards]), 1.0)
        + np.mean(np.abs(xs - column_centers[column_labels]))
        / max(np.median([card.long_side for card in cards]), 1.0)
    )

    regularity = 0.0
    for row_index in range(rows):
        row_x = np.sort(xs[labels == row_index])
        gaps = np.diff(row_x)
        if len(gaps):
            typical = max(float(np.median(gaps)), 1.0)
            regularity += float(np.mean(np.abs(gaps / typical - 1.0)))
    for column_index in range(columns):
        column_y = np.sort(ys[column_labels == column_index])
        gaps = np.diff(column_y)
        if len(gaps):
            typical = max(float(np.median(gaps)), 1.0)
            regularity += float(np.mean(np.abs(gaps / typical - 1.0)))
    return count_penalty * 20.0 + residual + regularity * 8.0


def select_and_order_grid(
    candidates: Sequence[Card],
    right: np.ndarray,
    down: np.ndarray,
    rows: int = 5,
    columns: int = 5,
) -> list[list[Card]]:
    """Select the rectangular board and return cards in visual row-major order."""
    required = rows * columns
    if len(candidates) < required:
        raise BoardReadError(f"found only {len(candidates)} card-like rectangles; expected {required}")

    cards = list(candidates)
    if len(cards) > required:
        # The common clutter case is one or two spare cards beside an otherwise
        # complete board. Cluster rows first, then choose the five-card subset
        # with the most regular horizontal spacing in each row.
        centers = np.stack([card.center for card in cards])
        initial_labels, _ = _kmeans_1d(centers @ down, rows)
        initial_rows = [[card for card, label in zip(cards, initial_labels) if label == row] for row in range(rows)]
        if all(len(row) >= columns for row in initial_rows):
            selected_rows: list[list[Card]] = []
            for row in initial_rows:
                row.sort(key=lambda card: float(card.center @ right))

                def spacing_score(choice: tuple[Card, ...]) -> float:
                    positions = np.asarray([card.center @ right for card in choice], dtype=np.float32)
                    gaps = np.diff(positions)
                    typical = max(float(np.median(gaps)), 1.0)
                    return float(np.mean(np.abs(gaps / typical - 1.0)))

                best = min(itertools.combinations(row, columns), key=spacing_score)
                selected_rows.append(list(best))
            if sum(map(len, selected_rows)) == required:
                return selected_rows

        # Remove outliers one at a time, retaining the subset with the most even
        # row population and smallest row residual. This handles spare cards near
        # (but outside) a laid-out board without hard-coding photo coordinates.
        # Avoid spending quadratic time on every weak edge in a cluttered photo.
        # Real board cards have closely related sizes, unlike table hardware and
        # the smaller printed regions inside a card.
        median_area = float(np.median([card.long_side * card.short_side for card in cards]))
        size_filtered = [
            card
            for card in cards
            if 0.48 <= (card.long_side * card.short_side) / max(median_area, 1.0) <= 2.05
        ]
        if len(size_filtered) >= required:
            cards = size_filtered
        while len(cards) > required:
            choices = [cards[:index] + cards[index + 1 :] for index in range(len(cards))]
            cards = min(choices, key=lambda choice: _grid_score(choice, right, down, rows, columns))

    centers = np.stack([card.center for card in cards])
    y_values = centers @ down
    row_labels, _ = _kmeans_1d(y_values, rows)
    grouped: list[list[Card]] = []
    for row_index in range(rows):
        row = [card for card, label in zip(cards, row_labels) if label == row_index]
        if len(row) != columns:
            counts = [int(np.sum(row_labels == index)) for index in range(rows)]
            raise BoardReadError(f"detected card rows have sizes {counts}, expected {columns} each")
        row.sort(key=lambda card: float(card.center @ right))
        grouped.append(row)
    return grouped


def _spacing_score(cards: Sequence[Card], right: np.ndarray) -> float:
    positions = np.sort(np.asarray([card.center @ right for card in cards], dtype=np.float32))
    gaps = np.diff(positions)
    if not len(gaps):
        return float("inf")
    typical = max(float(np.median(gaps)), 1.0)
    return float(np.mean(np.abs(gaps / typical - 1.0)))


def _recover_regular_grid(
    candidates: Sequence[Card],
    right: np.ndarray,
    down: np.ndarray,
    rows: int,
    columns: int,
) -> tuple[list[list[Card]], float]:
    """Recover a grid with a few merged/missed cards using its repeated lattice."""
    if len(candidates) < rows * (columns - 1):
        raise BoardReadError("too few bright card rectangles for grid recovery")

    centers = np.stack([card.center for card in candidates])
    xs = centers @ right
    ys = centers @ down
    typical_long = float(np.median([card.long_side for card in candidates]))
    typical_short = float(np.median([card.short_side for card in candidates]))

    slopes: list[float] = []
    for first in range(len(candidates)):
        for second in range(first):
            dx = float(xs[first] - xs[second])
            dy = float(ys[first] - ys[second])
            if typical_long * 0.65 < abs(dx) < typical_long * 1.9 and abs(dy) < typical_short * 0.7:
                slopes.append(dy / dx)
    row_slope = float(np.median(slopes)) if slopes else 0.0
    corrected_y = ys - row_slope * xs

    order = np.argsort(corrected_y)
    groups: list[list[int]] = []
    max_within_row_gap = typical_short * 0.56
    for index in order:
        if not groups or corrected_y[index] - corrected_y[groups[-1][-1]] > max_within_row_gap:
            groups.append([int(index)])
        else:
            groups[-1].append(int(index))
    plausible = [group for group in groups if len(group) >= columns - 1]
    if len(plausible) < rows:
        raise BoardReadError("could not find five repeated card rows")
    if len(plausible) > rows:
        plausible = max(
            itertools.combinations(plausible, rows),
            key=lambda choice: sum(min(len(group), columns) for group in choice),
        )
        plausible = list(plausible)
    plausible.sort(key=lambda group: float(np.median(corrected_y[group])))

    row_centers = np.asarray([np.median(corrected_y[group]) for group in plausible], dtype=np.float32)
    regular_rows: list[tuple[int, list[Card]]] = []
    for row_index, group in enumerate(plausible):
        row_cards = [candidates[index] for index in group]
        if len(row_cards) < columns:
            continue
        choices = list(itertools.combinations(row_cards, columns))
        best = min(choices, key=lambda choice: _spacing_score(choice, right))
        if _spacing_score(best, right) < 0.22:
            regular_rows.append((row_index, sorted(best, key=lambda card: float(card.center @ right))))
    if len(regular_rows) < 2:
        raise BoardReadError("not enough complete rows to infer missing grid cells")

    predicted_x = np.empty((rows, columns), dtype=np.float32)
    fit_rows = np.asarray([row_index for row_index, _ in regular_rows], dtype=np.float32)
    for column in range(columns):
        fit_x = np.asarray([row[column].center @ right for _, row in regular_rows], dtype=np.float32)
        if len(regular_rows) >= 2:
            slope, intercept = np.polyfit(fit_rows, fit_x, 1)
            predicted_x[:, column] = slope * np.arange(rows) + intercept
        else:  # Kept for clarity if the minimum above changes in the future.
            predicted_x[:, column] = fit_x[0]

    result: list[list[Card]] = []
    residual = 0.0
    reconstructed = 0
    for row_index, group in enumerate(plausible):
        row_candidates = [candidates[index] for index in group]
        column_spacing = float(np.median(np.diff(predicted_x[row_index])))
        maximum_distance = max(column_spacing * 0.46, typical_long * 0.5)
        assigned: list[Card | None] = [None] * columns
        assigned_distance = [float("inf")] * columns
        for card in row_candidates:
            x = float(card.center @ right)
            column = int(np.argmin(np.abs(predicted_x[row_index] - x)))
            distance = abs(float(predicted_x[row_index, column]) - x)
            if distance <= maximum_distance and distance < assigned_distance[column]:
                assigned[column] = card
                assigned_distance[column] = distance

        existing = [card for card in assigned if card is not None]
        if len(existing) < columns - 1:
            raise BoardReadError("a recovered row is missing more than one card")
        row_long = float(np.median([card.long_side for card in existing]))
        row_short = float(np.median([card.short_side for card in existing]))
        for column, card in enumerate(assigned):
            if card is not None:
                residual += assigned_distance[column] / max(column_spacing, 1.0)
                continue
            x = float(predicted_x[row_index, column])
            y = float(row_centers[row_index] + row_slope * x)
            center = right * x + down * y
            half_right = right * (row_long * 0.5)
            half_down = down * (row_short * 0.5)
            corners = np.asarray(
                [center - half_right - half_down, center + half_right - half_down,
                 center + half_right + half_down, center - half_right + half_down],
                dtype=np.float32,
            )
            assigned[column] = Card(corners, center.astype(np.float32), row_long, row_short, 1.0)
            reconstructed += 1
        result.append([card for card in assigned if card is not None])

    if reconstructed > max(2, rows * columns // 10):
        raise BoardReadError("too many missing cards to recover safely")
    score = reconstructed * 5.0 + residual
    return result, score


def _clean_hebrew(text: str) -> str:
    words = HEBREW_RE.findall(text)
    if not words:
        return ""
    word = max(words, key=len).strip("-'־")
    final_letters = {"כ": "ך", "מ": "ם", "נ": "ן", "פ": "ף", "צ": "ץ"}
    if word and word[-1] in final_letters:
        word = word[:-1] + final_letters[word[-1]]
    return word


def _recognize_vertical_strokes(gray: np.ndarray) -> OCRResult:
    """Recognize Hebrew words composed only of yod/vav/final-nun strokes.

    These glyphs are nearly featureless vertical strokes in common sans fonts,
    and Tesseract occasionally rejects the whole word. Their relative heights
    and baselines still distinguish them reliably. This is a character-shape
    fallback, not a vocabulary lookup.
    """
    thresholded = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    count, _, stats, _ = cv2.connectedComponentsWithStats(thresholded)
    components = []
    for x, y, width, height, area in stats[1:count]:
        if area < 30 or height < 10:
            continue
        if width / height > 0.8:
            continue
        components.append((int(x), int(y), int(width), int(height), int(area)))
    if not 2 <= len(components) <= 8:
        return OCRResult("", -1.0)

    components.sort(key=lambda component: component[0])
    heights = np.asarray([component[3] for component in components], dtype=np.float32)
    bottoms = np.asarray([component[1] + component[3] for component in components], dtype=np.float32)
    typical_height = float(np.median(heights))
    typical_bottom = float(np.median(bottoms))
    visual_order: list[str] = []
    for height, bottom in zip(heights, bottoms):
        if height < typical_height * 0.78:
            visual_order.append("י")
        elif height > typical_height * 1.18 and bottom > typical_bottom + typical_height * 0.15:
            visual_order.append("ן")
        else:
            visual_order.append("ו")
    # Components were sorted from image-left to image-right; Hebrew logical
    # order is right-to-left.
    return OCRResult("".join(reversed(visual_order)), 25.0)


class TesseractHebrewOCR:
    def __init__(
        self,
        executable: str = "tesseract",
        language: str = "heb",
        vocabulary: set[str] | None = None,
    ) -> None:
        resolved = shutil.which(executable)
        if resolved is None:
            raise BoardReadError(
                "Tesseract is not installed. Install the 'tesseract-ocr' and "
                "'tesseract-ocr-heb' system packages."
            )
        self.executable = resolved
        self.language = language
        self.vocabulary = vocabulary if vocabulary is not None else self._load_repo_vocabulary()
        self._check_language()

    @staticmethod
    def _load_repo_vocabulary() -> set[str]:
        """Load broad Hebrew words when running inside this repository."""
        repo_root = Path(__file__).resolve().parent.parent
        words: set[str] = set()
        frequency_path = repo_root / "data" / "content_master_v2_30000.json"
        deck_path = repo_root / "data" / "yaeldau_hebrew.json"
        try:
            with frequency_path.open(encoding="utf-8") as handle:
                words.update(row[0] for row in json.load(handle) if row and isinstance(row[0], str))
        except (OSError, ValueError, TypeError):
            pass
        try:
            with deck_path.open(encoding="utf-8") as handle:
                words.update(word for word in json.load(handle) if isinstance(word, str))
        except (OSError, ValueError, TypeError):
            pass
        return words

    def _check_language(self) -> None:
        result = subprocess.run(
            [self.executable, "--list-langs"], capture_output=True, text=True, encoding="utf-8", check=False
        )
        languages = {line.strip() for line in result.stdout.splitlines()}
        if self.language not in languages:
            raise BoardReadError(
                f"Tesseract language '{self.language}' is unavailable. Install the 'tesseract-ocr-heb' package."
            )

    def _run_variant(self, image: np.ndarray, page_segmentation: int = 7) -> OCRResult:
        ok, encoded = cv2.imencode(".png", image)
        if not ok:
            return OCRResult("", -1.0)
        command = [
            self.executable,
            "stdin",
            "stdout",
            "-l",
            self.language,
            "--oem",
            "1",
            "--psm",
            str(page_segmentation),
            "tsv",
        ]
        result = subprocess.run(command, input=encoded.tobytes(), capture_output=True, check=False)
        if result.returncode != 0:
            message = result.stderr.decode("utf-8", errors="replace").strip()
            raise BoardReadError(f"Tesseract failed: {message}")

        best = OCRResult("", -1.0)
        lines = result.stdout.decode("utf-8", errors="replace").splitlines()
        for line in lines[1:]:
            fields = line.split("\t", 11)
            if len(fields) != 12:
                continue
            text = _clean_hebrew(fields[11])
            if not text:
                continue
            try:
                confidence = float(fields[10])
            except ValueError:
                confidence = -1.0
            candidate = OCRResult(text, confidence + min(len(text), 8) * 0.25)
            if candidate.confidence > best.confidence:
                best = candidate
        return best

    def __call__(self, rectified: np.ndarray) -> OCRResult:
        results: list[OCRResult] = []
        stroke_results: list[OCRResult] = []
        for oriented in (rectified, cv2.rotate(rectified, cv2.ROTATE_180)):
            height, width = oriented.shape[:2]
            wide = oriented[
                round(height * 0.48) : round(height * 0.93),
                round(width * 0.06) : round(width * 0.94),
            ]
            tight = oriented[
                round(height * 0.50) : round(height * 0.80),
                round(width * 0.12) : round(width * 0.88),
            ]
            wide_gray = cv2.cvtColor(wide, cv2.COLOR_BGR2GRAY)
            tight_gray = cv2.cvtColor(tight, cv2.COLOR_BGR2GRAY)
            enlarged = cv2.resize(tight_gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            enlarged_wide = cv2.resize(wide_gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            thresholded = cv2.threshold(enlarged, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
            smoothed = cv2.GaussianBlur(wide_gray, (5, 5), 0)
            results.extend(
                [
                    self._run_variant(wide_gray, 6),
                    self._run_variant(smoothed, 6),
                    self._run_variant(tight_gray, 6),
                    self._run_variant(thresholded, 6),
                ]
            )
            stroke_results.append(_recognize_vertical_strokes(enlarged))
            stroke_results.append(_recognize_vertical_strokes(enlarged_wide))
        known_results = [result for result in results if result.text in self.vocabulary]
        if known_results:
            grouped_results: dict[str, list[OCRResult]] = {}
            for result in known_results:
                grouped_results.setdefault(result.text, []).append(result)

            def consensus_score(item: tuple[str, list[OCRResult]]) -> float:
                text, matches = item
                mean_confidence = sum(match.confidence for match in matches) / len(matches)
                return mean_confidence + len(matches) * 5.0 + len(text) * 3.0

            _, matches = max(grouped_results.items(), key=consensus_score)
            best = max(matches, key=lambda result: result.confidence)
        else:
            best = max(results, key=lambda result: result.confidence)
        known_strokes = [result for result in stroke_results if result.text in self.vocabulary]
        best_strokes = max(known_strokes or stroke_results, key=lambda result: result.confidence)
        if (
            len(best_strokes.text) >= 3
            and best_strokes.text in self.vocabulary
            and (len(best.text) <= 2 or best.confidence < 50.0)
        ):
            best = best_strokes
        return best


def read_board(
    image: np.ndarray,
    rows: int = 5,
    columns: int = 5,
    ocr: OCRFunction | None = None,
    debug_image: str | Path | None = None,
) -> list[list[str]]:
    """Detect, order, and read a board image."""
    candidates = detect_cards(image)
    if len(candidates) < rows * columns:
        raise BoardReadError(f"found only {len(candidates)} card-like rectangles; expected {rows * columns}")
    right, down = infer_board_axes(image, candidates)
    try:
        grid = select_and_order_grid(candidates, right, down, rows, columns)
    except BoardReadError as initial_error:
        recovered: list[tuple[list[list[Card]], float]] = []
        for threshold in (180, 195, 210):
            bright_candidates = _bright_card_candidates(image, threshold)
            try:
                recovered.append(_recover_regular_grid(bright_candidates, right, down, rows, columns))
            except BoardReadError:
                continue
        if not recovered:
            raise initial_error
        grid, _ = min(recovered, key=lambda item: item[1])
    recognizer = ocr or TesseractHebrewOCR()

    words: list[list[str]] = []
    for row in grid:
        output_row: list[str] = []
        for card in row:
            rectified = rectify_card(image, card, right, down)
            result = recognizer(rectified)
            output_row.append(result.text)
        words.append(output_row)

    missing = [(row + 1, column + 1) for row in range(rows) for column in range(columns) if not words[row][column]]
    if missing:
        locations = ", ".join(f"r{row}c{column}" for row, column in missing)
        raise BoardReadError(f"OCR returned no Hebrew word for: {locations}")

    if debug_image is not None:
        annotated = image.copy()
        for row_index, row in enumerate(grid):
            for column_index, card in enumerate(row):
                cv2.polylines(annotated, [card.corners.astype(np.int32)], True, (0, 220, 0), 4)
                position = tuple(card.center.astype(int))
                cv2.putText(
                    annotated,
                    f"{row_index + 1},{column_index + 1}",
                    position,
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 0, 255),
                    2,
                    cv2.LINE_AA,
                )
        debug_path = Path(debug_image)
        debug_path.parent.mkdir(parents=True, exist_ok=True)
        suffix = debug_path.suffix or ".jpg"
        encoded_ok, encoded = cv2.imencode(suffix, annotated)
        if not encoded_ok:
            raise BoardReadError(f"could not write debug image: {debug_path}")
        encoded.tofile(debug_path)

    return words


def write_csv(rows: Sequence[Sequence[str]], output: str | Path) -> None:
    """Write a headerless UTF-8 CSV whose shape matches the board."""
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        csv.writer(handle).writerows(rows)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert a photographed Hebrew Codenames board to CSV.")
    parser.add_argument("image", help="input JPG/PNG/WEBP photo")
    parser.add_argument("-o", "--output", help="output CSV (default: IMAGE.csv)")
    parser.add_argument("--rows", type=int, default=5, help="number of board rows (default: 5)")
    parser.add_argument("--columns", type=int, default=5, help="number of board columns (default: 5)")
    parser.add_argument("--debug-image", help="write an annotated detection image")
    parser.add_argument("--tesseract", default="tesseract", help="Tesseract executable name/path")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output = Path(args.output) if args.output else Path(args.image).with_suffix(".csv")
    try:
        image = load_image(args.image)
        ocr = TesseractHebrewOCR(args.tesseract)
        board = read_board(
            image,
            rows=args.rows,
            columns=args.columns,
            ocr=ocr,
            debug_image=args.debug_image,
        )
        write_csv(board, output)
    except BoardReadError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(f"wrote {args.rows}x{args.columns} board to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
