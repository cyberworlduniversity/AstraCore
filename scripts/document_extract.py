#!/usr/bin/env python3
"""Safe, dependency-free document text extractor for AstraCore.

Reads a JSON request from stdin and writes JSON to stdout. It never executes
content from an uploaded document and never writes uploaded bytes to disk.
PDF extraction is best-effort for text-based PDFs; scanned PDF/image OCR is
reported as NOT_IMPLEMENTED unless a future isolated OCR adapter is added.
"""
import base64
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
import zlib

MAX_BYTES = 8 * 1024 * 1024
SUPPORTED = {"txt", "md", "markdown", "json", "csv", "html", "htm", "pdf", "docx", "pptx", "xlsx"}


def ext(name):
    m = re.search(r"\.([A-Za-z0-9]+)$", str(name or ""))
    return m.group(1).lower() if m else ""


def clean_text(value):
    value = value.replace("\x00", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def xml_text(data):
    root = ET.fromstring(data)
    return " ".join(t.strip() for t in root.itertext() if t and t.strip())


def extract_docx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = set(z.namelist())
        if "word/document.xml" not in names:
            raise ValueError("DOCX does not contain word/document.xml")
        text = xml_text(z.read("word/document.xml"))
    return [{"text": clean_text(text), "locator": "document"}]


def extract_pptx(raw):
    out = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        slides = sorted(n for n in z.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n))
        for i, name in enumerate(slides, 1):
            text = xml_text(z.read(name))
            if text:
                out.append({"text": clean_text(text), "locator": f"slide {i}", "page": i})
    return out


def extract_xlsx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = [" ".join(t.strip() for t in si.itertext() if t and t.strip()) for si in root]
        sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        out = []
        for idx, name in enumerate(sheets, 1):
            root = ET.fromstring(z.read(name))
            rows = []
            for row in root.iter():
                if row.tag.endswith("}row"):
                    vals = []
                    for cell in row:
                        if not cell.tag.endswith("}c"):
                            continue
                        typ = cell.attrib.get("t")
                        val = ""
                        for child in cell:
                            if child.tag.endswith("}v"):
                                val = child.text or ""
                                break
                            if child.tag.endswith("}is"):
                                val = " ".join(t.strip() for t in child.itertext() if t and t.strip())
                        if typ == "s" and val.isdigit() and int(val) < len(shared):
                            val = shared[int(val)]
                        vals.append(val)
                    if vals:
                        rows.append(" | ".join(vals))
            if rows:
                out.append({"text": "\n".join(rows), "locator": f"sheet {idx}"})
    return out


def pdf_string_decode(s):
    s = s.replace(r"\n", "\n").replace(r"\r", "\n").replace(r"\t", "\t")
    s = re.sub(r"\\([\\()])", r"\1", s)
    return s


def extract_pdf(raw):
    data = raw.decode("latin1", errors="ignore")
    pieces = []
    streams = re.finditer(r"stream\r?\n(.*?)\r?\nendstream", data, re.S)
    for match in streams:
        payload = match.group(1).encode("latin1", errors="ignore")
        window = data[max(0, match.start() - 500):match.start()]
        if "/FlateDecode" in window:
            try:
                payload = zlib.decompress(payload)
            except Exception:
                continue
        text = payload.decode("latin1", errors="ignore")
        for m in re.finditer(r"\((.*?)(?<!\\)\)\s*Tj", text, re.S):
            pieces.append(pdf_string_decode(m.group(1)))
        for m in re.finditer(r"\[(.*?)\]\s*TJ", text, re.S):
            for s in re.findall(r"\((.*?)(?<!\\)\)", m.group(1), re.S):
                pieces.append(pdf_string_decode(s))
    text = clean_text(" ".join(pieces))
    if not text:
        raise ValueError("PDF contains no extractable text. Scanned PDF/OCR is NOT_IMPLEMENTED yet.")
    return [{"text": text, "locator": "pdf text"}]


def extract(req):
    name = str(req.get("name") or "document")
    kind = ext(name)
    if kind not in SUPPORTED:
        raise ValueError(f"Unsupported document type: .{kind or 'unknown'}")
    try:
        raw = base64.b64decode(str(req.get("data") or ""), validate=True)
    except Exception as exc:
        raise ValueError("Invalid base64 document payload") from exc
    if not raw:
        raise ValueError("Document is empty")
    if len(raw) > MAX_BYTES:
        raise ValueError(f"Document exceeds {MAX_BYTES} byte limit")
    if kind in {"txt", "md", "markdown", "json", "csv", "html", "htm"}:
        return [{"text": clean_text(raw.decode("utf-8", errors="replace")), "locator": "document"}]
    if kind == "docx":
        return extract_docx(raw)
    if kind == "pptx":
        return extract_pptx(raw)
    if kind == "xlsx":
        return extract_xlsx(raw)
    if kind == "pdf":
        return extract_pdf(raw)
    raise ValueError(f"Extraction for .{kind} is NOT_IMPLEMENTED")


def main():
    try:
        req = json.load(sys.stdin)
        segments = extract(req)
        segments = [s for s in segments if s.get("text")]
        if not segments:
            raise ValueError("Document contains no extractable text")
        print(json.dumps({"ok": True, "segments": segments}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
