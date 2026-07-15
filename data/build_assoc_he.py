#!/usr/bin/env python3
"""Fetch and translate the WordSim-353 Relatedness subset to Hebrew.

Source (downloaded via Wayback Machine):
https://web.archive.org/web/20201112022046id_/http://alfonseca.org/pubs/ws353simrel.tar.gz

This script downloads the archive, extracts the relatedness goldstandard,
translates the English pairs into contextual Hebrew, and writes the TSV to:
data/assoc_he.tsv

Run from the repository root:
    python data/build_assoc_he.py
"""

from __future__ import annotations

import csv
import io
import tarfile
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://web.archive.org/web/20201112022046id_/"
    "http://alfonseca.org/pubs/ws353simrel.tar.gz"
)
OUTPUT_PATH = Path(__file__).resolve().parent / "assoc_he.tsv"

# Pair-specific or context-aware Hebrew translations for WordSim-353 Rel words
TRANSLATION_MAP = {
    ("computer", "keyboard"): ("מחשב", "מקלדת"),
    ("Jerusalem", "Israel"): ("ירושלים", "ישראל"),
    ("planet", "galaxy"): ("כוכב לכת", "גלקסיה"),
    ("canyon", "landscape"): ("קניון", "נוף"),
    ("OPEC", "country"): ("אופק", "מדינה"),
    ("day", "summer"): ("יום", "קיץ"),
    ("day", "dawn"): ("יום", "שחר"),
    ("country", "citizen"): ("מדינה", "אזרח"),
    ("planet", "people"): ("כוכב לכת", "אנשים"),
    ("environment", "ecology"): ("סביבה", "אקולוגיה"),
    ("Maradona", "football"): ("מרדונה", "כדורגל"),
    ("OPEC", "oil"): ("אופק", "נפט"),
    ("money", "bank"): ("כסף", "בנק"),
    ("computer", "software"): ("מחשב", "תוכנה"),
    ("law", "lawyer"): ("חוק", "עורך דין"),
    ("weather", "forecast"): ("מזג אוויר", "תחזית"),
    ("network", "hardware"): ("רשת", "חומרה"),
    ("nature", "environment"): ("טבע", "סביבה"),
    ("FBI", "investigation"): ("FBI", "חקירה"),
    ("money", "wealth"): ("כסף", "עושר"),
    ("psychology", "Freud"): ("פסיכולוגיה", "פרויד"),
    ("news", "report"): ("חדשות", "דיווח"),
    ("war", "troops"): ("מלחמה", "כוחות"),
    ("physics", "proton"): ("פיזיקה", "פרוטון"),
    ("bank", "money"): ("בנק", "כסף"),
    ("stock", "market"): ("מניה", "שוק"),
    ("planet", "constellation"): ("כוכב לכת", "קבוצת כוכבים"),
    ("credit", "card"): ("אשראי", "כרטיס"),
    ("hotel", "reservation"): ("מלון", "הזמנה"),
    ("closet", "clothes"): ("ארון", "בגדים"),
    ("soap", "opera"): ("סבון", "אופרה"),
    ("planet", "astronomer"): ("כוכב לכת", "אסטרונום"),
    ("planet", "space"): ("כוכב לכת", "חלל"),
    ("movie", "theater"): ("סרט", "תיאטרון"),
    ("treatment", "recovery"): ("טיפול", "החלמה"),
    ("baby", "mother"): ("תינוק", "אמא"),
    ("money", "deposit"): ("כסף", "הפקדה"),
    ("television", "film"): ("טלוויזיה", "סרט"),
    ("psychology", "mind"): ("פסיכולוגיה", "תודעה"),
    ("game", "team"): ("משחק", "קבוצה"),
    ("admission", "ticket"): ("כניסה", "כרטיס"),
    ("Jerusalem", "Palestinian"): ("ירושלים", "פלסטיני"),
    ("Arafat", "terror"): ("ערפאת", "טרור"),
    ("boxing", "round"): ("איגרוף", "סיבוב"),
    ("computer", "internet"): ("מחשב", "אינטרנט"),
    ("money", "property"): ("כסף", "רכוש"),
    ("tennis", "racket"): ("טניס", "מחבט"),
    ("telephone", "communication"): ("טלפון", "תקשורת"),
    ("currency", "market"): ("מטבע", "שוק"),
    ("psychology", "cognition"): ("פסיכולוגיה", "קוגניציה"),
    ("seafood", "sea"): ("פירות ים", "ים"),
    ("book", "paper"): ("ספר", "נייר"),
    ("book", "library"): ("ספר", "ספרייה"),
    ("psychology", "depression"): ("פסיכולוגיה", "דיכאון"),
    ("fighting", "defeating"): ("לחימה", "הבסה"),
    ("movie", "star"): ("סרט", "כוכב"),
    ("hundred", "percent"): ("מאה", "אחוז"),
    ("dollar", "profit"): ("דולר", "רווח"),
    ("money", "possession"): ("כסף", "חזקה"),
    ("cup", "drink"): ("כוס", "משקה"),
    ("psychology", "health"): ("פסיכולוגיה", "בריאות"),
    ("summer", "drought"): ("קיץ", "בצורת"),
    ("investor", "earning"): ("משקיע", "רווחים"),
    ("company", "stock"): ("חברה", "מניה"),
    ("stroke", "hospital"): ("שבץ", "בית חולים"),
    ("liability", "insurance"): ("חבות", "ביטוח"),
    ("game", "victory"): ("משחק", "ניצחון"),
    ("psychology", "anxiety"): ("פסיכולוגיה", "חרדה"),
    ("game", "defeat"): ("משחק", "תבוסה"),
    ("FBI", "fingerprint"): ("FBI", "טביעת אצבע"),
    ("money", "withdrawal"): ("כסף", "משיכה"),
    ("psychology", "fear"): ("פסיכולוגיה", "פחד"),
    ("drug", "abuse"): ("סם", "שימוש לרעה"),
    ("concert", "virtuoso"): ("קונצרט", "וירטואוז"),
    ("computer", "laboratory"): ("מחשב", "מעבדה"),
    ("love", "sex"): ("אהבה", "סקס"),
    ("problem", "challenge"): ("בעיה", "אתגר"),
    ("movie", "critic"): ("סרט", "מבקר"),
    ("Arafat", "peace"): ("ערפאת", "שלום"),
    ("bed", "closet"): ("מיטה", "ארון"),
    ("lawyer", "evidence"): ("עורך דין", "ראיות"),
    ("fertility", "egg"): ("פוריות", "ביצה"),
    ("precedent", "law"): ("תקדים", "חוק"),
    ("minister", "party"): ("שר", "מפלגה"),
    ("psychology", "clinic"): ("פסיכולוגיה", "מרפאה"),
    ("cup", "coffee"): ("כוס", "קפה"),
    ("water", "seepage"): ("מים", "חלחול"),
    ("government", "crisis"): ("ממשלה", "משבר"),
    ("space", "world"): ("חלל", "עולם"),
    ("dividend", "calculation"): ("דיבידנד", "חישוב"),
    ("victim", "emergency"): ("קורבן", "חירום"),
    ("luxury", "car"): ("יוקרה", "מכונית"),
    ("tool", "implement"): ("כלי", "מכשיר"),
    ("competition", "price"): ("תחרות", "מחיר"),
    ("psychology", "doctor"): ("פסיכולוגיה", "רופא"),
    ("gender", "equality"): ("מגדר", "שוויון"),
    ("listing", "category"): ("רישום", "קטגוריה"),
    ("video", "archive"): ("וידאו", "ארכיון"),
    ("oil", "stock"): ("נפט", "מלאי"),
    ("governor", "office"): ("מושל", "משרד"),
    ("discovery", "space"): ("גילוי", "חלל"),
    ("record", "number"): ("שיא", "מספר"),
    ("brother", "monk"): ("אח", "נזיר"),
    ("production", "crew"): ("ייצור", "צוות"),
    ("nature", "man"): ("טבע", "אדם"),
    ("family", "planning"): ("משפחה", "תכנון"),
    ("disaster", "area"): ("אסון", "אזור"),
    ("food", "preparation"): ("אוכל", "הכנה"),
    ("preservation", "world"): ("שימור", "עולם"),
    ("movie", "popcorn"): ("סרט", "פופקורן"),
    ("lover", "quarrel"): ("מאהב", "מריבה"),
    ("game", "series"): ("משחק", "סדרה"),
    ("dollar", "loss"): ("דולר", "הפסד"),
    ("weapon", "secret"): ("נשק", "סוד"),
    ("shower", "flood"): ("מקלחת", "שיטפון"),
    ("registration", "arrangement"): ("הרשמה", "הסדר"),
    ("arrival", "hotel"): ("הגעה", "מלון"),
    ("announcement", "warning"): ("הכרזה", "אזהרה"),
    ("game", "round"): ("משחק", "סיבוב"),
    ("baseball", "season"): ("בייסבול", "עונה"),
    ("drink", "mouth"): ("משקה", "פה"),
    ("life", "lesson"): ("חים", "שיעור"),
    ("grocery", "money"): ("מכולת", "כסף"),
    ("energy", "crisis"): ("אנרגיה", "משבר"),
    ("reason", "criterion"): ("סיבה", "קריטריון"),
    ("equipment", "maker"): ("ציוד", "יצרן"),
    ("cup", "liquid"): ("כוס", "נוזל"),
    ("deployment", "withdrawal"): ("פריסה", "נסיגה"),
    ("tiger", "zoo"): ("טיגריס", "גן חיות"),
    ("journey", "car"): ("מסע", "מכונית"),
    ("money", "laundering"): ("כסף", "הלבנה"),
    ("summer", "nature"): ("קיץ", "טבע"),
    ("decoration", "valor"): ("עיטור", "גבורה"),
    ("Mars", "scientist"): ("מאדים", "מדען"),
    ("alcohol", "chemistry"): ("אלכוהול", "כימיה"),
    ("disability", "death"): ("נכות", "מוות"),
    ("change", "attitude"): ("שינוי", "גישה"),
    ("arrangement", "accommodation"): ("הסדר", "לינה"),
    ("territory", "surface"): ("טריטוריה", "שטח"),
    ("size", "prominence"): ("גודל", "בולטות"),
    ("exhibit", "memorabilia"): ("מוצג", "מזכרות"),
    ("credit", "information"): ("אשראי", "מידע"),
    ("territory", "kilometer"): ("טריטוריה", "קילומטר"),
    ("death", "row"): ("מוות", "שורה"),
    ("doctor", "liability"): ("רופא", "חבות"),
    ("impartiality", "interest"): ("ניטרליות", "אינטרס"),
    ("energy", "laboratory"): ("אנרגיה", "מעבדה"),
    ("secretary", "senate"): ("מזכיר", "סנאט"),
    ("death", "inmate"): ("מוות", "אסיר"),
    ("monk", "oracle"): ("נזיר", "אורקל"),
    ("cup", "food"): ("כוס", "אוכל"),
    ("journal", "association"): ("כתב עת", "איגוד"),
    ("street", "children"): ("רחוב", "ילדים"),
    ("car", "flight"): ("מכונית", "טיסה"),
    ("space", "chemistry"): ("חלל", "כימיה"),
    ("situation", "conclusion"): ("מצב", "מסקנה"),
    ("word", "similarity"): ("מילה", "דמיון"),
    ("peace", "plan"): ("שלום", "תוכנית"),
    ("consumer", "energy"): ("צרכן", "אנרגיה"),
    ("ministry", "culture"): ("משרד", "תרבות"),
    ("smart", "student"): ("חכם", "סטודנט"),
    ("investigation", "effort"): ("חקירה", "מאמץ"),
    ("image", "surface"): ("תמונה", "משטח"),
    ("life", "term"): ("חיים", "תקופה"),
    ("start", "match"): ("התחלה", "משחק"),
    ("computer", "news"): ("מחשב", "חדשות"),
    ("board", "recommendation"): ("ועדה", "המלצה"),
    ("lad", "brother"): ("נער", "אח"),
    ("observation", "architecture"): ("תצפית", "אדריכלות"),
    ("coast", "hill"): ("חוף", "גבעה"),
    ("deployment", "departure"): ("פריסה", "עזיבה"),
    ("benchmark", "index"): ("מדד", "אינדקס"),
    ("attempt", "peace"): ("ניסיון", "שלום"),
    ("consumer", "confidence"): ("צרכן", "אמון"),
    ("start", "year"): ("התחלה", "שנה"),
    ("focus", "life"): ("מיקוד", "חיים"),
    ("development", "issue"): ("פיתוח", "סוגיה"),
    ("theater", "history"): ("תיאטרון", "היסטוריה"),
    ("situation", "isolation"): ("מצב", "בידוד"),
    ("profit", "warning"): ("רווח", "אזהרה"),
    ("media", "trading"): ("תקשורת", "מסחר"),
    ("chance", "credibility"): ("סיכוי", "אמינות"),
    ("precedent", "information"): ("תקדים", "מידע"),
    ("architecture", "century"): ("אדריכלות", "מאה"),
    ("population", "development"): ("אוכלוסייה", "פיתוח"),
    ("stock", "live"): ("מלאי", "חי"),
    ("peace", "atmosphere"): ("שלום", "אווירה"),
    ("morality", "marriage"): ("מוסר", "נישואין"),
    ("minority", "peace"): ("מיעוט", "שלום"),
    ("atmosphere", "landscape"): ("אווירה", "נוף"),
    ("report", "gain"): ("דיווח", "רווח"),
    ("music", "project"): ("מוזיקה", "פרויקט"),
    ("seven", "series"): ("שבע", "סדרה"),
    ("experience", "music"): ("חוויה", "מוזיקה"),
    ("school", "center"): ("בית ספר", "מרכז"),
    ("five", "month"): ("חמש", "חודש"),
    ("announcement", "production"): ("הכרזה", "הפקה"),
    ("morality", "importance"): ("מוסר", "חשיבות"),
    ("money", "operation"): ("כסף", "ניתוח"),
    ("delay", "news"): ("עיכוב", "חדשות"),
    ("governor", "interview"): ("מושל", "ראיון"),
    ("practice", "institution"): ("תרגול", "מוסד"),
    ("century", "nation"): ("מאה", "אומה"),
    ("coast", "forest"): ("חוף", "יער"),
    ("shore", "woodland"): ("חוף", "חורש"),
    ("drink", "car"): ("משקה", "מכונית"),
    ("president", "medal"): ("נשיא", "מדליה"),
    ("prejudice", "recognition"): ("דעה קדומה", "הכרה"),
    ("viewer", "serial"): ("צופה", "סדרתי"),
    ("peace", "insurance"): ("שלום", "ביטוח"),
    ("Mars", "water"): ("מאדים", "מים"),
    ("media", "gain"): ("תקשורת", "רווח"),
    ("precedent", "cognition"): ("תקדים", "קוגניציה"),
    ("announcement", "effort"): ("הכרזה", "מאמץ"),
    ("line", "insurance"): ("קו", "ביטוח"),
    ("crane", "implement"): ("עגורן", "כלי"),
    ("drink", "mother"): ("משקה", "אמא"),
    ("opera", "industry"): ("אופרה", "תעשייה"),
    ("volunteer", "motto"): ("מתנדב", "מוטו"),
    ("listing", "proximity"): ("רישום", "קרבה"),
    ("precedent", "collection"): ("תקדים", "אוסף"),
    ("cup", "article"): ("כוס", "פריט"),
    ("sign", "recess"): ("שלט", "הפסקה"),
    ("problem", "airport"): ("בעיה", "נמל תעופה"),
    ("reason", "hypertension"): ("סיבה", "יתר לחץ דם"),
    ("direction", "combination"): ("כיוון", "שילוב"),
    ("Wednesday", "news"): ("יום רביעי", "חדשות"),
    ("glass", "magician"): ("זכוכית", "קוסם"),
    ("cemetery", "woodland"): ("בית קברות", "חורש"),
    ("possibility", "girl"): ("אפשרות", "ילדה"),
    ("cup", "substance"): ("כוס", "חומר"),
    ("forest", "graveyard"): ("יער", "בית קברות"),
    ("stock", "egg"): ("מלאי", "ביצה"),
    ("month", "hotel"): ("חודש", "מלון"),
    ("energy", "secretary"): ("אנרגיה", "מזכיר"),
    ("precedent", "group"): ("תקדים", "קבוצה"),
    ("production", "hike"): ("ייצור", "טיול"),
    ("stock", "phone"): ("מלאי", "טלפון"),
    ("holy", "sex"): ("קדוש", "סקס"),
    ("stock", "CD"): ("מלאי", "תקליטור"),
    ("drink", "ear"): ("משקה", "אוזן"),
    ("delay", "racism"): ("עיכוב", "גזענות"),
    ("stock", "life"): ("מלאי", "חיים"),
    ("stock", "jaguar"): ("מלאי", "יגואר"),
    ("monk", "slave"): ("נזיר", "עבד"),
    ("lad", "wizard"): ("נער", "קוסם"),
    ("sugar", "approach"): ("סוכר", "גישה"),
    ("rooster", "voyage"): ("תרנגול", "מסע"),
    ("noon", "string"): ("צהריים", "חוט"),
    ("chord", "smile"): ("אקורד", "חיוך"),
    ("professor", "cucumber"): ("פרופסור", "מלפפון"),
    ("king", "cabbage"): ("מלך", "כרוב"),
}


def download_and_extract() -> list[tuple[str, str, float]]:
    """Download the tar.gz from web archive, extract WordSim-Rel, and parse it."""
    print(f"Downloading from {SOURCE_URL}...")
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "codenames-fetch/1.0"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read()

    print("Extracting...")
    pairs: list[tuple[str, str, float]] = []
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if "relatedness_goldstandard" in member.name:
                f = tar.extractfile(member)
                if f is None:
                    continue
                reader = csv.reader(io.StringIO(f.read().decode("utf-8")), delimiter="\t")
                for line_num, row in enumerate(reader, start=1):
                    if not row:
                        continue
                    if len(row) != 3:
                        raise ValueError(f"Malformed row at line {line_num}: {row}")
                    try:
                        score = float(row[2])
                    except ValueError:
                        continue  # Skip header or malformed scores
                    pairs.append((row[0], row[1], score))
    return pairs


def main() -> None:
    en_pairs = download_and_extract()
    if not en_pairs:
        raise ValueError("No word pairs extracted from source archive.")

    print(f"Loaded {len(en_pairs)} English pairs.")

    translated_pairs: list[tuple[str, str, float]] = []
    missing_translations: list[tuple[str, str]] = []

    for w1, w2, score in en_pairs:
        # Check standard mapping
        he_pair = TRANSLATION_MAP.get((w1, w2))
        if not he_pair:
            # Check swapped order mapping
            he_pair = TRANSLATION_MAP.get((w2, w1))
            if he_pair:
                he_pair = (he_pair[1], he_pair[0])

        if he_pair:
            translated_pairs.append((he_pair[0], he_pair[1], score))
        else:
            missing_translations.append((w1, w2))

    if missing_translations:
        print(f"WARNING: {len(missing_translations)} missing translations:")
        for pair in missing_translations:
            print(f"  {pair}")
        raise SystemExit("Please complete the translation map in the script.")

    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t", lineterminator="\n")
        writer.writerow(("word1", "word2", "score"))
        for w1, w2, score in translated_pairs:
            writer.writerow((w1, w2, f"{score:g}"))

    print(f"Successfully wrote {OUTPUT_PATH} with {len(translated_pairs)} pairs.")


if __name__ == "__main__":
    main()
