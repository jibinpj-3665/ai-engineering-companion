import json
import re
from typing import List, Optional

_ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
_BLOOM = (
    "Remember", "Understand", "Apply", "Analyze", "Analyse", "Evaluate", "Create",
    "Apply/Analyze", "Analyze/Design", "Understand/Analyze", "Create /Design",
    "Create/Design", "Analyze /Design",
)
_FOOTER_RE = re.compile(r"(sahrdaya college|^department of electronics|^continued on next page|^–\s*continued\s*–)", re.IGNORECASE)
_COURSE_CODE_RE = re.compile(r"\b(\d{2}[A-Z]{2,5}\d{3})\b")
_MODULE_RE = re.compile(
    r"^Module\s+([IVXLCDM]+|\d{1,2})\s*[:\-–—]\s*(.*?)(?:\s*\(([^)]*)\))?\s*$",
    re.IGNORECASE,
)
_TOPIC_NO_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})\s*(.*)$")
_HOURS_ONLY_RE = re.compile(r"^\d{1,2}$")


def _clean(text: str) -> str:
    value = (text or "").replace("\u00ad", "").replace("\u2019", "'").replace("\u2018", "'")
    value = value.replace("\u2013", "-").replace("\u2014", "-")
    return re.sub(r"\s+", " ", value).strip(" :;.-")


def _roman(value: str) -> Optional[int]:
    if value.isdigit():
        return int(value)
    total = 0
    previous = 0
    for char in reversed(value.upper()):
        current = _ROMAN.get(char)
        if current is None:
            return None
        if current < previous:
            total -= current
        else:
            total += current
            previous = current
    return total or None


def _page_lines(pages: List[dict]) -> List[tuple[int, str]]:
    output: List[tuple[int, str]] = []
    for page in pages:
        number = int(page.get("page") or 0)
        if number <= 0:
            continue
        skip_next_number = False
        in_tables = False
        for raw in (page.get("text") or "").splitlines():
            line = re.sub(r"[ \t]+", " ", raw).strip()
            if not line:
                continue
            if line == "[Tables]":
                in_tables = True
                continue
            if in_tables:
                continue
            if _FOOTER_RE.search(line):
                skip_next_number = True
                continue
            if skip_next_number and re.fullmatch(r"\d{1,3}", line):
                skip_next_number = False
                continue
            skip_next_number = False
            output.append((number, line))
    return output


def _join(left: str, right: str) -> str:
    if left.endswith("-") and right and right[0].islower():
        return left[:-1] + right
    return f"{left} {right}".strip()


def _section(lines: List[tuple[int, str]], start: str, stops: List[str]) -> List[tuple[int, str]]:
    output: List[tuple[int, str]] = []
    active = False
    for page, line in lines:
        lowered = line.lower()
        if not active and start.lower() in lowered:
            active = True
            remainder = line[lowered.find(start.lower()) + len(start):].strip(" :")
            if remainder:
                output.append((page, remainder))
            continue
        if active and any(stop.lower() in lowered for stop in stops):
            break
        if active:
            output.append((page, line))
    return output


def _section_text(lines: List[tuple[int, str]]) -> str:
    parts: List[str] = []
    for _page, line in lines:
        if parts:
            parts[-1] = _join(parts[-1], line)
        else:
            parts.append(line)
    return _clean(" ".join(parts))


def _merged_lines(lines: List[tuple[int, str]]) -> List[tuple[int, str]]:
    output: List[tuple[int, str]] = []
    index = 0
    while index < len(lines):
        page, line = lines[index]
        starts_module = re.match(r"^Module\s+", line, re.IGNORECASE)
        has_hours = re.search(r"\([^)]*\)\s*$", line)
        if starts_module and (line.endswith("-") or not has_hours):
            merged = line
            lookahead = index + 1
            while lookahead < len(lines) and lookahead <= index + 3:
                if re.match(r"^Module\s+", lines[lookahead][1], re.IGNORECASE) and not lines[lookahead][1].endswith("-"):
                    break
                merged = _join(merged, lines[lookahead][1])
                lookahead += 1
                if re.search(r"\([^)]*\)\s*$", merged):
                    break
            if re.search(r"\([^)]*\)\s*$", merged):
                output.append((page, merged))
                index = lookahead
                continue
        output.append((page, line))
        index += 1
    return output


def _metadata_text(pages: List[dict]) -> tuple[int, str]:
    for page in pages:
        text = page.get("text") or ""
        if _COURSE_CODE_RE.search(text) and ("Preamble" in text or "Course Outcomes" in text):
            return int(page.get("page") or 1), text
    return 1, pages[0].get("text", "") if pages else ""


def parse_course_metadata(pages: List[dict]) -> dict:
    lines = _page_lines(pages)
    page_number, raw_text = _metadata_text(pages)
    text = _section_text([(page_number, line) for line in raw_text.splitlines() if line.strip()])
    code_match = _COURSE_CODE_RE.search(raw_text)
    code = code_match.group(1) if code_match else ""

    title_lines: List[str] = []
    metadata_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    code_index = next((i for i, line in enumerate(metadata_lines) if code and code in line), -1)
    if code_index >= 0:
        remainder = metadata_lines[code_index].split(code, 1)[1].strip(" :-")
        if remainder:
            title_lines.append(remainder)
        for line in metadata_lines[code_index + 1:]:
            lowered = line.lower()
            if lowered.startswith(("year of", "preamble", "prerequisite", "corequisite", "course outcomes")) or line == "L":
                break
            title_lines.append(line)
            if len(title_lines) > 5:
                break
    title = _clean(" ".join(title_lines))

    ltp_match = re.search(
        r"Year of\s+Introduction\s+L\s*T\s*P\s*R\s*C\s+(\d{4})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)",
        text,
        re.IGNORECASE,
    )
    if not ltp_match:
        fallback = re.search(r"\b(20\d{2})\b(?:\s+\d+){5}", text)
        ltp_match = fallback
    academic_year = ltp_match.group(1) if ltp_match and ltp_match.lastindex and ltp_match.lastindex >= 6 else ""
    ltp = ""
    credits = 0
    if ltp_match and ltp_match.lastindex and ltp_match.lastindex >= 6:
        values = [int(ltp_match.group(i)) for i in range(2, 7)]
        ltp = "-".join(str(value) for value in values)
        credits = values[-1]

    department_match = re.search(r"Department of ([^\n]+)", raw_text)
    department = _clean(department_match.group(1)) if department_match else ""

    preamble = _section_text(_section(lines, "Preamble", ["Prerequisite", "Corequisite", "Course Outcomes"]))
    prerequisites = _section_text(_section(lines, "Prerequisite", ["Corequisite", "Course Outcomes", "CO-PO Mapping"]))
    corequisites = _section_text(_section(lines, "Corequisite", ["Course Outcomes", "CO-PO Mapping"]))

    semester = ""
    semester_source = ""
    all_text = "\n".join(page.get("text") or "" for page in pages)
    explicit = re.search(r"SEMESTER\s+([IVXLCDM]+)", all_text, re.IGNORECASE)
    if explicit:
        value = _roman(explicit.group(1))
        if value:
            semester = f"S{value}"
            semester_source = "explicit"
    if not semester and code:
        match = re.match(r"\d{2}[A-Z]{2,5}(\d)\d{2}", code)
        if match:
            semester = f"S{match.group(1)}"
            semester_source = "inferred_from_course_code"

    books = _parse_books(lines)
    return {
        "code": code,
        "title": title,
        "department": department,
        "semester": semester,
        "semester_source": semester_source,
        "academic_year": academic_year,
        "ltp": ltp,
        "credits": credits,
        "preamble": preamble[:4000],
        "prerequisites": prerequisites[:2000],
        "corequisites": corequisites[:2000],
        "books": books,
        "page": page_number,
        "warnings": [] if code and title else ["Course code or title could not be identified from the document header."],
    }


def _parse_books(lines: List[tuple[int, str]]) -> dict:
    headings = {
        "text_books": ["Text Books"],
        "reference_books": ["Reference Books"],
        "tools": ["Recommended Tools"],
        "courses": ["NPTEL/SWAYAM Courses for reference", "NPTEL/SWAYAM"],
    }
    output = {key: [] for key in headings}
    for key, starts in headings.items():
        for start in starts:
            section = _section(lines, start, ["Reference Books", "Additional Tools", "Recommended Tools", "NPTEL", "Course Contents and Lecture Schedule", "CO Assessment Questions"])
            if not section:
                continue
            for _page, line in section:
                cleaned = _clean(line)
                if not cleaned or cleaned.lower().startswith(("nptel", "reference books", "text books")):
                    continue
                if re.match(r"^\d+[\.\)]\s*", cleaned) or cleaned.startswith("http"):
                    output[key].append(cleaned)
            if output[key]:
                break
    return output


def parse_course_outcomes(pages: List[dict]) -> List[dict]:
    lines = _page_lines(pages)
    active = False
    current: Optional[dict] = None
    outcomes: List[dict] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        description = _clean(" ".join(current["description_lines"]))
        if description:
            outcomes.append({
                "code": f"CO{current['number']}",
                "description": description[:4000],
                "bloom_level": current["bloom"][:60],
                "page": current["page"],
            })
        current = None

    for page, line in lines:
        lowered = line.lower()
        if "course outcomes" in lowered:
            active = True
            continue
        if not active:
            continue
        if any(token in lowered for token in ("co-po mapping", "assessment pattern", "end semester examination (ese) pattern")):
            flush()
            break
        match = re.match(r"^CO\s*-?\s*(\d{1,2})\s*$", line, re.IGNORECASE)
        if match:
            flush()
            current = {"number": int(match.group(1)), "description_lines": [], "bloom": "", "page": page}
            continue
        if current is None:
            continue
        normalized = _clean(line)
        if normalized.lower() in {value.lower() for value in _BLOOM}:
            current["bloom"] = normalized
            flush()
        elif normalized.lower() not in {"description", "co", "bloom's level", "bloom's level"}:
            current["description_lines"].append(normalized)
    flush()
    return outcomes


def parse_co_po_mapping(pages: List[dict], outcomes: List[dict]) -> dict:
    lines = _page_lines(pages)
    active = False
    current = ""
    mapping = {item["code"]: [] for item in outcomes}
    for _page, line in lines:
        lowered = line.lower()
        if "co-po mapping" in lowered:
            active = True
            continue
        if not active:
            continue
        if any(token in lowered for token in ("assessment pattern", "end semester examination (ese) pattern")):
            break
        match = re.match(r"^CO\s*-?\s*(\d{1,2})$", line, re.IGNORECASE)
        if match:
            current = f"CO{int(match.group(1))}"
            mapping.setdefault(current, [])
            continue
        if not current:
            continue
        if line in {"–", "-", "—"}:
            if len(mapping[current]) < 11:
                mapping[current].append(None)
        elif re.fullmatch(r"\d", line):
            if len(mapping[current]) < 11:
                mapping[current].append(int(line))
        elif len(mapping[current]) >= 11:
            current = ""
    return mapping


def parse_modules(pages: List[dict]) -> List[dict]:
    lines = _merged_lines(_page_lines(pages))
    modules: List[dict] = []
    active = False
    current: Optional[dict] = None
    sequence = 0

    def flush() -> None:
        nonlocal current
        if not current:
            return
        description_lines = []
        self_study = 0
        for line in current["body"]:
            if re.match(r"^Self[ -]Study", line, re.IGNORECASE):
                hours = re.search(r"(\d{1,3})\s*(?:hours?|hrs?)", line, re.IGNORECASE)
                if hours:
                    self_study = int(hours.group(1))
                break
            if re.match(r"^Tutorial\b", line, re.IGNORECASE):
                continue
            description_lines.append(line)
        modules.append({
            "number": current["sequence"],
            "label": current["label"],
            "title": current["title"][:300],
            "description": _section_text([(current["page"], line) for line in description_lines])[:5000],
            "lecture_hours": current["lecture"],
            "tutorial_hours": current["tutorial"],
            "practical_hours": current["practical"],
            "self_study_hours": self_study,
            "page_start": current["page_start"],
            "page_end": current["page_end"],
        })
        current = None

    for page, line in lines:
        lowered = line.lower()
        if lowered in {"syllabus", "course contents and lecture schedule"}:
            if lowered == "syllabus":
                active = True
            if lowered == "course contents and lecture schedule":
                flush()
                break
            continue
        if active and any(token in lowered for token in ("text books", "reference books", "additional tools", "co assessment questions")):
            flush()
            break
        match = _MODULE_RE.match(line)
        if active and match:
            flush()
            sequence += 1
            raw_number = match.group(1)
            number = _roman(raw_number)
            title = _clean(match.group(2) or "")
            hours = match.group(3) or ""
            lecture = re.search(r"(\d+)\s*L\b", hours, re.IGNORECASE)
            tutorial = re.search(r"(\d+)\s*T\b", hours, re.IGNORECASE)
            practical = re.search(r"(\d+)\s*P\b", hours, re.IGNORECASE)
            if not lecture:
                lecture = re.search(r"(\d+)\s*hrs?", hours, re.IGNORECASE)
            current = {
                "sequence": sequence,
                "label": f"Module {raw_number.upper() if not raw_number.isdigit() else raw_number}",
                "title": title,
                "page": page,
                "page_start": page,
                "page_end": page,
                "lecture": int(lecture.group(1)) if lecture else 0,
                "tutorial": int(tutorial.group(1)) if tutorial else 0,
                "practical": int(practical.group(1)) if practical else 0,
                "body": [],
            }
            continue
        if current:
            if _MODULE_RE.match(line):
                continue
            current["body"].append(line)
            current["page_end"] = page
    flush()
    return modules


def parse_topics(pages: List[dict], modules: List[dict]) -> List[dict]:
    lines = _merged_lines(_page_lines(pages))
    in_contents = False
    current: Optional[dict] = None
    current_module = 1
    topics: List[dict] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        merged = ""
        for line in current["title_lines"]:
            merged = _join(merged, line) if merged else line
        title = _clean(merged)
        if title:
            topics.append({
                "number": current["number"],
                "module_number": current["module_number"],
                "title": title[:300],
                "content_type": "tutorial" if title.lower().startswith("tutorial") else "topic",
                "hours": current["hours"],
                "page": current["page"],
            })
        current = None

    for page, line in lines:
        lowered = line.lower()
        if "course contents and lecture schedule" in lowered:
            in_contents = True
            continue
        if not in_contents:
            continue
        if "co assessment questions" in lowered:
            flush()
            break
        if " | " in line:
            continue
        module_match = _MODULE_RE.match(line)
        if module_match:
            flush()
            number = _roman(module_match.group(1))
            if number:
                current_module = number
            continue
        topic_match = _TOPIC_NO_RE.match(line)
        if topic_match:
            flush()
            current = {
                "number": f"{int(topic_match.group(1))}.{int(topic_match.group(2))}",
                "module_number": int(topic_match.group(1)),
                "title_lines": [topic_match.group(3)] if topic_match.group(3).strip() else [],
                "hours": 0,
                "page": page,
            }
            continue
        if current is None:
            continue
        if _HOURS_ONLY_RE.match(line):
            current["hours"] = int(line)
            flush()
            continue
        if line.lower().startswith(("continued on next page", "no.", "topic", "hours")):
            continue
        current["title_lines"].append(line)
    flush()

    if not topics:
        return []

    by_number = {module["number"]: module for module in modules}
    for topic in topics:
        module = by_number.get(topic["module_number"])
        if module:
            topic["module_label"] = module["label"]
            topic["module_title"] = module["title"]
            topic["module_id_index"] = modules.index(module)
        else:
            topic["module_label"] = f"Module {topic['module_number']}"
            topic["module_title"] = ""
            topic["module_id_index"] = None
    return topics


def parse_syllabus_pages(pages: List[dict]) -> dict:
    metadata = parse_course_metadata(pages)
    outcomes = parse_course_outcomes(pages)
    co_po = parse_co_po_mapping(pages, outcomes)
    for outcome in outcomes:
        outcome["po_json"] = json.dumps(co_po.get(outcome["code"], []))
    modules = parse_modules(pages)
    topics = parse_topics(pages, modules)
    warnings = list(metadata.get("warnings", []))
    if not outcomes:
        warnings.append("No course outcomes were detected.")
    if not modules:
        warnings.append("No module headings were detected.")
    if not topics:
        warnings.append("No numbered lecture-schedule topics were detected; the generic heuristic parser will be used.")
    for module in modules:
        if module["number"] != _roman(module["label"].replace("Module", "").strip()) and module["label"].upper() != f"MODULE {module['number']}":
            warnings.append(
                f"Source label '{module['label']}' was stored as module sequence {module['number']} ({module['title']}); original label preserved."
            )
    return {
        **metadata,
        "outcomes": outcomes,
        "modules": modules,
        "topics": topics,
        "warnings": warnings,
    }
