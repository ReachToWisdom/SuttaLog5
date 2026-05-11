const SUTTA_PATH = "data/sutta/sn1.8-metta.json";
const WORDS_PER_PAGE = 4;
const QUIZ_COUNT = 10;
const STORAGE_KEY_PREFIX = "suttalog5:wrong:";

const state = {
  sutta: null,
  pages: [],
  pageIdx: 0,
};

const quizState = {
  mode: "all",
  questions: [],
  idx: 0,
  correct: 0,
  answered: false,
};

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
  if (fromHash !== null) state.pageIdx = fromHash;
  attachNav();
  render();
  updateQuizBadge();
}

function buildPages(sutta) {
  const pages = [{ kind: "cover" }];
  for (const verse of sutta.verses) {
    const words = verse.words || [];
    const wordPageCount = Math.ceil(words.length / WORDS_PER_PAGE);
    for (let i = 0; i < wordPageCount; i++) {
      pages.push({
        kind: "words",
        verse,
        words: words.slice(i * WORDS_PER_PAGE, (i + 1) * WORDS_PER_PAGE),
        wordPageIdx: i + 1,
        totalWordPages: wordPageCount,
      });
    }
    if (verse.translations && Object.keys(verse.translations).length) {
      pages.push({ kind: "trans", verse });
    }
  }
  return pages;
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
  close.setAttribute("aria-label", "닫기");
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
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeDictionary();
  });
  document.body.appendChild(overlay);
}

function closeDictionary() {
  const o = document.getElementById("dict-overlay");
  if (o) o.remove();
}

/* ===== WRONG SET (localStorage) ===== */

function storageKey() {
  return STORAGE_KEY_PREFIX + (state.sutta ? state.sutta.id : "unknown");
}

function loadWrongTerms() {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}

function saveWrongTerms(set) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...set]));
  } catch {}
}

function addWrongTerm(term) {
  const s = loadWrongTerms();
  s.add(term);
  saveWrongTerms(s);
  updateQuizBadge();
}

function removeWrongTerm(term) {
  const s = loadWrongTerms();
  s.delete(term);
  saveWrongTerms(s);
  updateQuizBadge();
}

function updateQuizBadge() {
  const btn = document.getElementById("quiz-btn");
  if (!btn) return;
  const count = state.sutta ? loadWrongTerms().size : 0;
  let badge = btn.querySelector(".quiz-badge");
  if (count > 0) {
    if (!badge) {
      badge = el("span", "quiz-badge");
      btn.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
  } else if (badge) {
    badge.remove();
  }
}

/* ===== QUIZ ===== */

function buildQuestions(mode) {
  const allMap = new Map();
  for (const v of state.sutta.verses) {
    for (const w of v.words || []) {
      const meaning = parseGloss(w.gloss).meaning;
      if (!meaning || meaning.length < 2) continue;
      if (!allMap.has(w.term)) {
        allMap.set(w.term, { term: w.term, meaning, verseN: v.n });
      }
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
    const distractorPool = meaningPool.filter(m => m !== q.meaning);
    const distractors = shuffle(distractorPool).slice(0, 3);
    const options = shuffle([q.meaning, ...distractors]);
    return {
      term: q.term,
      verseN: q.verseN,
      options,
      answerIdx: options.indexOf(q.meaning),
      userIdx: null,
    };
  });
}

function onQuizButton() {
  const wrongCount = state.sutta ? loadWrongTerms().size : 0;
  if (wrongCount === 0) {
    openQuiz("all");
  } else {
    showQuizChooser();
  }
}

function showQuizChooser() {
  closeQuiz();
  const overlay = el("div", "quiz-overlay");
  overlay.id = "quiz-overlay";
  const sheet = el("div", "quiz-sheet quiz-chooser");

  const top = el("div", "quiz-top");
  top.appendChild(el("div", "quiz-progress", "문제집"));
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeQuiz);
  top.appendChild(close);
  sheet.appendChild(top);

  sheet.appendChild(el("div", "quiz-prompt", "어떤 문제를 풀까요?"));

  const wrongCount = loadWrongTerms().size;
  const reviewBtn = el("button", "btn-primary", `🔁 틀린 단어 복습 (${wrongCount}개)`);
  reviewBtn.addEventListener("click", () => openQuiz("review"));
  sheet.appendChild(reviewBtn);

  const allBtn = el("button", "btn-secondary", "📚 전체 단어에서 (10문항 랜덤)");
  allBtn.addEventListener("click", () => openQuiz("all"));
  sheet.appendChild(allBtn);

  const clearBtn = el("button", "btn-text", "복습 목록 초기화");
  clearBtn.addEventListener("click", () => {
    if (confirm("틀린 단어 목록을 모두 비울까요?")) {
      saveWrongTerms(new Set());
      updateQuizBadge();
      closeQuiz();
    }
  });
  sheet.appendChild(clearBtn);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
}

function openQuiz(mode) {
  mode = mode || "all";
  const questions = buildQuestions(mode);
  if (questions.length === 0) {
    alert(mode === "review" ? "복습할 단어가 없습니다." : "문제집을 만들기에 단어가 부족합니다.");
    return;
  }
  quizState.mode = mode;
  quizState.questions = questions;
  quizState.idx = 0;
  quizState.correct = 0;
  quizState.answered = false;
  renderQuiz();
}

function closeQuiz() {
  const o = document.getElementById("quiz-overlay");
  if (o) o.remove();
}

function renderQuiz() {
  closeQuiz();
  const overlay = el("div", "quiz-overlay");
  overlay.id = "quiz-overlay";
  const sheet = el("div", "quiz-sheet");

  const top = el("div", "quiz-top");
  const label = quizState.idx >= quizState.questions.length
    ? "결과"
    : `${quizState.idx + 1} / ${quizState.questions.length}`;
  const modeLabel = quizState.mode === "review" ? " · 복습" : "";
  top.appendChild(el("div", "quiz-progress", label + modeLabel));
  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeQuiz);
  top.appendChild(close);
  sheet.appendChild(top);

  if (quizState.idx >= quizState.questions.length) {
    renderQuizResult(sheet);
  } else {
    renderQuizQuestion(sheet);
  }

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
      }
      renderQuiz();
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
      renderQuiz();
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
  sheet.appendChild(el("div", "quiz-result-title",
    quizState.mode === "review" ? "복습 완료" : "완료"));
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
    const reviewBtn = el("button", "btn-primary", `🔁 틀린 단어 복습 (${remainWrong}개)`);
    reviewBtn.addEventListener("click", () => openQuiz("review"));
    actions.appendChild(reviewBtn);
  }
  const retry = el("button", remainWrong > 0 ? "btn-secondary" : "btn-primary", "📚 전체 문제 다시");
  retry.addEventListener("click", () => openQuiz("all"));
  actions.appendChild(retry);
  const back = el("button", "btn-text", "학습으로");
  back.addEventListener("click", closeQuiz);
  actions.appendChild(back);
  sheet.appendChild(actions);
}


/* ===== MEMO (local-only, no token) ===== */

const MEMO_PREFIX = "suttalog5:memo:";
const MEMO_INDEX_KEY = "suttalog5:memo_index";

// Clean up old PAT-era key
try { localStorage.removeItem("suttalog5:gh_pat"); } catch {}

function loadMemoIndex() {
  try {
    const raw = localStorage.getItem(MEMO_INDEX_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function saveMemoIndex(set) {
  localStorage.setItem(MEMO_INDEX_KEY, JSON.stringify([...set]));
}
function pageHasMemo(pageId) { return loadMemoIndex().has(pageId); }
function markPageMemo(pageId, has) {
  const s = loadMemoIndex();
  if (has) s.add(pageId); else s.delete(pageId);
  saveMemoIndex(s);
}

function currentPageId() {
  const p = state.pages[state.pageIdx];
  if (!p) return "p" + (state.pageIdx + 1);
  if (p.kind === "cover") return "cover";
  if (p.kind === "words") return `v${p.verse.n}-w${p.wordPageIdx}`;
  if (p.kind === "trans") return `v${p.verse.n}-trans`;
  return "p" + (state.pageIdx + 1);
}

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

function describeCurrentPage() {
  const p = state.pages[state.pageIdx];
  if (!p) return "";
  if (p.kind === "cover") return "표지";
  if (p.kind === "words") return `${p.verse.n}게송 · 단어 ${p.wordPageIdx}/${p.totalWordPages}`;
  if (p.kind === "trans") return `${p.verse.n}게송 · 독해`;
  return "";
}

function closeMemoSheet() {
  const o = document.getElementById("memo-overlay");
  if (o) o.remove();
}

function openMemoSheet() {
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

  const memo = getMemo(pageId);

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
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeMemoSheet();
  });
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 50);
}

function updateMemoFab() {
  const fab = document.getElementById("memo-fab");
  if (!fab) return;
  if (pageHasMemo(currentPageId())) fab.classList.add("has-memo");
  else fab.classList.remove("has-memo");
}

function navigateToPageId(pageId) {
  for (let i = 0; i < state.pages.length; i++) {
    const p = state.pages[i];
    let id;
    if (p.kind === "cover") id = "cover";
    else if (p.kind === "words") id = `v${p.verse.n}-w${p.wordPageIdx}`;
    else if (p.kind === "trans") id = `v${p.verse.n}-trans`;
    if (id === pageId) {
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

function openMemoList() {
  closeMemoSheet();
  closeDictionary();
  closeQuiz();

  const overlay = el("div", "dict-overlay");
  overlay.id = "memo-overlay";
  const sheet = el("div", "dict-sheet memo-list-sheet");

  const close = el("button", "dict-close", "✕");
  close.addEventListener("click", closeMemoSheet);
  sheet.appendChild(close);

  sheet.appendChild(el("div", "dict-term", "메모 목록"));

  const memos = listAllMemos();
  if (memos.length === 0) {
    sheet.appendChild(el("div", "memo-empty",
      "아직 메모가 없습니다.\n페이지에서 ✏️ 버튼으로 추가하세요."));
  } else {
    sheet.appendChild(el("div", "memo-count", `${memos.length}개의 메모`));
    const list = el("div", "memo-list");
    for (const memo of memos) {
      const item = el("div", "memo-item");
      const headRow = el("div", "memo-item-head");
      headRow.appendChild(el("span", "memo-item-id", memo.page_id));
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
      const editBtn = el("button", "btn-text-small", "✎ 수정");
      editBtn.addEventListener("click", () => {
        if (navigateToPageId(memo.page_id)) {
          setTimeout(openMemoSheet, 100);
        }
      });
      actions.appendChild(editBtn);
      const delBtn = el("button", "btn-text-small btn-danger", "🗑 삭제");
      delBtn.addEventListener("click", () => {
        if (!confirm(`"${memo.page_id}" 메모를 삭제할까요?`)) return;
        deleteMemo(memo.page_id);
        openMemoList();
      });
      actions.appendChild(delBtn);
      item.appendChild(actions);
      list.appendChild(item);
    }
    sheet.appendChild(list);

    const exportBtn = el("button", "btn-secondary", "📥 전체 메모 JSON 다운로드");
    exportBtn.addEventListener("click", downloadMemosJson);
    sheet.appendChild(exportBtn);
  }

  overlay.appendChild(sheet);
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeMemoSheet();
  });
  document.body.appendChild(overlay);
}

/* ===== RENDER (학습 모드) ===== */

function renderCover(card) {
  const t = state.sutta.title;
  card.appendChild(el("div", "cover-ko", t.ko || ""));
  card.appendChild(el("div", "cover-pali", t.pali || ""));
  if (t.ref) card.appendChild(el("div", "cover-ref", t.ref));
  card.appendChild(el("div", "hint", "→ 다음 페이지"));
}

function renderMain(p, card) {
  const v = p.verse;
  card.appendChild(el("div", "badge", `게송 ${v.n}`));
  const paliMain = el("div", "pali-main");
  for (const line of v.pali) {
    const lineEl = el("div", "pali-line");
    lineEl.appendChild(makePaliClickable(line, v.words || []));
    paliMain.appendChild(lineEl);
  }
  card.appendChild(paliMain);
  card.appendChild(el("div", "hint", "단어 탭 → 사전 · → 단어 학습"));
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
  const wdiv = el("div", "words-card");
  for (const word of p.words) {
    const w = el("div", "word clickable");
    w.appendChild(el("div", "word-term", word.term));
    const { grammar, meaning } = parseGloss(word.gloss);
    if (grammar) w.appendChild(el("div", "word-grammar-chip", grammar));
    if (meaning) w.appendChild(el("div", "word-meaning", meaning));
    if (word.extras && word.extras.length) {
      w.appendChild(el("div", "word-more", `주석 ${word.extras.length}개 ▾`));
    }
    w.addEventListener("click", () => openDictionary(word));
    wdiv.appendChild(w);
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

function render() {
  closeDictionary();
  const p = state.pages[state.pageIdx];
  const root = document.getElementById("page");
  root.innerHTML = "";
  const card = el("div", `card kind-${p.kind}`);
  if (p.kind === "cover") renderCover(card);
  else if (p.kind === "main") renderMain(p, card);
  else if (p.kind === "words") renderWords(p, card);
  else if (p.kind === "trans") renderTrans(p, card);
  root.appendChild(card);

  let info = state.sutta.title.ko;
  if (p.kind === "cover") info = `${state.sutta.title.ko} · 표지`;
  else if (p.kind === "main") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 원문`;
  else if (p.kind === "words") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 단어 ${p.wordPageIdx}/${p.totalWordPages}`;
  else if (p.kind === "trans") info = `${state.sutta.title.ko} · ${p.verse.n}게송 · 독해`;

  document.getElementById("page-info").textContent = info;
  document.getElementById("page-num").textContent =
    `${state.pageIdx + 1} / ${state.pages.length}`;
  document.getElementById("prev-btn").disabled = state.pageIdx === 0;
  document.getElementById("next-btn").disabled = state.pageIdx === state.pages.length - 1;
  syncHash();
  updateMemoFab();
  fetchMemo(currentPageId()).then(() => updateMemoFab());
}

function go(dir) {
  const next = state.pageIdx + dir;
  if (next < 0 || next >= state.pages.length) return;
  state.pageIdx = next;
  render();
}

function attachNav() {
  document.getElementById("prev-btn").addEventListener("click", () => go(-1));
  document.getElementById("next-btn").addEventListener("click", () => go(1));
  document.getElementById("quiz-btn").addEventListener("click", onQuizButton);
  document.getElementById("memo-fab").addEventListener("click", openMemoSheet);
  document.getElementById("menu-btn").addEventListener("click", openMemoList);

  let touchStartX = 0, touchStartY = 0;
  document.addEventListener("touchstart", e => {
    touchStartX = e.changedTouches[0].clientX;
    touchStartY = e.changedTouches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (document.getElementById("dict-overlay") || document.getElementById("quiz-overlay") || document.getElementById("memo-overlay")) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeDictionary();
      closeQuiz();
      closeMemoSheet();
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

init();
