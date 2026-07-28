"""Regenerate destination_summary / destination_description / teaser_text
from the raw Excel notes, fixing the mangled sentence-split artifacts
(e.g. summary '1.' and description starting mid-sentence at '1.5 hr drive').

Rules:
- Combine all note rows for a spot into one clean paragraph (join with a space).
- destination_description = full combined note (the coherent paragraph).
- kite_context_description = keep whatever is already in seed_data.json IF it is
  non-trivial; otherwise leave empty (it duplicated the note anyway).
- destination_summary = first full sentence of the note, but ONLY if it is a
  real sentence (>= 20 chars and not just a number). Otherwise empty.
- teaser_text = first ~140 chars of the note ending on a word boundary.
"""
import json, re
from collections import defaultdict
import openpyxl

XLSX = "/home/user/workspace/branched_contexts/bb7ba92a-3e26-4832-8c37-2720f7acd7c4/attachments/Kitesurf-Spots.xlsx"
SEED = "/home/user/workspace/kite-compass/seed_data.json"

wb = openpyxl.load_workbook(XLSX, data_only=True)
ws = wb["Spot"]
notes = defaultdict(list)
for src, spot, note, link in ws.iter_rows(min_row=2, values_only=True):
    if spot and note:
        clean = str(note).replace("\xa0", " ").strip()
        if clean:
            notes[spot].append(clean)

def combined_note(name):
    parts = notes.get(name, [])
    # de-duplicate while preserving order
    seen, out = set(), []
    for p in parts:
        if p not in seen:
            seen.add(p); out.append(p)
    return " ".join(out).strip()

def first_sentence(text):
    # split on sentence end followed by space + capital, but avoid decimals like "1.5"
    m = re.search(r"(.+?[.!?])(\s+[A-Z]|$)", text)
    cand = (m.group(1) if m else text).strip()
    # guard against fragments like "1." or "approx."
    if len(cand) < 20 or re.fullmatch(r"[\d.\sA-Za-z]{0,6}", cand):
        return ""
    return cand

def teaser(text, limit=150):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    sp = cut.rfind(" ")
    if sp > 60:
        cut = cut[:sp]
    return cut.rstrip(" ,;") + "\u2026"

data = json.load(open(SEED))
spots = data["spots"]

fixed = 0
for s in spots:
    name = s["name"]
    note = combined_note(name)
    if not note:
        # no source note: blank the mangled fragments so the UI hides them
        for k in ("destination_summary", "destination_description", "teaser_text"):
            if str(s.get(k) or "").strip() in ("", "1.", "1", "."):
                s[k] = ""
        continue
    kc = str(s.get("kite_context_description") or "").strip()
    if kc in ("1.", "1", ".") or (len(kc) < 15):
        kc = ""

    # Use the full note as the single narrative body under "Kiting conditions"
    # (the notes are condition-focused). Leave destination_description empty to
    # avoid duplicating the same paragraph in two sections. Summary = lead
    # sentence shown at the top; teaser = short card line.
    s["kite_context_description"] = note
    s["destination_description"] = ""
    s["destination_summary"] = first_sentence(note)
    s["teaser_text"] = teaser(note)
    fixed += 1

json.dump(data, open(SEED, "w"), ensure_ascii=False, indent=2)
print(f"Updated text for {fixed} spots (of {len(spots)}).")
# sanity print
for s in spots:
    if s["slug"] == "kite-prasonisi":
        print("summary:", repr(s["destination_summary"]))
        print("desc:", repr(s["destination_description"])[:80])
        print("teaser:", repr(s["teaser_text"]))
