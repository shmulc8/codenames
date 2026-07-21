# Board photo to CSV

Standalone utility for converting a photograph of a Hebrew Codenames board to
a headerless CSV grid. It detects and rectifies cards before OCR, and uses the
large white word label to recover board orientation from sideways photos.

## Install

Tesseract and its Hebrew model are system packages:

```bash
sudo apt install tesseract-ocr tesseract-ocr-heb
python3 -m pip install -r board_reader/requirements.txt
```

On macOS:

```bash
brew install tesseract tesseract-lang
python3 -m pip install -r board_reader/requirements.txt
```

## Run

```bash
python3 -m board_reader photo.jpg -o board.csv --debug-image detected.jpg
```

The result is a 5-by-5 CSV with no header. Rows run from the top of the board to
the bottom; columns run from left to right. `--debug-image` is optional and is
useful for checking which cards and order were detected.

The default board shape can be overridden with `--rows` and `--columns`.

## Photo guidance

- Keep every board card visible. Global rotation and moderate perspective are
  corrected automatically.
- Spare cards outside the regular grid are ignored, but avoid overlapping a
  board card.
- Glare across the printed word or motion blur can still make OCR impossible.
  The command fails instead of silently emitting a partial board; use the debug
  image to distinguish missed card detection from unreadable text.

The recognizer does not constrain results to the word list in this repository,
because different Hebrew editions use different decks.
