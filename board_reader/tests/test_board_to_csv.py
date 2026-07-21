from __future__ import annotations

import csv
import shutil
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

try:
    from PIL import Image, ImageDraw, ImageFont, features
except ImportError:  # Pillow is only needed by the optional OCR integration test.
    Image = ImageDraw = ImageFont = features = None

from board_reader.board_to_csv import OCRResult, TesseractHebrewOCR, detect_cards, read_board, write_csv


HEBREW_FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
OCR_TEST_AVAILABLE = bool(shutil.which("tesseract") and Image is not None and HEBREW_FONT.is_file())


PHOTO_BOARD = [
    ["שיגור", "בית-ספר", "לבוש", "סוס", "קניין"],
    ["מצרים", "מגדל", "הודו", "יוון", "שקל"],
    ["נסיכה", "עלייה", "אגודל", "סגור", "ארץ"],
    ["חפרפרת", "אבן", "עמוד", "כף", "כלב"],
    ["מסלול", "רעל", "שלג", "פצצה", "חשבון"],
]


def synthetic_board(rotation: int = 0, perspective: bool = False) -> np.ndarray:
    """Make a board that exercises geometry without teaching it the sample photo."""
    card_width, card_height = 210, 120
    gap_x, gap_y = 42, 38
    margin = 130
    width = margin * 2 + card_width * 5 + gap_x * 4
    height = margin * 2 + card_height * 5 + gap_y * 4
    image = np.full((height, width, 3), (35, 39, 37), dtype=np.uint8)
    for row in range(5):
        for column in range(5):
            x = margin + column * (card_width + gap_x)
            y = margin + row * (card_height + gap_y)
            card_id = row * 5 + column
            cv2.rectangle(image, (x, y), (x + card_width, y + card_height), (160 + 3 * card_id, 222, 231), -1)
            cv2.rectangle(image, (x + 8, y + 8), (x + card_width - 8, y + card_height - 8), (222, 235, 240), 3)
            # The asymmetric white label is what defines viewer-down.
            cv2.rectangle(
                image,
                (x + 24, y + round(card_height * 0.55)),
                (x + card_width - 24, y + round(card_height * 0.88)),
                (252, 252, 252),
                -1,
            )
            cv2.putText(
                image,
                f"{row}{column}",
                (x + 72, y + round(card_height * 0.82)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (20, 20, 20),
                2,
                cv2.LINE_AA,
            )

    if perspective:
        source = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
        target = np.float32([[70, 50], [width - 125, 0], [width - 10, height - 55], [0, height - 5]])
        transform = cv2.getPerspectiveTransform(source, target)
        image = cv2.warpPerspective(image, transform, (width, height), borderValue=(70, 70, 70))

    if rotation == 90:
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    elif rotation == 180:
        image = cv2.rotate(image, cv2.ROTATE_180)
    elif rotation == 270:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return image


def clean_hebrew_board() -> np.ndarray:
    """Render the words visible in the supplied photos with a different layout."""
    image = synthetic_board(perspective=False)
    pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_image)
    font = ImageFont.truetype(str(HEBREW_FONT), 34)
    card_width, card_height, gap_x, gap_y, margin = 210, 120, 42, 38, 130
    kwargs = {"direction": "rtl"} if features.check("raqm") else {}
    for row, words in enumerate(PHOTO_BOARD):
        for column, word in enumerate(words):
            x = margin + column * (card_width + gap_x)
            y = margin + row * (card_height + gap_y)
            # Cover the synthetic ID, then draw a clean Hebrew face-up label.
            draw.rectangle((x + 24, y + 66, x + card_width - 24, y + 106), fill="white")
            draw.text((x + card_width / 2, y + 86), word, fill="black", font=font, anchor="mm", **kwargs)
    image = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
    height, width = image.shape[:2]
    source = np.float32([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])
    target = np.float32([[55, 30], [width - 90, 0], [width - 5, height - 35], [0, height - 5]])
    transform = cv2.getPerspectiveTransform(source, target)
    image = cv2.warpPerspective(image, transform, (width, height), borderValue=(70, 70, 70))
    return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)


def board_with_decoys() -> np.ndarray:
    board = synthetic_board(perspective=True)
    board = cv2.copyMakeBorder(board, 0, 0, 0, 310, cv2.BORDER_CONSTANT, value=(35, 39, 37))
    original_width = board.shape[1] - 310
    for index, y in enumerate((90, 610)):
        x = original_width + 45
        cv2.rectangle(board, (x, y), (x + 210, y + 120), (238 - index * 3, 222, 231), -1)
        cv2.rectangle(board, (x + 8, y + 8), (x + 202, y + 112), (222, 235, 240), 3)
        cv2.rectangle(board, (x + 24, y + 66), (x + 186, y + 106), (252, 252, 252), -1)
    return board


class TaggedOCR:
    """Reads the synthetic card ID from its stock colour."""

    def __call__(self, image: np.ndarray) -> OCRResult:
        # The large white label must remain at the bottom after rectification.
        height = image.shape[0]
        top = float(np.mean(image[: height // 2]))
        bottom = float(np.mean(image[height // 2 :]))
        if bottom <= top:
            raise AssertionError("card was rectified upside down")
        blue = int(image[round(height * 0.30), round(image.shape[1] * 0.50), 0])
        card_id = round((blue - 160) / 3)
        return OCRResult(f"card-{card_id}", 99.0)


class BoardReaderTests(unittest.TestCase):
    def test_detects_25_cards_under_perspective(self) -> None:
        cards = detect_cards(synthetic_board(perspective=True))
        self.assertGreaterEqual(len(cards), 25)

    def test_rotation_and_perspective_keep_row_major_order(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                ocr = TaggedOCR()
                result = read_board(synthetic_board(rotation=rotation, perspective=True), ocr=ocr)
                expected = [[f"card-{row * 5 + column}" for column in range(5)] for row in range(5)]
                self.assertEqual(result, expected)

    def test_ignores_card_like_decoys_outside_grid(self) -> None:
        expected = [[f"card-{row * 5 + column}" for column in range(5)] for row in range(5)]
        self.assertEqual(read_board(board_with_decoys(), ocr=TaggedOCR()), expected)

    @unittest.skipUnless(OCR_TEST_AVAILABLE, "Hebrew OCR integration-test dependencies are not installed")
    def test_tesseract_reads_clean_hebrew_label(self) -> None:
        canvas = Image.new("RGB", (640, 360), "white")
        draw = ImageDraw.Draw(canvas)
        font = ImageFont.truetype(str(HEBREW_FONT), 88)
        kwargs = {"direction": "rtl"} if features.check("raqm") else {}
        draw.text((320, 260), "סוס", fill="black", font=font, anchor="mm", **kwargs)
        image = cv2.cvtColor(np.asarray(canvas), cv2.COLOR_RGB2BGR)
        recognizer = TesseractHebrewOCR()
        self.assertEqual(recognizer(image).text, "סוס")

    @unittest.skipUnless(OCR_TEST_AVAILABLE, "Hebrew OCR integration-test dependencies are not installed")
    def test_full_photo_vocabulary_with_rotation_and_perspective(self) -> None:
        self.assertEqual(read_board(clean_hebrew_board()), PHOTO_BOARD)

    def test_csv_is_headerless_utf8_grid(self) -> None:
        rows = [["סוס", "ארץ"], ["שלג", "פצצה"]]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "board.csv"
            write_csv(rows, output)
            with output.open(encoding="utf-8", newline="") as handle:
                self.assertEqual(list(csv.reader(handle)), rows)


if __name__ == "__main__":
    unittest.main()
