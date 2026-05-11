
function _showFatalError(msg) {
  try {
    const root = document.getElementById("page");
    if (root && root.children.length === 0) {
      root.innerHTML =
        '<div style="padding:1.2rem;color:#c44;font-size:0.85em;font-family:ui-monospace,monospace;white-space:pre-wrap;line-height:1.5;">앱 오류 발생:\n' +
        String(msg).replace(/&/g, "&amp;").replace(/</g, "&lt;") +
        '\n\n[해결] 브라우저에서 강제 새로고침해 주세요.\n  iOS Safari: 주소바 풀다운\n  PC: ⌘+Shift+R</div>';
    }
  } catch {}
}
window.addEventListener("error", e => _showFatalError((e.message || "error") + " (" + (e.filename || "") + ":" + (e.lineno || "") + ")"));
window.addEventListener("unhandledrejection", e => _showFatalError("Promise: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));

const SUTTA_PATH = "data/sutta/sn1.8-metta.json";
const WORDS_PER_PAGE = 4;
const QUIZ_COUNT = 10;
const STORAGE_KEY_PREFIX = "suttalog5:wrong:";
const MEMO_PREFIX = "suttalog5:memo:";
const MEMO_INDEX_KEY = "suttalog5:memo_index";
const MEMO_REPO = "ReachToWisdom/SuttaLog5";
const SETTINGS_KEY = "suttalog5:settings";
const WRONG_COUNT_KEY = "suttalog5:wrong_count";
const EXPOSURE_KEY = "suttalog5:exposure";
const VISITS_KEY = "suttalog5:visits";
const LAST_PAGE_KEY = "suttalog5:last_page";
const STUDY_DAYS_KEY = "suttalog5:study_days";
const DEFAULT_SETTINGS = { lotusMax: 5, wordLimit: 3, grammarLimit: 3 };

const state = { sutta: null, pages: [], pageIdx: 0 };
const quizState = { mode: "all", questions: [], idx: 0, correct: 0, answered: false };
let _githubMemosCache = null;

try { localStorage.removeItem("suttalog5:gh_pat"); } catch {}

async function init() {
  try {
    state.sutta = await fetch(SUTTA_PATH).then(r => {
      if (!r.ok) throw new Error("fetch failed: " + r.status);
      return r.json();
    });
  } catch (err) {
    document.getElementById("page").innerHTML =
      '<div style="padding:2rem;color:#c33;">데이터 로드 실패: ' + err.message + '</div>';
    return;
  }
  state.pages = buildPages(state.sutta);
  const fromHash = parseHash();
  if (fromHash !== null) {
    state.pageIdx = fromHash;
  } else {
    const lastId = localStorage.getItem(LAST_PAGE_KEY);
    if (lastId) {
      for (let i = 0; i < state.pages.length; i++) {
        if (computePageId(state.pages[i], i) === lastId) {
          state.pageIdx = i;
          break;
        }
      }
    }
  }
  attachNav();
  render();
  getGithubMemos().then(() => updateMemoFab());
}

function buildPages(sutta) {
  const pages = [{ kind: "cover" }];
  const allMeanings = collectAllMeanings(sutta);
  const quizzedTerms = new Set();
  for (const verse of sutta.verses) {
    const words = verse.words || [];
    const wordPageCount = Math.ceil(words.length / WORDS_PER_PAGE);
    for (let i = 0; i < wordPageCount; i++) {
      pages.push({
        kind: "words", verse,
        words: words.slice(i * WORDS_PER_PAGE, (i + 1) * WORDS_PER_PAGE),
        wordPageIdx: i + 1,
        totalWordPages: wordPageCount,
      });
    }
    if (verse.translations && Object.keys(verse.translations).length) {
      pages.push({ kind: "trans", verse });
    }
    const qs = buildVerseQuestions(verse, allMeanings, quizzedTerms);
    for (let i = 0; i < qs.length; i++) {
      pages.push({
        kind: "verseQuiz", verse,
        question: qs[i],
        quizIdx: i + 1,
        quizTotal: qs.length,
      });
    }
  }
  return pages;
}

function collectAllMeanings(sutta) {
  const map = new Map();
  for (const v of sutta.verses) {
    for (const w of v.words || []) {
      const m = parseGloss(w.gloss).meaning;
      if (!m || m.length < 2) continue;
      if (!map.has(w.term)) map.set(w.term, { term: w.term, meaning: m, verseN: v.n });
    }
  }
  return Array.from(map.values());
}

function buildVerseQuestions(verse, allMeanings, quizzedTerms) {
  const seen = new Set();
  const versePool = [];
  for (const w of verse.words || []) {
    if (seen.has(w.term)) continue;
    if (quizzedTerms.has(w.term)) continue;
    const m = parseGloss(w.gloss).meaning;
    if (!m || m.length < 2) continue;
    versePool.push({ term: w.term, meaning: m, verseN: verse.n });
    seen.add(w.term);
    quizzedTerms.add(w.term);
  }
  if (versePool.length === 0) return [];
  const meaningPool = Array.from(new Set(allMeanings.map(w => w.meaning)));
  return versePool.map(q => {
    const distractors = shuffle(meaningPool.filter(m => m !== q.meaning)).slice(0, 3);
    const options = shuffle([q.meaning, ...distractors]);
    return {
      term: q.term, verseN: q.verseN, options,
      answerIdx: options.indexOf(q.meaning),
      userIdx: null, answered: false,
    };
  });
}

function parseHash() {
  const m = location.hash.match(/^#p(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Math.max(0, Math.min(n - 1, state.pages.length - 1));
}
function syncHash() {
  const id = `p${String(state.pageIdx + 1).padStart(3, "0")}`;
  if (location.hash !== "#" + id) location.hash = id;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function parseGloss(gloss) {
  if (!gloss) return { grammar: null, meaning: "" };
  const m = gloss.match(/^\(([^)]+)\)\s*(.*)$/);
  if (m) return { grammar: m[1].trim(), meaning: m[2].trim() };
  return { grammar: null, meaning: gloss.trim() };
}

function lookupWord(token, words) {
  if (!token) return null;
  const cleaned = token.toLowerCase().replace(/[.,;:?!"'’“”]/g, "").trim();
  if (!cleaned) return null;
  let entry = words.find(w => w.term.toLowerCase() === cleaned);
  if (entry) return entry;
  const norm = s => s.toLowerCase().replace(/ṁ/g, "ṃ");
  entry = words.find(w => norm(w.term) === norm(cleaned));
  if (entry) return entry;
  const candidates = words
    .filter(w => w.term.length >= 4 && norm(cleaned).includes(norm(w.term)))
    .sort((a, b) => b.term.length - a.term.length);
  return candidates[0] || null;
}

function makePaliClickable(text, words) {
  const frag = document.createDocumentFragment();
  const parts = text.split(/(\s+|[,.])/);
  for (const part of parts) {
    if (!part || /^[\s,.]+$/.test(part)) {
      frag.appendChild(document.createTextNode(part));
      continue;
    }
    const entry = lookupWord(part, words);
    if (entry) {
      const span = el("span", "pali-tok", part);
      span.addEventListener("click", e => {
        e.stopPropagation();
        openDictionary(entry);
      });
      frag.appendChild(span);
    } else {
      frag.appendChild(document.createTextNode(part));
    }
  }
  return frag;
}

function openDictionary(word) {
  closeDictionary();
  const overlay = el("div", "dict-overlay");
  overlay.id = "dict-overlay";
  const sheet = el("div", "dict-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeDictionary);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", word.term));
  const { grammar, meaning } = parseGloss(word.gloss);
  if (grammar) {
    sheet.appendChild(el("div", "dict-section-label", "문법"));
    sheet.appendChild(el("div", "dict-grammar", grammar));
  }
  if (meaning) {
    sheet.appendChild(el("div", "dict-section-label", "뜻"));
    sheet.appendChild(el("div", "dict-meaning", meaning));
  }
  if (word.extras && word.extras.length) {
    sheet.appendChild(el("div", "dict-section-label", "주석·인용"));
    sheet.appendChild(el("div", "dict-extras", word.extras.join("\n\n")));
  }
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeDictionary(); });
  document.body.appendChild(overlay);
}
function closeDictionary() {
  const o = document.getElementById("dict-overlay");
  if (o) o.remove();
}

function storageKey() { return STORAGE_KEY_PREFIX + (state.sutta ? state.sutta.id : "unknown"); }
function loadWrongTerms() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function saveWrongTerms(set) {
  try { localStorage.setItem(storageKey(), JSON.stringify([...set])); } catch {}
}
function addWrongTerm(term) {
  const s = loadWrongTerms();
  s.add(term);
  saveWrongTerms(s);
}
function removeWrongTerm(term) {
  const s = loadWrongTerms();
  s.delete(term);
  saveWrongTerms(s);
}

function loadMemoIndex() {
  try {
    const raw = localStorage.getItem(MEMO_INDEX_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function saveMemoIndex(set) { localStorage.setItem(MEMO_INDEX_KEY, JSON.stringify([...set])); }
function pageHasMemo(pageId) { return loadMemoIndex().has(pageId); }
function markPageMemo(pageId, has) {
  const s = loadMemoIndex();
  if (has) s.add(pageId); else s.delete(pageId);
  saveMemoIndex(s);
}

function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function setSettingValue(key, value) {
  const s = getSettings();
  s[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function loadExposure() {
  try {
    const raw = localStorage.getItem(EXPOSURE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { terms: {}, grammar: {} };
}
function saveExposure(e) { localStorage.setItem(EXPOSURE_KEY, JSON.stringify(e)); }
function resetExposureAndVisits() {
  localStorage.removeItem(EXPOSURE_KEY);
  localStorage.removeItem(VISITS_KEY);
}
function loadVisits() {
  try {
    const raw = localStorage.getItem(VISITS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {}
  return new Set();
}
function saveVisits(s) { localStorage.setItem(VISITS_KEY, JSON.stringify([...s])); }
function recordPageExposure(pageId, words) {
  const visits = loadVisits();
  if (visits.has(pageId)) return;
  visits.add(pageId);
  saveVisits(visits);
  const e = loadExposure();
  for (const w of words || []) {
    const { grammar } = parseGloss(w.gloss);
    e.terms[w.term] = (e.terms[w.term] || 0) + 1;
    if (grammar) e.grammar[grammar] = (e.grammar[grammar] || 0) + 1;
  }
  saveExposure(e);
}
function isOverLimit(count, limit) { return limit > 0 && count >= limit; }

function getWrongCount() { return parseInt(localStorage.getItem(WRONG_COUNT_KEY) || "0", 10); }
function incrementWrongCount() {
  const cur = getWrongCount() + 1;
  localStorage.setItem(WRONG_COUNT_KEY, String(cur));
  updateLotusRow();
  return cur;
}
function resetWrongCount() {
  localStorage.setItem(WRONG_COUNT_KEY, "0");
  updateLotusRow();
}
function updateLotusRow() {
  const row = document.getElementById("lotus-row");
  if (!row) return;
  row.innerHTML = "";
  const s = getSettings();
  const wrong = Math.min(getWrongCount(), s.lotusMax);
  for (let i = 0; i < s.lotusMax; i++) {
    const span = el("span", "lotus" + (i < wrong ? " filled" : ""));
    span.textContent = i < wrong ? "🪷" : "·";
    row.appendChild(span);
  }
}

function loadStudyDays() {
  try {
    const raw = localStorage.getItem(STUDY_DAYS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}
function saveStudyDays(d) { localStorage.setItem(STUDY_DAYS_KEY, JSON.stringify(d)); }
function recordStudyToday() {
  const today = new Date().toISOString().slice(0, 10);
  const d = loadStudyDays();
  d[today] = (d[today] || 0) + 1;
  saveStudyDays(d);
}
function resetStudyDays() { localStorage.removeItem(STUDY_DAYS_KEY); }

function computePageId(p, fallbackIdx) {
  if (!p) return "p" + (fallbackIdx + 1);
  if (p.kind === "cover") return "cover";
  if (p.kind === "words") return `v${p.verse.n}-w${p.wordPageIdx}`;
  if (p.kind === "trans") return `v${p.verse.n}-trans`;
  if (p.kind === "verseQuiz") return `v${p.verse.n}-q${p.quizIdx}`;
  return "p" + (fallbackIdx + 1);
}
function currentPageId() { return computePageId(state.pages[state.pageIdx], state.pageIdx); }

function pageSnapshot() {
  const p = state.pages[state.pageIdx];
  const snap = { kind: p.kind, sutta_id: state.sutta.id };
  if (p.verse) { snap.verseN = p.verse.n; snap.pali = p.verse.pali; }
  if (p.kind === "words") {
    snap.wordPageIdx = p.wordPageIdx;
    snap.terms = (p.words || []).map(w => w.term);
  }
  return snap;
}

function getMemo(pageId) {
  const raw = localStorage.getItem(MEMO_PREFIX + pageId);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function saveMemo(pageId, text) {
  const memo = {
    page_id: pageId,
    page_snapshot: pageSnapshot(),
    memo: text,
    status: "active",
    updated_at: new Date().toISOString(),
  };
  localStorage.setItem(MEMO_PREFIX + pageId, JSON.stringify(memo));
  markPageMemo(pageId, !!text);
  return memo;
}
function deleteMemo(pageId) {
  localStorage.removeItem(MEMO_PREFIX + pageId);
  markPageMemo(pageId, false);
}
function listAllMemos() {
  const index = loadMemoIndex();
  const result = [];
  for (const pageId of index) {
    const m = getMemo(pageId);
    if (m && m.memo) result.push(m);
  }
  return result.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

async function fetchGithubMemos() {
  try {
    const resp = await fetch(`https://api.github.com/repos/${MEMO_REPO}/contents/memos`);
    if (resp.status === 404) return [];
    if (!resp.ok) return [];
    const files = await resp.json();
    if (!Array.isArray(files)) return [];
    const results = await Promise.all(
      files.filter(f => f.name && f.name.endsWith(".json") && f.type === "file")
        .map(async f => {
          try {
            const r = await fetch(f.download_url);
            if (!r.ok) return null;
            const memo = await r.json();
            memo._source = "github";
            return memo;
          } catch { return null; }
        })
    );
    return results.filter(m => m && m.memo);
  } catch { return []; }
}
async function getGithubMemos() {
  if (_githubMemosCache === null) _githubMemosCache = await fetchGithubMemos();
  return _githubMemosCache;
}

function describeCurrentPage() {
  const p = state.pages[state.pageIdx];
  if (!p) return "";
  if (p.kind === "cover") return "표지";
  if (p.kind === "words") return `${p.verse.n}게송 · 단어 ${p.wordPageIdx}/${p.totalWordPages}`;
  if (p.kind === "trans") return `${p.verse.n}게송 · 독해`;
  if (p.kind === "verseQuiz") return `${p.verse.n}게송 · 문제 ${p.quizIdx}/${p.quizTotal}`;
  return "";
}

function closeMemoSheet() {
  const o = document.getElementById("memo-overlay");
  if (o) o.remove();
}

async function openMemoSheet() {
  closeMemoSheet();
  const pageId = currentPageId();
  const overlay = el("div", "dict-overlay");
  overlay.id = "memo-overlay";
  const sheet = el("div", "dict-sheet memo-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeMemoSheet);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", `메모 · ${pageId}`));
  sheet.appendChild(el("div", "memo-page-info", describeCurrentPage()));
  const local = getMemo(pageId);
  const remote = local ? null : (await getGithubMemos()).find(m => m.page_id === pageId);
  const memo = local || remote;
  if (remote && !local) {
    sheet.appendChild(el("div", "memo-source-note",
      "🌐 공유된 메모입니다. 수정하면 본인 기기에만 저장됩니다."));
  }
  const textarea = el("textarea", "memo-textarea");
  textarea.placeholder = "이 페이지 메모 — 오타, 의견, 인용 등.\n수정 후 [저장] 클릭.";
  textarea.value = memo?.memo || "";
  sheet.appendChild(textarea);
  if (memo?.updated_at) {
    sheet.appendChild(el("div", "memo-updated",
      `최종 수정: ${new Date(memo.updated_at).toLocaleString()}`));
  }
  const actions = el("div", "memo-actions");
  const saveBtn = el("button", "btn-primary", memo ? "수정 저장" : "저장");
  saveBtn.addEventListener("click", () => {
    const text = textarea.value.trim();
    if (!text) { alert("메모 내용을 입력하세요."); return; }
    saveMemo(pageId, text);
    updateMemoFab();
    closeMemoSheet();
  });
  actions.appendChild(saveBtn);
  if (memo?.memo) {
    const delBtn = el("button", "btn-text", "삭제");
    delBtn.style.color = "#c44a4a";
    delBtn.addEventListener("click", () => {
      if (!confirm("이 메모를 삭제할까요?")) return;
      deleteMemo(pageId);
      updateMemoFab();
      closeMemoSheet();
    });
    actions.appendChild(delBtn);
  }
  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeMemoSheet(); });
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 50);
}

async function updateMemoFab() {
  const fab = document.getElementById("memo-fab");
  if (!fab) return;
  const pageId = currentPageId();
  fab.classList.remove("has-memo", "has-local-memo");
  if (pageHasMemo(pageId)) {
    fab.classList.add("has-memo", "has-local-memo");
    return;
  }
  const remote = await getGithubMemos();
  if (remote.some(m => m.page_id === pageId)) {
    fab.classList.add("has-memo");
  }
}

function navigateToPageId(pageId) {
  for (let i = 0; i < state.pages.length; i++) {
    if (computePageId(state.pages[i], i) === pageId) {
      state.pageIdx = i;
      render();
      return true;
    }
  }
  return false;
}

function downloadMemosJson() {
  const memos = listAllMemos();
  if (memos.length === 0) { alert("내보낼 메모가 없습니다."); return; }
  const data = JSON.stringify({
    exported_at: new Date().toISOString(),
    sutta_id: state.sutta.id,
    sutta_title: state.sutta.title,
    memos,
  }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `suttalog5-memos-${state.sutta.id}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

async function openMemoList() {
  closeMemoSheet(); closeDictionary(); closeQuiz();
  closeTOC(); closeSettings(); closeCalendar();
  const overlay = el("div", "dict-overlay");
  overlay.id = "memo-overlay";
  const sheet = el("div", "dict-sheet memo-list-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeMemoSheet);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", "메모 목록"));
  const loading = el("div", "memo-loading", "공유 메모 로딩…");
  sheet.appendChild(loading);
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeMemoSheet(); });
  document.body.appendChild(overlay);
  const localMemos = listAllMemos().map(m => ({ ...m, _source: "local" }));
  const remoteMemos = await getGithubMemos();
  loading.remove();
  const byId = new Map();
  for (const m of remoteMemos) byId.set(m.page_id, m);
  for (const m of localMemos) byId.set(m.page_id, m);
  const memos = Array.from(byId.values())
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  if (memos.length === 0) {
    sheet.appendChild(el("div", "memo-empty",
      "아직 메모가 없습니다.\n페이지에서 ✏️ 버튼으로 추가하세요."));
  } else {
    sheet.appendChild(el("div", "memo-count", `${memos.length}개의 메모`));
    const list = el("div", "memo-list");
    for (const memo of memos) {
      const item = el("div", "memo-item");
      const headRow = el("div", "memo-item-head");
      const idGroup = el("div", "memo-item-id-group");
      idGroup.appendChild(el("span", "memo-item-id", memo.page_id));
      idGroup.appendChild(el("span",
        "memo-item-source " + (memo._source === "github" ? "src-github" : "src-local"),
        memo._source === "github" ? "🌐 공유됨" : "📱 본인"));
      headRow.appendChild(idGroup);
      const goBtn = el("button", "memo-item-go", "→ 이동");
      goBtn.addEventListener("click", () => {
        if (navigateToPageId(memo.page_id)) closeMemoSheet();
      });
      headRow.appendChild(goBtn);
      item.appendChild(headRow);
      item.appendChild(el("div", "memo-item-preview", memo.memo));
      if (memo.updated_at) {
        item.appendChild(el("div", "memo-item-date",
          new Date(memo.updated_at).toLocaleString()));
      }
      const actions = el("div", "memo-item-actions");
      if (memo._source === "github") {
        const viewBtn = el("button", "btn-text-small", "🔍 페이지 열기");
        viewBtn.addEventListener("click", () => {
          if (navigateToPageId(memo.page_id)) closeMemoSheet();
        });
        actions.appendChild(viewBtn);
      } else {
        const editBtn = el("button", "btn-text-small", "✎ 수정");
        editBtn.addEventListener("click", () => {
          if (navigateToPageId(memo.page_id)) setTimeout(openMemoSheet, 100);
        });
        actions.appendChild(editBtn);
        const delBtn = el("button", "btn-text-small btn-danger", "🗑 삭제");
        delBtn.addEventListener("click", () => {
          if (!confirm(`"${memo.page_id}" 메모를 삭제할까요?`)) return;
          deleteMemo(memo.page_id);
          openMemoList();
        });
        actions.appendChild(delBtn);
      }
      item.appendChild(actions);
      list.appendChild(item);
    }
    sheet.appendChild(list);
    const exportBtn = el("button", "btn-secondary", "📥 전체 메모 JSON 다운로드");
    exportBtn.addEventListener("click", downloadMemosJson);
    sheet.appendChild(exportBtn);
  }
}

function closeSettings() {
  const o = document.getElementById("settings-overlay");
  if (o) o.remove();
}

function openSettings() {
  closeSettings(); closeMemoSheet(); closeDictionary();
  closeQuiz(); closeTOC(); closeCalendar();
  const overlay = el("div", "dict-overlay");
  overlay.id = "settings-overlay";
  const sheet = el("div", "dict-sheet settings-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeSettings);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", "환경설정"));
  const s = getSettings();

  sheet.appendChild(el("div", "dict-section-label", "도전 횟수 (🪷 연꽃 개수)"));
  const lg = el("div", "settings-radio");
  for (const n of [3, 5, 7, 10]) {
    const b = el("button", "settings-radio-btn" + (s.lotusMax === n ? " active" : ""), `${n}개`);
    b.addEventListener("click", () => {
      setSettingValue("lotusMax", n);
      updateLotusRow();
      openSettings();
    });
    lg.appendChild(b);
  }
  sheet.appendChild(lg);

  sheet.appendChild(el("div", "dict-section-label", "단어 노출 횟수"));
  const wg = el("div", "settings-radio");
  for (const n of [1, 2, 3, 5, 0]) {
    const b = el("button", "settings-radio-btn" + (s.wordLimit === n ? " active" : ""),
      n === 0 ? "∞" : `${n}회`);
    b.addEventListener("click", () => {
      setSettingValue("wordLimit", n);
      render();
      openSettings();
    });
    wg.appendChild(b);
  }
  sheet.appendChild(wg);

  sheet.appendChild(el("div", "dict-section-label", "문법 노출 횟수"));
  const gg = el("div", "settings-radio");
  for (const n of [1, 2, 3, 5, 0]) {
    const b = el("button", "settings-radio-btn" + (s.grammarLimit === n ? " active" : ""),
      n === 0 ? "∞" : `${n}회`);
    b.addEventListener("click", () => {
      setSettingValue("grammarLimit", n);
      render();
      openSettings();
    });
    gg.appendChild(b);
  }
  sheet.appendChild(gg);

  sheet.appendChild(el("div", "dict-section-label", "복습"));
  const wrongSet = loadWrongTerms();
  const reviewBtn = el("button", "btn-secondary",
    wrongSet.size > 0 ? `🔁 틀린 단어 복습 시작 (${wrongSet.size}개)` : "🔁 틀린 단어 없음");
  if (wrongSet.size === 0) reviewBtn.disabled = true;
  reviewBtn.addEventListener("click", () => {
    closeSettings();
    openQuiz("review");
  });
  sheet.appendChild(reviewBtn);

  sheet.appendChild(el("div", "dict-section-label", "초기화"));
  const actions = el("div", "settings-actions");
  const re = el("button", "btn-secondary", "🔄 단어/문법 노출 카운터 초기화");
  re.addEventListener("click", () => {
    if (!confirm("노출 카운터를 초기화할까요? 이미 본 단어들이 다시 모두 표시됩니다.")) return;
    resetExposureAndVisits();
    render();
    openSettings();
  });
  actions.appendChild(re);
  const rw = el("button", "btn-secondary", `🪷 연꽃 카운트 초기화 (현재 ${getWrongCount()})`);
  rw.addEventListener("click", () => {
    if (!confirm("연꽃 카운트를 0으로 되돌릴까요?")) return;
    resetWrongCount();
    openSettings();
  });
  actions.appendChild(rw);
  const rr = el("button", "btn-secondary", `🗑 복습 단어 목록 비우기 (현재 ${loadWrongTerms().size})`);
  rr.addEventListener("click", () => {
    if (!confirm("복습 단어 목록을 모두 비울까요?")) return;
    saveWrongTerms(new Set());
    openSettings();
  });
  actions.appendChild(rr);
  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeSettings(); });
  document.body.appendChild(overlay);
}

function closeTOC() {
  const o = document.getElementById("toc-overlay");
  if (o) o.remove();
}

function openTOC() {
  closeTOC(); closeDictionary(); closeQuiz();
  closeMemoSheet(); closeSettings(); closeCalendar();
  const overlay = el("div", "dict-overlay");
  overlay.id = "toc-overlay";
  const sheet = el("div", "dict-sheet toc-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeTOC);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", state.sutta.title.ko));

  const lastId = localStorage.getItem(LAST_PAGE_KEY);
  if (lastId && lastId !== currentPageId()) {
    const resumeBtn = el("button", "btn-primary", `📖 이어 학습하기 (${lastId})`);
    resumeBtn.addEventListener("click", () => {
      if (navigateToPageId(lastId)) closeTOC();
    });
    sheet.appendChild(resumeBtn);
  }

  sheet.appendChild(el("div", "dict-section-label", "목차"));
  const toc = el("div", "toc-list");
  const curVerse = state.pages[state.pageIdx]?.verse;

  const coverBtn = el("button", "toc-item" + (state.pageIdx === 0 ? " current" : ""), "");
  coverBtn.appendChild(el("span", "toc-num", "표"));
  coverBtn.appendChild(el("span", "toc-pali", "표지"));
  coverBtn.addEventListener("click", () => {
    state.pageIdx = 0;
    render();
    closeTOC();
  });
  toc.appendChild(coverBtn);

  for (const verse of state.sutta.verses) {
    const verseFirstIdx = state.pages.findIndex(p => p.verse === verse);
    if (verseFirstIdx < 0) continue;
    const isCurrent = curVerse === verse;
    const item = el("button", "toc-item" + (isCurrent ? " current" : ""), "");
    item.appendChild(el("span", "toc-num", `${verse.n}`));
    const pali = verse.pali[0] || "";
    const pre = pali.slice(0, 32) + (pali.length > 32 ? "…" : "");
    item.appendChild(el("span", "toc-pali", pre));
    item.addEventListener("click", () => {
      state.pageIdx = verseFirstIdx;
      render();
      closeTOC();
    });
    toc.appendChild(item);
  }
  sheet.appendChild(toc);

  sheet.appendChild(el("div", "dict-section-label", "기타"));
  const sec = el("div", "settings-actions");
  const memoBtn = el("button", "btn-secondary", `📝 메모 목록 (${listAllMemos().length}개)`);
  memoBtn.addEventListener("click", () => { closeTOC(); openMemoList(); });
  sec.appendChild(memoBtn);
  const calBtn = el("button", "btn-secondary", "📅 진도 캘린더");
  calBtn.addEventListener("click", () => { closeTOC(); openCalendar(); });
  sec.appendChild(calBtn);
  sheet.appendChild(sec);

  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeTOC(); });
  document.body.appendChild(overlay);
}

function closeCalendar() {
  const o = document.getElementById("calendar-overlay");
  if (o) o.remove();
}

function openCalendar() {
  closeCalendar();
  const overlay = el("div", "dict-overlay");
  overlay.id = "calendar-overlay";
  const sheet = el("div", "dict-sheet calendar-sheet");
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeCalendar);
  sheet.appendChild(close);
  sheet.appendChild(el("div", "dict-term", "진도 캘린더"));

  const days = loadStudyDays();
  const dayKeys = Object.keys(days);
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayLabel = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  sheet.appendChild(el("div", "calendar-today-banner", `📍 오늘 · ${todayLabel}`));
  sheet.appendChild(el("div", "calendar-stats",
    `학습일 ${dayKeys.length}일 · 누적 ${total}회 페이지 이동`));

  const weeks = 12;
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - (weeks * 7 - 1));
  while (startDate.getDay() !== 0) startDate.setDate(startDate.getDate() - 1);

  const grid = el("div", "calendar-grid");
  const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const labelRow = el("div", "calendar-row calendar-labels");
  for (const dl of dayLabels) labelRow.appendChild(el("div", "calendar-label", dl));
  grid.appendChild(labelRow);

  const cur = new Date(startDate);
  let lastMonthShown = -1;
  while (cur <= now) {
    // Month separator row if month changes at start of this week
    const weekStartMonth = cur.getMonth();
    if (weekStartMonth !== lastMonthShown) {
      const monthRow = el("div", "calendar-month-row");
      monthRow.textContent = `${cur.getFullYear()}년 ${weekStartMonth + 1}월`;
      grid.appendChild(monthRow);
      lastMonthShown = weekStartMonth;
    }
    const row = el("div", "calendar-row");
    for (let i = 0; i < 7; i++) {
      const dateStr = cur.toISOString().slice(0, 10);
      const count = days[dateStr] || 0;
      const cell = el("div", "calendar-cell");
      if (cur > now) cell.classList.add("future");
      else if (count > 0) {
        cell.classList.add("active");
        const intensity = Math.min(4, Math.max(1, Math.ceil(count / 5)));
        cell.classList.add("intensity-" + intensity);
        cell.title = `${dateStr}: ${count}회`;
      }
      if (dateStr === todayStr) cell.classList.add("today");
      // Show "M/D" for first of month, just D otherwise
      if (cur.getDate() === 1) {
        cell.textContent = `${cur.getMonth() + 1}/1`;
        cell.classList.add("month-start");
      } else {
        cell.textContent = cur.getDate();
      }
      row.appendChild(cell);
      cur.setDate(cur.getDate() + 1);
    }
    grid.appendChild(row);
  }
  sheet.appendChild(grid);

  const resetBtn = el("button", "btn-text", "🔄 캘린더 초기화");
  resetBtn.addEventListener("click", () => {
    if (!confirm("진도 캘린더를 초기화할까요?")) return;
    resetStudyDays();
    openCalendar();
  });
  sheet.appendChild(resetBtn);

  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeCalendar(); });
  document.body.appendChild(overlay);
}

function buildQuestions(mode) {
  const allMap = new Map();
  for (const v of state.sutta.verses) {
    for (const w of v.words || []) {
      const meaning = parseGloss(w.gloss).meaning;
      if (!meaning || meaning.length < 2) continue;
      if (!allMap.has(w.term)) allMap.set(w.term, { term: w.term, meaning, verseN: v.n });
    }
  }
  const all = Array.from(allMap.values());
  if (all.length < 4) return [];
  let pickPool;
  if (mode === "review") {
    const wrongs = loadWrongTerms();
    pickPool = all.filter(w => wrongs.has(w.term));
    if (pickPool.length === 0) return [];
  } else {
    pickPool = all;
  }
  const meaningPool = Array.from(new Set(all.map(w => w.meaning)));
  const count = Math.min(QUIZ_COUNT, pickPool.length);
  const picked = shuffle(pickPool).slice(0, count);
  return picked.map(q => {
    const distractors = shuffle(meaningPool.filter(m => m !== q.meaning)).slice(0, 3);
    const options = shuffle([q.meaning, ...distractors]);
    return {
      term: q.term, verseN: q.verseN, options,
      answerIdx: options.indexOf(q.meaning),
      userIdx: null,
    };
  });
}

function openQuiz(mode) {
  mode = mode || "review";
  const questions = buildQuestions(mode);
  if (questions.length === 0) {
    alert(mode === "review" ? "복습할 단어가 없습니다." : "단어가 부족합니다.");
    return;
  }
  quizState.mode = mode;
  quizState.questions = questions;
  quizState.idx = 0;
  quizState.correct = 0;
  quizState.answered = false;
  renderQuizOverlay();
}

function closeQuiz() {
  const o = document.getElementById("quiz-overlay");
  if (o) o.remove();
}

function renderQuizOverlay() {
  closeQuiz();
  const overlay = el("div", "quiz-overlay");
  overlay.id = "quiz-overlay";
  const sheet = el("div", "quiz-sheet");
  const top = el("div", "quiz-top");
  const label = quizState.idx >= quizState.questions.length
    ? "결과" : `${quizState.idx + 1} / ${quizState.questions.length}`;
  top.appendChild(el("div", "quiz-progress", label + " · 복습"));
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeQuiz);
  top.appendChild(close);
  sheet.appendChild(top);
  if (quizState.idx >= quizState.questions.length) renderQuizResult(sheet);
  else renderQuizQuestion(sheet);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function renderQuizQuestion(sheet) {
  const q = quizState.questions[quizState.idx];
  sheet.appendChild(el("div", "quiz-prompt", "이 단어의 뜻은?"));
  sheet.appendChild(el("div", "quiz-term", q.term));
  sheet.appendChild(el("div", "quiz-context", `게송 ${q.verseN}`));
  const opts = el("div", "quiz-options");
  q.options.forEach((opt, i) => {
    const btn = el("button", "quiz-option", opt);
    if (quizState.answered) {
      if (i === q.answerIdx) btn.classList.add("correct");
      else if (i === q.userIdx) btn.classList.add("wrong");
      btn.disabled = true;
    }
    btn.addEventListener("click", () => {
      if (quizState.answered) return;
      quizState.answered = true;
      q.userIdx = i;
      if (i === q.answerIdx) {
        quizState.correct++;
        if (quizState.mode === "review") removeWrongTerm(q.term);
      } else {
        addWrongTerm(q.term);
        incrementWrongCount();
      }
      renderQuizOverlay();
    });
    opts.appendChild(btn);
  });
  sheet.appendChild(opts);
  if (quizState.answered) {
    const isLast = quizState.idx === quizState.questions.length - 1;
    const nextBtn = el("button", "btn-primary", isLast ? "결과 보기" : "다음 →");
    nextBtn.addEventListener("click", () => {
      quizState.idx++;
      quizState.answered = false;
      renderQuizOverlay();
    });
    sheet.appendChild(nextBtn);
  }
}

function renderQuizResult(sheet) {
  const total = quizState.questions.length;
  const score = quizState.correct;
  const pct = Math.round(score / total * 100);
  let emoji = "🌱";
  if (pct >= 90) emoji = "🌟";
  else if (pct >= 70) emoji = "🎉";
  else if (pct >= 50) emoji = "👍";
  sheet.appendChild(el("div", "quiz-result-emoji", emoji));
  sheet.appendChild(el("div", "quiz-result-title", "복습 완료"));
  sheet.appendChild(el("div", "quiz-result-score", `${score} / ${total}`));
  sheet.appendChild(el("div", "quiz-result-pct", `${pct}%`));
  const wrongs = quizState.questions.filter(q => q.userIdx !== q.answerIdx);
  if (wrongs.length) {
    sheet.appendChild(el("div", "section-label", "틀린 문제"));
    const list = el("div", "quiz-wrong-list");
    for (const q of wrongs) {
      const row = el("div", "quiz-wrong");
      row.appendChild(el("div", "quiz-wrong-term", q.term));
      row.appendChild(el("div", "quiz-wrong-answer", `정답: ${q.options[q.answerIdx]}`));
      list.appendChild(row);
    }
    sheet.appendChild(list);
  }
  const actions = el("div", "quiz-actions");
  const remainWrong = loadWrongTerms().size;
  if (remainWrong > 0) {
    const reviewBtn = el("button", "btn-primary", `🔁 다시 복습 (${remainWrong}개)`);
    reviewBtn.addEventListener("click", () => openQuiz("review"));
    actions.appendChild(reviewBtn);
  }
  const back = el("button", "btn-text", "학습으로");
  back.addEventListener("click", closeQuiz);
  actions.appendChild(back);
  sheet.appendChild(actions);
}

function renderCover(card) {
  const t = state.sutta.title;

  const hero = el("div", "cover-hero");
  hero.appendChild(el("div", "cover-emoji", "🪷"));
  hero.appendChild(el("div", "cover-ko", t.ko || ""));
  if (t.pali) hero.appendChild(el("div", "cover-pali", t.pali));
  if (t.ref) hero.appendChild(el("div", "cover-ref", t.ref));
  card.appendChild(hero);

  const actions = el("div", "cover-actions");
  const lastId = localStorage.getItem(LAST_PAGE_KEY);
  if (lastId && lastId !== "cover") {
    const resumeBtn = el("button", "cover-btn cover-btn-primary");
    resumeBtn.appendChild(el("span", "cover-btn-main", "📖 이어 학습하기"));
    resumeBtn.appendChild(el("span", "cover-btn-sub", lastId));
    resumeBtn.addEventListener("click", () => navigateToPageId(lastId));
    actions.appendChild(resumeBtn);
  }
  const tocBtn = el("button", "cover-btn", "");
  tocBtn.appendChild(el("span", "cover-btn-main", "📚 목차에서 선택"));
  tocBtn.addEventListener("click", openTOC);
  actions.appendChild(tocBtn);

  const startBtn = el("button", "cover-btn", "");
  startBtn.appendChild(el("span", "cover-btn-main", "▶ 처음부터 학습"));
  startBtn.addEventListener("click", () => {
    if (state.pages.length > 1) { state.pageIdx = 1; render(); }
  });
  actions.appendChild(startBtn);
  card.appendChild(actions);

  const stats = el("div", "cover-stats");
  const exposure = loadExposure();
  const termCount = Object.keys(exposure.terms).length;
  const studyDays = Object.keys(loadStudyDays()).length;
  const wrongCount = loadWrongTerms().size;
  stats.appendChild(_coverStat("🌱", termCount, "학습 단어"));
  stats.appendChild(_coverStat("📅", studyDays, "학습일"));
  stats.appendChild(_coverStat("🔁", wrongCount, "복습 단어"));
  card.appendChild(stats);
}

function _coverStat(icon, value, label) {
  const s = el("div", "cover-stat");
  s.appendChild(el("div", "cover-stat-icon", icon));
  s.appendChild(el("div", "cover-stat-value", String(value)));
  s.appendChild(el("div", "cover-stat-label", label));
  return s;
}

function appendPaliHeader(card, v) {
  const ph = el("div", "verse-header");
  ph.appendChild(el("span", "verse-header-num", `${v.n}`));
  for (const line of v.pali) {
    const linePart = el("span", "verse-header-pali");
    linePart.appendChild(makePaliClickable(line, v.words || []));
    ph.appendChild(linePart);
  }
  card.appendChild(ph);
}

function renderWords(p, card) {
  appendPaliHeader(card, p.verse);
  recordPageExposure(currentPageId(), p.words);
  const settings = getSettings();
  const exposure = loadExposure();
  const visibleEntries = [];
  let suppressedCount = 0;
  for (const word of p.words) {
    const { grammar } = parseGloss(word.gloss);
    const termCount = (exposure.terms[word.term] || 0) - 1;
    const grammarCount = grammar ? (exposure.grammar[grammar] || 0) - 1 : -1;
    const termOver = isOverLimit(termCount, settings.wordLimit);
    const grammarOver = grammar ? isOverLimit(grammarCount, settings.grammarLimit) : true;
    if (termOver && grammarOver) {
      suppressedCount++;
      continue;
    }
    visibleEntries.push({ word, hideGrammar: grammarOver });
  }
  const wdiv = el("div", "words-card");
  for (const { word, hideGrammar } of visibleEntries) {
    const w = el("div", "word clickable");
    w.appendChild(el("div", "word-term", word.term));
    const { grammar, meaning } = parseGloss(word.gloss);
    if (grammar && !hideGrammar) w.appendChild(el("div", "word-grammar-chip", grammar));
    if (meaning) w.appendChild(el("div", "word-meaning", meaning));
    if (word.extras && word.extras.length) {
      w.appendChild(el("div", "word-more", `주석 ${word.extras.length}개 ▾`));
    }
    w.addEventListener("click", () => openDictionary(word));
    wdiv.appendChild(w);
  }
  if (suppressedCount > 0) {
    const note = el("div", "exposure-note",
      `· ${suppressedCount}개 학습 완료 (탭하여 다시 보기)`);
    note.addEventListener("click", () => {
      resetExposureAndVisits();
      render();
    });
    wdiv.appendChild(note);
  }
  card.appendChild(wdiv);
}

function renderTrans(p, card) {
  appendPaliHeader(card, p.verse);
  card.appendChild(el("div", "section-label", "독해 (탭하여 펼침)"));
  const list = el("div", "trans-list");
  for (const [author, text] of Object.entries(p.verse.translations)) {
    const row = el("div", "tr-row");
    row.appendChild(el("div", "tr-author", author));
    const body = el("div", "tr-body hidden", text);
    body.addEventListener("click", () => body.classList.toggle("hidden"));
    row.appendChild(body);
    list.appendChild(row);
  }
  card.appendChild(list);
}

function renderVerseQuiz(p, card) {
  const v = p.verse;
  const q = p.question;
  appendPaliHeader(card, v);
  card.appendChild(el("div", "section-label", `문제 ${p.quizIdx} / ${p.quizTotal}`));
  card.appendChild(el("div", "quiz-prompt-inline", "이 단어의 뜻은?"));
  card.appendChild(el("div", "quiz-term-inline", q.term));
  const opts = el("div", "quiz-options-inline");
  q.options.forEach((opt, i) => {
    const btn = el("button", "quiz-option-inline", opt);
    if (q.answered) {
      if (i === q.answerIdx) btn.classList.add("correct");
      else if (i === q.userIdx) btn.classList.add("wrong");
      btn.disabled = true;
    }
    btn.addEventListener("click", () => {
      if (q.answered) return;
      q.answered = true;
      q.userIdx = i;
      if (i === q.answerIdx) {
        if (loadWrongTerms().has(q.term)) removeWrongTerm(q.term);
      } else {
        incrementWrongCount();
        addWrongTerm(q.term);
      }
      render();
    });
    opts.appendChild(btn);
  });
  card.appendChild(opts);
  if (q.answered) {
    const ok = q.userIdx === q.answerIdx;
    const fb = el("div", "quiz-feedback " + (ok ? "correct" : "wrong"),
      ok ? "🌟 정답!" : `정답: ${q.options[q.answerIdx]}`);
    card.appendChild(fb);
  } else {
    card.appendChild(el("div", "hint", "선택지 탭"));
  }
}

function appendMemoPreview(card) {
  const pageId = currentPageId();
  const local = getMemo(pageId);
  if (local && local.memo) {
    _appendMemoBox(card, local.memo, "📱 본인 메모", local.updated_at);
    return;
  }
  const expected = state.pages[state.pageIdx];
  getGithubMemos().then(remote => {
    if (state.pages[state.pageIdx] !== expected) return;
    if (!card.isConnected) return;
    const m = remote.find(x => x.page_id === pageId);
    if (m && m.memo) _appendMemoBox(card, m.memo, "🌐 공유 메모", m.updated_at);
  });
}

function _appendMemoBox(card, text, label, ts) {
  const existing = card.querySelector(".memo-preview-box");
  if (existing) existing.remove();
  const box = el("div", "memo-preview-box");
  box.appendChild(el("div", "memo-preview-label", label));
  box.appendChild(el("div", "memo-preview-text", text));
  if (ts) {
    try { box.appendChild(el("div", "memo-preview-date", new Date(ts).toLocaleDateString())); } catch {}
  }
  box.addEventListener("click", () => openMemoSheet());
  card.appendChild(box);
}

function appendCardNav(card) {
  const p = state.pages[state.pageIdx];
  if (!p || p.kind === "cover") return;

  const nav = el("div", "card-nav");
  const prev = el("button", "card-nav-btn card-nav-prev");
  prev.textContent = "‹ 이전";
  if (state.pageIdx === 0) prev.disabled = true;
  else prev.addEventListener("click", () => go(-1));
  nav.appendChild(prev);

  const next = el("button", "card-nav-btn card-nav-next");
  if (state.pageIdx >= state.pages.length - 1) {
    next.textContent = "끝 ✓";
    next.disabled = true;
  } else {
    const nextP = state.pages[state.pageIdx + 1];
    let label = "다음 →";
    if (nextP.kind === "cover") label = "표지로 →";
    else if (nextP.kind === "words") label = `${nextP.verse.n}게송 단어 ${nextP.wordPageIdx} →`;
    else if (nextP.kind === "trans") label = `${nextP.verse.n}게송 독해 →`;
    else if (nextP.kind === "verseQuiz") label = `${nextP.verse.n}게송 문제 ${nextP.quizIdx} →`;
    next.textContent = label;
    next.addEventListener("click", () => go(1));
  }
  nav.appendChild(next);
  card.appendChild(nav);
}

function render() {
  closeDictionary();
  const p = state.pages[state.pageIdx];
  const root = document.getElementById("page");
  root.innerHTML = "";
  const card = el("div", `card kind-${p.kind}`);
  if (p.kind === "cover") renderCover(card);
  else if (p.kind === "words") renderWords(p, card);
  else if (p.kind === "trans") renderTrans(p, card);
  else if (p.kind === "verseQuiz") renderVerseQuiz(p, card);
  appendCardNav(card);
  root.appendChild(card);
  appendMemoPreview(card);

  let info = state.sutta.title.ko;
  if (p.kind === "cover") info = `${state.sutta.title.ko} · 표지`;
  else if (p.kind === "words") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 단어 ${p.wordPageIdx}/${p.totalWordPages}`;
  else if (p.kind === "trans") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 독해`;
  else if (p.kind === "verseQuiz") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 문제 ${p.quizIdx}/${p.quizTotal}`;

  document.getElementById("page-info").textContent = info;
  document.getElementById("page-num").textContent = `${state.pageIdx + 1} / ${state.pages.length}`;
  const pb = document.getElementById("prev-btn"); if (pb) pb.disabled = state.pageIdx === 0;
  const nb = document.getElementById("next-btn"); if (nb) nb.disabled = state.pageIdx === state.pages.length - 1;
  syncHash();
  updateMemoFab();
  updateLotusRow();
  localStorage.setItem(LAST_PAGE_KEY, currentPageId());
  recordStudyToday();
}

function go(dir) {
  const next = state.pageIdx + dir;
  if (next < 0 || next >= state.pages.length) return;
  state.pageIdx = next;
  render();
}

function attachNav() {
  const _pb = document.getElementById("prev-btn"); if (_pb) _pb.addEventListener("click", () => go(-1));
  const _nb = document.getElementById("next-btn"); if (_nb) _nb.addEventListener("click", () => go(1));
  document.getElementById("memo-fab").addEventListener("click", openMemoSheet);

  document.querySelectorAll("#bottom-tabs button").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      if (tab === "home") {
        state.pageIdx = 0;
        render();
      } else if (tab === "toc") {
        openTOC();
      } else if (tab === "review") {
        const wrongSet = loadWrongTerms();
        if (wrongSet.size === 0) {
          alert("복습할 단어가 없습니다.\n게송 문제를 풀면서 틀린 단어가 쌓이면 여기서 다시 풀어볼 수 있어요.");
          return;
        }
        openQuiz("review");
      } else if (tab === "calendar") {
        openCalendar();
      } else if (tab === "settings") {
        openSettings();
      }
    });
  });

  let touchStartX = 0, touchStartY = 0;
  document.addEventListener("touchstart", e => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (document.getElementById("dict-overlay") || document.getElementById("quiz-overlay")
        || document.getElementById("memo-overlay") || document.getElementById("settings-overlay")
        || document.getElementById("toc-overlay") || document.getElementById("calendar-overlay")) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeDictionary(); closeQuiz(); closeMemoSheet();
      closeSettings(); closeTOC(); closeCalendar();
      return;
    }
    if (document.getElementById("quiz-overlay")) return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  });

  window.addEventListener("hashchange", () => {
    const idx = parseHash();
    if (idx !== null && idx !== state.pageIdx) {
      state.pageIdx = idx;
      render();
    }
  });
}

init().catch(err => _showFatalError("init: " + (err && err.message ? err.message + "\n" + (err.stack || "") : err)));
