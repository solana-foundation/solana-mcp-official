# Databricks notebook source
# MAGIC %md
# MAGIC # Solana MCP — Doc Ingestion
# MAGIC
# MAGIC Reads `sources.yaml`, crawls docs, chunks markdown, MERGEs into the
# MAGIC Delta table pointed to by the `target_table` widget. The Vector Search
# MAGIC Delta-Sync index named by the `vs_index` widget picks up changes on
# MAGIC the next sync.
# MAGIC
# MAGIC **Run-as**: service principal with `USE CATALOG` + `USE SCHEMA` on the
# MAGIC target schema, `SELECT` + `MODIFY` on the target table, `CAN USE` on
# MAGIC the Vector Search endpoint, and outbound internet.

# COMMAND ----------

# MAGIC %pip install --quiet httpx beautifulsoup4 pyyaml markdown-it-py databricks-vectorsearch
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

import hashlib
import logging
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree as ET

import httpx
import yaml
from bs4 import BeautifulSoup
from markdown_it import MarkdownIt

from pyspark.sql import Row
from pyspark.sql.types import (
    ArrayType, StringType, StructField, StructType, TimestampType,
)
from delta.tables import DeltaTable

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ingest")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration

# COMMAND ----------

# Notebook widgets — override at job run time
# Workspace-specific values are passed via Job `base_parameters` (which
# populate widgets). Defaults are placeholders so nothing about a particular
# deployment leaks into the public repo. See ingestion/job.example.yml.
PLACEHOLDER_PREFIX = "<"

dbutils.widgets.text("target_table", "<catalog>.<schema>.docs_chunks")
dbutils.widgets.text("sources_path", "<workspace-path>/sources.yaml")
dbutils.widgets.text("vs_endpoint", "<vector-search-endpoint>")
dbutils.widgets.text("vs_index", "<catalog>.<schema>.docs_chunks_idx")
dbutils.widgets.text("only_sources", "", "comma-separated source ids to restrict run")
dbutils.widgets.text("max_pages_per_source", "2000")

TARGET_TABLE = dbutils.widgets.get("target_table")
SOURCES_PATH = dbutils.widgets.get("sources_path")
VS_ENDPOINT = dbutils.widgets.get("vs_endpoint")
VS_INDEX = dbutils.widgets.get("vs_index")
ONLY_SOURCES = {s.strip() for s in dbutils.widgets.get("only_sources").split(",") if s.strip()}
MAX_PAGES = int(dbutils.widgets.get("max_pages_per_source"))

for _name, _value in {
    "target_table": TARGET_TABLE,
    "sources_path": SOURCES_PATH,
    "vs_endpoint": VS_ENDPOINT,
    "vs_index": VS_INDEX,
}.items():
    if _value.startswith(PLACEHOLDER_PREFIX):
        raise ValueError(
            f"widget `{_name}` still holds placeholder `{_value}`. "
            "Set it via Job base_parameters or the widget bar before running.",
        )

# Token budget approximated as 4 chars/token (English avg). Good enough for
# chunk sizing; embedding model does its own tokenization. Avoids native deps.
CHUNK_CHARS = 2000        # ~500 tokens
CHUNK_OVERLAP_CHARS = 200 # ~50 tokens
HTTP_TIMEOUT_S = 30
USER_AGENT = "solana-mcp-indexer/1.0 (+https://github.com/solana-foundation)"

# COMMAND ----------

# MAGIC %md
# MAGIC ## Data model

# COMMAND ----------

CHUNK_SCHEMA = StructType([
    StructField("id", StringType(), nullable=False),
    StructField("source_id", StringType()),
    StructField("url", StringType()),
    StructField("title", StringType()),
    StructField("heading_path", ArrayType(StringType())),
    StructField("content", StringType()),
    StructField("content_hash", StringType()),
    StructField("fetched_at", TimestampType()),
    StructField("updated_at", TimestampType()),
])

@dataclass
class Chunk:
    id: str
    source_id: str
    url: str
    title: Optional[str]
    heading_path: list[str]
    content: str
    content_hash: str
    fetched_at: datetime
    updated_at: datetime

    def as_row(self) -> Row:
        return Row(**self.__dict__)

# COMMAND ----------

# MAGIC %md
# MAGIC ## HTTP client

# COMMAND ----------

def http_client() -> httpx.Client:
    return httpx.Client(
        timeout=HTTP_TIMEOUT_S,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8"},
    )

# COMMAND ----------

# MAGIC %md
# MAGIC ## Chunking

# COMMAND ----------

_MD = MarkdownIt()

def split_by_chars(text: str, max_chars: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP_CHARS) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    out = []
    step = max_chars - overlap
    for i in range(0, len(text), step):
        out.append(text[i:i + max_chars])
        if i + max_chars >= len(text):
            break
    return out

def markdown_sections(md_text: str) -> list[tuple[list[str], str]]:
    """Yield (heading_path, section_body) by walking markdown headings."""
    tokens = _MD.parse(md_text)
    sections: list[tuple[list[str], list[str]]] = []
    path: list[tuple[int, str]] = []  # (level, text)
    buf: list[str] = []
    current_path: list[str] = []

    def flush():
        if buf and "".join(buf).strip():
            sections.append((list(current_path), "\n".join(buf).strip()))

    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.type == "heading_open":
            flush()
            buf.clear()
            level = int(t.tag[1])
            inline = tokens[i + 1].content if i + 1 < len(tokens) else ""
            while path and path[-1][0] >= level:
                path.pop()
            path.append((level, inline))
            current_path = [p[1] for p in path]
            i += 3  # heading_open, inline, heading_close
            continue
        if t.type == "inline":
            buf.append(t.content)
        elif t.type == "fence":
            buf.append(f"```{t.info or ''}\n{t.content}```")
        elif t.type == "code_block":
            buf.append(t.content)
        i += 1
    flush()
    return [(p, b) for p, b in sections if b.strip()]

def chunks_from_markdown(source_id: str, url: str, title: Optional[str], md_text: str, now: datetime) -> list[Chunk]:
    out: list[Chunk] = []
    sections = markdown_sections(md_text) or [([], md_text)]
    for heading_path, body in sections:
        for piece in split_by_chars(body):
            content_hash = hashlib.sha256(piece.encode("utf-8")).hexdigest()
            cid = hashlib.sha256(f"{source_id}|{url}|{'/'.join(heading_path)}|{content_hash}".encode()).hexdigest()
            out.append(Chunk(
                id=cid,
                source_id=source_id,
                url=url,
                title=title or (heading_path[0] if heading_path else url),
                heading_path=heading_path,
                content=piece,
                content_hash=content_hash,
                fetched_at=now,
                updated_at=now,
            ))
    return out

# COMMAND ----------

# MAGIC %md
# MAGIC ## Web crawler

# COMMAND ----------

def fetch_sitemap(client: httpx.Client, sitemap_url: str) -> list[str]:
    try:
        r = client.get(sitemap_url)
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("sitemap fetch failed %s: %s", sitemap_url, e)
        return []
    urls: list[str] = []
    try:
        root = ET.fromstring(r.text)
    except ET.ParseError:
        return []
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    for sm in root.findall("sm:sitemap", ns):
        loc = sm.findtext("sm:loc", namespaces=ns)
        if loc:
            urls.extend(fetch_sitemap(client, loc))
    for url in root.findall("sm:url", ns):
        loc = url.findtext("sm:loc", namespaces=ns)
        if loc:
            urls.append(loc)
    return urls

def extract_article(html: str) -> tuple[str, str]:
    """Return (title, markdown-ish text) from HTML."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()
    title = (soup.title.string.strip() if soup.title and soup.title.string else "") or ""
    main = soup.find("main") or soup.find("article") or soup.body or soup
    text = main.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title, text

def url_matches_include(url: str, patterns: list[str]) -> bool:
    if not patterns:
        return True
    lowered = url.lower()
    return any(p.lower() in lowered for p in patterns)

def url_matches_exclude(url: str, patterns: list[str]) -> bool:
    if not patterns:
        return False
    lowered = url.lower()
    return any(p.lower() in lowered for p in patterns)

# Generic non-English locale path segments commonly used by docs platforms
# (Fumadocs, Nextra, Docusaurus i18n, Mintlify). English pages live at root
# or under `/en/`, so these are always safe to skip.
LOCALE_PATTERN = re.compile(
    r"/(de|es|fr|ja|ko|ru|zh|zh-cn|zh-tw|pt|pt-br|it|tr|vi|id|ar|hi|th|pl|nl|cs|uk|sv|no|da|fi|el|ro|hu|he|bn|uz|tl|sr|hr|bg|ca|sk|sl|lt|lv|et|ms|fa|ur)(/|$)",
    re.IGNORECASE,
)

def is_non_en_locale(url: str) -> bool:
    path = urlparse(url).path
    return bool(LOCALE_PATTERN.search(path))

def normalize_url(url: str) -> str:
    """Canonical URL: force https, lowercase host, strip trailing slash + fragment."""
    p = urlparse(url.split("#", 1)[0])
    netloc = p.netloc.lower()
    if not netloc:
        return url
    scheme = "https"
    path = p.path.rstrip("/") or "/"
    query = f"?{p.query}" if p.query else ""
    return f"{scheme}://{netloc}{path}{query}"

def crawl_web(source: dict, client: httpx.Client, now: datetime) -> list[Chunk]:
    source_id = source["id"]
    includes = source.get("url_include") or []
    excludes = source.get("url_exclude") or []
    skip_locales = source.get("skip_locales", True)

    def accept(url: str) -> bool:
        if not url_matches_include(url, includes):
            return False
        if url_matches_exclude(url, excludes):
            return False
        if skip_locales and is_non_en_locale(url):
            return False
        return True

    seen: set[str] = set()
    urls: list[str] = []

    for sm in source.get("sitemaps") or []:
        urls.extend(fetch_sitemap(client, sm))
    for u in source.get("ingest_urls") or []:
        urls.append(u)
    start_urls = source.get("start_urls") or []
    if not urls and start_urls:
        urls = list(start_urls)  # BFS-lite from start urls
        base_hosts = {urlparse(u).netloc for u in start_urls}
        queue = list(start_urls)
        while queue and len(urls) < MAX_PAGES:
            cur = queue.pop(0)
            if cur in seen:
                continue
            seen.add(cur)
            try:
                r = client.get(cur)
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    continue
            except httpx.HTTPError:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                nxt = normalize_url(urljoin(cur, a["href"]))
                if urlparse(nxt).netloc in base_hosts and nxt not in seen and nxt.startswith("http"):
                    if nxt not in urls and accept(nxt):
                        urls.append(nxt)
                        queue.append(nxt)

    # Normalize + deduplicate all collected URLs (sitemap + ingest + BFS)
    normalized: list[str] = []
    dedupe: set[str] = set()
    for u in urls:
        n = normalize_url(u)
        if n in dedupe:
            continue
        dedupe.add(n)
        normalized.append(n)
    urls = normalized

    before = len(urls)
    urls = [u for u in urls if accept(u)]
    if before != len(urls):
        log.info("source %s: filters dropped %d → %d urls", source_id, before, len(urls))

    urls = urls[:MAX_PAGES]
    log.info("source %s: %d urls", source_id, len(urls))

    chunks: list[Chunk] = []
    for u in urls:
        if u in seen and not (source.get("sitemaps") or source.get("ingest_urls")):
            pass  # BFS already visited; refetch fine for content extraction
        try:
            r = client.get(u)
            if r.status_code != 200:
                continue
            ctype = r.headers.get("content-type", "")
            if "text/html" not in ctype:
                continue
            title, text = extract_article(r.text)
            chunks.extend(chunks_from_markdown(source_id, u, title, text, now))
        except httpx.HTTPError as e:
            log.warning("fetch %s failed: %s", u, e)
        time.sleep(0.1)  # light throttle
    return chunks

# COMMAND ----------

# MAGIC %md
# MAGIC ## GitHub crawler (shallow clone)

# COMMAND ----------

GH_DOC_EXTS = {".md", ".mdx"}
GH_CODE_EXTS = {".rs", ".ts", ".tsx", ".js", ".py", ".go"}

def crawl_github(source: dict, now: datetime) -> list[Chunk]:
    source_id = source["id"]
    gh = source["github"]
    owner, repo = gh["owner"], gh["repo"]
    include_src = bool(gh.get("include_source_code"))
    repo_url = f"https://github.com/{owner}/{repo}.git"

    chunks: list[Chunk] = []
    with tempfile.TemporaryDirectory() as tmp:
        dst = Path(tmp) / repo
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", "--filter=blob:none", repo_url, str(dst)],
                check=True, capture_output=True, text=True,
            )
        except subprocess.CalledProcessError as e:
            log.warning("clone %s failed: %s", repo_url, e.stderr)
            return chunks

        for f in dst.rglob("*"):
            if not f.is_file():
                continue
            ext = f.suffix.lower()
            rel = f.relative_to(dst).as_posix()
            if ext in GH_DOC_EXTS:
                body = f.read_text(encoding="utf-8", errors="ignore")
                url = f"https://github.com/{owner}/{repo}/blob/HEAD/{rel}"
                title = f"{repo}/{rel}"
                chunks.extend(chunks_from_markdown(source_id, url, title, body, now))
            elif include_src and ext in GH_CODE_EXTS:
                body = f.read_text(encoding="utf-8", errors="ignore")
                if len(body) > 200_000:
                    continue  # skip giant generated files
                url = f"https://github.com/{owner}/{repo}/blob/HEAD/{rel}"
                title = f"{repo}/{rel}"
                wrapped = f"```{ext.lstrip('.')}\n{body}\n```"
                chunks.extend(chunks_from_markdown(source_id, url, title, wrapped, now))
    log.info("source %s: %d chunks", source_id, len(chunks))
    return chunks

# COMMAND ----------

# MAGIC %md
# MAGIC ## OpenAPI crawler

# COMMAND ----------

def crawl_openapi(source: dict, client: httpx.Client, now: datetime) -> list[Chunk]:
    source_id = source["id"]
    spec_url = source["spec_url"]
    citation = source.get("primary_url") or spec_url
    try:
        r = client.get(spec_url)
        r.raise_for_status()
        spec = r.json()
    except (httpx.HTTPError, ValueError) as e:
        log.warning("openapi fetch %s failed: %s", spec_url, e)
        return []

    chunks: list[Chunk] = []
    paths = spec.get("paths") or {}
    for path, methods in paths.items():
        for method, op in (methods or {}).items():
            if method.lower() not in {"get", "post", "put", "delete", "patch"}:
                continue
            summary = op.get("summary") or ""
            desc = op.get("description") or ""
            params = op.get("parameters") or []
            param_lines = [f"- `{p.get('name')}` ({p.get('in')}): {p.get('description','')}" for p in params]
            body = f"## {method.upper()} {path}\n\n{summary}\n\n{desc}\n\n### Parameters\n" + "\n".join(param_lines)
            chunks.extend(chunks_from_markdown(
                source_id, f"{citation}#{method.upper()}-{path}",
                f"{method.upper()} {path}", body, now,
            ))
    return chunks

# COMMAND ----------

# MAGIC %md
# MAGIC ## Orchestrator

# COMMAND ----------

def load_sources() -> list[dict]:
    with open(SOURCES_PATH) as f:
        doc = yaml.safe_load(f)
    items = doc.get("sources") or []
    if ONLY_SOURCES:
        items = [s for s in items if s["id"] in ONLY_SOURCES]
    return [s for s in items if s.get("enabled", True)]

def crawl_all(now: datetime) -> list[Chunk]:
    all_chunks: list[Chunk] = []
    with http_client() as client:
        for s in load_sources():
            kind = s["kind"]
            log.info("=== crawling %s (%s) ===", s["id"], kind)
            try:
                if kind == "web":
                    all_chunks.extend(crawl_web(s, client, now))
                elif kind == "github":
                    all_chunks.extend(crawl_github(s, now))
                elif kind == "openapi":
                    all_chunks.extend(crawl_openapi(s, client, now))
                else:
                    log.warning("unknown kind %s for %s", kind, s["id"])
            except Exception as e:
                log.exception("source %s crashed: %s", s["id"], e)
    return all_chunks

# COMMAND ----------

# MAGIC %md
# MAGIC ## Run

# COMMAND ----------

now = datetime.now(timezone.utc)
chunks = crawl_all(now)
log.info("total chunks: %d", len(chunks))

if not chunks:
    raise RuntimeError("no chunks produced — check source errors above")

df = spark.createDataFrame([c.as_row() for c in chunks], schema=CHUNK_SCHEMA)
df = df.dropDuplicates(["id"])
log.info("df row count: %d", df.count())

# COMMAND ----------

# MAGIC %md
# MAGIC ## MERGE into Delta

# COMMAND ----------

target = DeltaTable.forName(spark, TARGET_TABLE)
(target.alias("t")
    .merge(df.alias("s"), "t.id = s.id")
    .whenMatchedUpdate(
        condition="t.content_hash <> s.content_hash",
        set={
            "content": "s.content",
            "content_hash": "s.content_hash",
            "title": "s.title",
            "heading_path": "s.heading_path",
            "url": "s.url",
            "updated_at": "s.updated_at",
        },
    )
    .whenNotMatchedInsertAll()
    .execute())

post = spark.sql(f"SELECT count(*) AS n FROM {TARGET_TABLE}").collect()[0]["n"]
log.info("target table %s now holds %d rows", TARGET_TABLE, post)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Trigger Vector Search sync

# COMMAND ----------

from databricks.vector_search.client import VectorSearchClient

vsc = VectorSearchClient(disable_notice=True)
idx = vsc.get_index(index_name=VS_INDEX, endpoint_name=VS_ENDPOINT)
idx.sync()
log.info("triggered sync on %s", VS_INDEX)
