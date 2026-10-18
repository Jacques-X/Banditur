"""
Keep Maltese articles and one-letter short forms attached to their word.

Whisper often splits them ("L -festa", "il- festa", "f' Malta"). This mirrors
src/subtitles/maltese.js; both are tested against
src/subtitles/maltese-cases.json (see sidecar/test_maltese.py).
"""

HYPHENS = "-‐"
APOS = "'’"
SHORT_LETTERS = set("bfmxstlkd")
BARE_ARTICLES = {"l", "il", "tal", "fil", "bil", "mill", "għall", "lill"}
SENTENCE_END = ".!?…"
CLOSERS = "\"”»)"
ARTICLE_STEMS = {"", "i", "ta", "fi", "bi", "mi", "għa", "li", "sa", "ma", "ġo", "bħa"}
ARTICLE_LETTERS = {"l", "ll", "ċ", "d", "n", "r", "s", "t", "x", "ż", "z"}


def _strip_leading_hyphens(s):
    return s.lstrip(HYPHENS)


def _join(a, b):
    if not a or not b:
        return None
    # "il-" + "festa" / "il-" + "-festa"
    if len(a) >= 2 and a[-1] in HYPHENS and a[-2].isalpha():
        rest = _strip_leading_hyphens(b)
        if rest[:1].isalpha():
            return a + rest
    # "is" + "-soċjetà", "taż" + "-Żurrieq", "n" + "-nies": a token that starts
    # with a hyphen never stands alone in Maltese, so it joins the word before.
    if b[0] in HYPHENS and len(b) > 1 and _strip_leading_hyphens(b)[:1].isalpha() \
            and a[-1].isalpha():
        return a + "-" + _strip_leading_hyphens(b)
    # "f'" + "Malta"
    if len(a) == 2 and a[0].lower() in SHORT_LETTERS and a[1] in APOS and b[0].isalpha():
        return a + b
    # "f" + "'Malta"
    if len(a) == 1 and a.lower() in SHORT_LETTERS and len(b) > 1 and b[0] in APOS and b[1].isalpha():
        return a + b
    return None


def _is_article_like(text):
    head = text
    for ch in HYPHENS + APOS:
        head = head.split(ch)[0]
    head = head.lower()
    if head in BARE_ARTICLES or len(head) == 1:
        return True
    for letters in ARTICLE_LETTERS:
        if head.endswith(letters) and head[: len(head) - len(letters)] in ARTICLE_STEMS:
            return True
    return False


def _sentence_end(text):
    t = text.rstrip(CLOSERS)
    return bool(t) and t[-1] in SENTENCE_END


def merge_tokens(texts):
    """Return [(from, to, text)] groups, mirroring mergeTokens() in maltese.js."""
    groups = []
    i = 0
    n = len(texts)
    while i < n:
        text = texts[i]
        start = i
        merged = False
        while i + 1 < n:
            joined = _join(text, texts[i + 1])
            if joined is None:
                break
            text = joined
            i += 1
            merged = True
        if merged:
            prev = groups[-1][2] if groups else None
            sentence_start = prev is None or _sentence_end(prev)
            if (not sentence_start and text[:1].isupper() and _is_article_like(text)
                    and any(c in text for c in HYPHENS + APOS)):
                text = text[0].lower() + text[1:]
        groups.append((start, i, text))
        i += 1
    return groups


def merge_words(words):
    """Merge sidecar word dicts ({"word", "start", "end", "probability", ...})."""
    texts = [str(w.get("word", "")).strip() for w in words]
    groups = merge_tokens(texts)
    if len(groups) == len(words):
        return words
    out = []
    for start, end, text in groups:
        if start == end:
            out.append(words[start])
            continue
        part = words[start:end + 1]
        first = dict(part[0])
        lead = " " if str(first.get("word", "")).startswith(" ") else ""
        first["word"] = lead + text
        first["end"] = max(float(w.get("end", 0)) for w in part)
        first["probability"] = min(float(w.get("probability", 1)) for w in part)
        out.append(first)
    return out
