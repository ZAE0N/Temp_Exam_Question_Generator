/* =========================================================
 * 예비 시험 문제 풀이 엔진
 * - .txt / .js 파일을 읽어 문제를 생성
 * - 객관식: 선택 즉시 정/오답 표시 + 선택지별 해설
 * - 주관식: 제출 시 모범답안 표시 + 자가 채점
 * ========================================================= */

/* ----------------------- 상태 ----------------------- */
const state = {
  questions: [],   // 정규화된 문제 배열
  answers: [],     // 사용자 응답 [{selected, submitted, selfGrade}]
  index: 0,
  reviewMode: false,
  order: [],       // 표시(푸는) 순서: order[표시위치] = 원본 index (랜덤 출제)
  visited: new Set(), // 풀이 중 지나간(방문한) 문제 원본 index — 드롭다운 이동용
  // 타이머
  timerEnabled: false, // 첫 화면 토글 (사용 여부)
  elapsed: 0,          // 누적 초
  timerId: null,       // setInterval 핸들
  timerPaused: false,  // 일시정지 여부
  timerActive: false,  // 현재 풀이 화면에서 타이머가 동작/표시 중인지
  timeFinal: null,     // 결과에 표시할 최종 풀이 시간(초). null이면 미표시
};

/* ----------------------- DOM ------------------------ */
const $ = (sel) => document.querySelector(sel);
const screens = {
  start: $("#screen-start"),
  quiz: $("#screen-quiz"),
  result: $("#screen-result"),
};
// 결과 필터 → 사람이 읽는 이름
const FILTER_LABELS = { ok: "정답", no: "오답", skip: "미응답" };

function show(name) {
  Object.values(screens).forEach((s) => (s.hidden = true));
  screens[name].hidden = false;
  window.scrollTo(0, 0);
}

/* =========================================================
 * 1. 파일 로딩
 * ========================================================= */
const fileInput = $("#file-input");
const dropzone = $("#dropzone");

$("#btn-pick").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) handleFile(e.target.files[0]);
});

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  const errorBox = $("#load-error");
  const summary = $("#load-summary");
  errorBox.hidden = true;
  summary.hidden = true;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = reader.result;
      const isJs = /\.js$/i.test(file.name);
      const questions = isJs ? parseJs(text) : parseTxt(text);
      if (!questions.length) throw new Error("문제를 하나도 찾지 못했습니다. 파일 형식을 확인하세요 (RULE.md 참고).");

      state.questions = questions;
      state.filename = file.name;
      showSummary(questions, file.name);
    } catch (err) {
      errorBox.textContent = "⚠ 불러오기 실패: " + err.message;
      errorBox.hidden = false;
    }
  };
  reader.onerror = () => {
    errorBox.textContent = "⚠ 파일을 읽을 수 없습니다.";
    errorBox.hidden = false;
  };
  reader.readAsText(file, "UTF-8");
}

function showSummary(questions, filename) {
  const mc = questions.filter((q) => q.type === "multiple").length;
  const sh = questions.filter((q) => q.type === "short").length;
  const ma = questions.filter((q) => q.type === "matching").length;
  $("#loaded-filename").textContent = filename || state.filename || "불러온 파일";
  $("#loaded-count").textContent = questions.length;
  $("#count-mc").textContent = mc;
  $("#count-short").textContent = sh;
  $("#count-match").textContent = ma;
  // 연결형 문항이 없으면 해당 줄은 숨김
  $("#count-match-row").hidden = ma === 0;
  // 업로드 칸을 숨기고 파일 정보 칸을 표시
  dropzone.hidden = true;
  $("#load-summary").hidden = false;
}

// 파일 제거 → 업로드 칸으로 되돌리고 상태 초기화
function clearFile() {
  state.questions = [];
  state.filename = null;
  fileInput.value = "";
  $("#load-summary").hidden = true;
  $("#load-error").hidden = true;
  dropzone.hidden = false;
}

/* parseTxt / parseJs / CHOICE_MARKERS 는 parser.js 에서 제공됩니다. */

/* =========================================================
 * 4. 시험 진행
 * ========================================================= */
$("#btn-start").addEventListener("click", startQuiz);

function startQuiz() {
  state.answers = state.questions.map(() => ({
    selected: null,
    submitted: false,
    selfGrade: null, // "correct" | "wrong"
  }));
  state.reviewMode = false;
  state.fromResult = false; // 새로 푸는 중 → 결과 돌아가기 버튼 숨김
  // 매번 랜덤 순서로 출제 (표시 순서를 order에 고정해 두고 그 순서로 순회)
  state.order = shuffledIndices(state.questions.length);
  state.nav = state.order.slice();
  state.index = state.nav.length ? state.nav[0] : 0;
  state.navFilter = null;
  state.visited = new Set(); // 방문 기록 초기화

  // 타이머: 풀이 세션 동안 영역 표시(사용 중이면 시계, 아니면 '타이머' 버튼)
  resetTimer();
  state.timeFinal = null;
  state.timerActive = true;
  updateTimerDisplay();
  if (state.timerEnabled) startTimer();

  show("quiz");
  renderQuestion();
}

// 원본 index → 화면에 보이는 문제 번호(푸는 순서대로 1부터)
function displayNumOf(i) {
  const o = state.order && state.order.length ? state.order : state.questions.map((_, k) => k);
  const p = o.indexOf(i);
  return (p < 0 ? i : p) + 1;
}

function renderQuestion() {
  const q = state.questions[state.index];
  const a = state.answers[state.index];

  // 처음 푸는 중이면 지나간 문제로 기록 (답을 안 하고 넘어가도 드롭다운에 추가)
  if (!state.fromResult) {
    if (!state.visited) state.visited = new Set();
    state.visited.add(state.index);
  }

  // 타이머 영역 표시 갱신 (풀이 중: 시계 또는 '타이머' 버튼 / 다시 보기: 숨김)
  renderTimerUI();

  // 현재 순회 목록(전체 또는 필터된 부분집합) 안에서의 위치
  const nav = state.nav && state.nav.length ? state.nav : state.questions.map((_, i) => i);
  const pos = nav.indexOf(state.index);
  const navTotal = nav.length;

  // 헤더 (유형 배지는 본문 문제 번호 옆에 표시)
  $("#q-position").textContent = `${pos + 1} / ${navTotal}`;
  $("#progress-fill").style.width = `${((pos + 1) / navTotal) * 100}%`;

  // 결과 화면에서 문제를 눌러 들어온 경우에만 '결과 보기로' 버튼 노출
  $("#btn-back-result").hidden = !state.fromResult;

  // 특정 탭(정답/오답/미응답)의 문항만 순회 중임을 명시하는 안내 배너
  const scope = $("#review-scope");
  const scopeLabel = FILTER_LABELS[state.navFilter];
  if (scopeLabel) {
    scope.hidden = false;
    scope.innerHTML =
      `<span>🔍 <strong>${scopeLabel}</strong> 문항만 보는 중 · 이전/다음은 이 ${navTotal}문항 안에서만 이동해요</span>` +
      `<button id="btn-scope-all" class="btn-scope-all" type="button">전체 문제 보기</button>`;
    $("#btn-scope-all").addEventListener("click", () => {
      state.nav = state.questions.map((_, i) => i);
      state.navFilter = null;
      renderQuestion();
    });
  } else {
    scope.hidden = true;
    scope.innerHTML = "";
  }

  // 문제 이동 드롭다운 (풀이 중: 지나간 문제 / 다시 보기: 현재 탭의 문제)
  renderQuizJump();

  // 본문
  const area = $("#question-area");
  area.innerHTML = "";

  const qNum = document.createElement("div");
  qNum.className = "q-number";
  qNum.appendChild(document.createTextNode(`Q${displayNumOf(state.index)}.`));
  // 유형 배지를 문제 번호 바로 옆에 표시
  const badge = document.createElement("span");
  const TYPE_LABEL = { multiple: "객관식", short: "주관식", matching: "연결형" };
  badge.className = "badge" + (q.type === "multiple" ? "" : " " + q.type);
  badge.textContent = TYPE_LABEL[q.type] || "문제";
  qNum.appendChild(badge);
  area.appendChild(qNum);

  const qText = document.createElement("div");
  qText.className = "q-text";
  qText.textContent = q.question;
  area.appendChild(qText);

  if (q.type === "multiple") {
    renderMultiple(area, q, a);
  } else if (q.type === "matching") {
    renderMatching(area, q, a);
  } else {
    renderShort(area, q, a);
  }

  // 푸터 버튼 상태 (순회 목록 기준)
  $("#btn-prev").disabled = pos <= 0;
  const isLast = pos === navTotal - 1;
  // 주관식: 답을 제출했다면 자가채점(⭕/❌)을 해야 다음/결과로 넘어갈 수 있음
  const gradeGate = q.type === "short" && a.submitted && !a.selfGrade;
  $("#btn-next").hidden = isLast;
  $("#btn-next").disabled = gradeGate;
  $("#btn-finish").hidden = !isLast;
  $("#btn-finish").disabled = gradeGate;
}

/* ---- 객관식 렌더 ---- */
function renderMultiple(area, q, a) {
  // 다시 보기에서 미응답이면 정답/해설을 공개(reveal)
  const reveal = state.fromResult && !a.submitted;
  const show = a.submitted || reveal;

  const ul = document.createElement("ul");
  ul.className = "choices";

  q.choices.forEach((text, i) => {
    const li = document.createElement("li");
    li.className = "choice";
    li.innerHTML = `
      <span class="choice-marker">${CHOICE_MARKERS[i] || i + 1}</span>
      <span class="choice-text">${escapeHtml(text)}</span>
      <span class="choice-verdict"></span>`;

    if (show) {
      li.classList.add("disabled");
      applyChoiceVerdict(li, q, i, a); // a.selected 가 없으면 정답만 표시됨
    } else {
      li.addEventListener("click", () => {
        a.selected = i;
        a.submitted = true;
        renderQuestion(); // 즉시 채점 표시
      });
      if (a.selected === i) li.classList.add("selected");
    }
    ul.appendChild(li);

    // 선택지별 해설 (제출/공개 후 표시)
    if (show && q.choiceExplanations && q.choiceExplanations[i]) {
      const ce = document.createElement("div");
      ce.className = "choice-explain";
      ce.textContent = q.choiceExplanations[i];
      ul.appendChild(ce);
    }
  });
  area.appendChild(ul);

  // 전체 해설
  if (show) {
    const correctMarker = CHOICE_MARKERS[q.answer] || (q.answer + 1);
    const box = document.createElement("div");
    let cls, head;
    if (!a.submitted) {            // 미응답 공개
      cls = "skip";
      head = "▫️ 미응답";
    } else if (a.selected === q.answer) {
      cls = "ok";
      head = "✅ 정답입니다!";
    } else {
      cls = "no";
      head = "❌ 오답입니다.";
    }
    box.className = "explanation " + cls;
    let html = `<div class="explanation-title">${head} (정답: ${correctMarker})</div>`;
    if (q.explanation) html += escapeHtml(q.explanation);
    box.innerHTML = html;
    area.appendChild(box);
  }
}

function applyChoiceVerdict(li, q, i, a) {
  const verdict = li.querySelector(".choice-verdict");
  if (i === q.answer) {
    li.classList.add("correct");
    verdict.textContent = "정답";
  } else if (i === a.selected) {
    li.classList.add("wrong");
    verdict.textContent = "내가 고른 오답";
  }
}

/* ---- 주관식 렌더 ---- */
function renderShort(area, q, a) {
  // 다시 보기에서 미응답이면 모범답안/해설을 공개(reveal)
  const reveal = state.fromResult && !a.submitted;
  const box = document.createElement("div");
  box.className = "short-answer-box";

  if (!a.submitted && !reveal) {
    const ta = document.createElement("textarea");
    ta.className = "short-input";
    ta.placeholder = "여기에 답을 작성한 뒤 '제출'을 누르세요.";
    ta.value = a.selected || "";
    ta.addEventListener("input", () => (a.selected = ta.value));
    box.appendChild(ta);

    const submit = document.createElement("button");
    submit.className = "btn btn-primary";
    submit.textContent = "제출하고 모범답안 보기";
    submit.addEventListener("click", () => {
      a.selected = ta.value;
      a.submitted = true;
      renderQuestion();
    });
    box.appendChild(submit);
  } else {
    // 내 답안 (미응답 공개 시 "(미응답)" 표시)
    const mine = document.createElement("div");
    mine.className = "your-answer";
    const mineText = a.submitted ? (a.selected || "(작성하지 않음)") : "(미응답)";
    mine.innerHTML = `<div class="label">📝 내가 작성한 답안</div>${escapeHtml(mineText)}`;
    box.appendChild(mine);

    // 모범답안
    const model = document.createElement("div");
    model.className = "model-answer";
    let mhtml = `<div class="label">✅ 모범 답안</div>${escapeHtml(q.modelAnswer || "(모범답안 없음)")}`;
    if (q.explanation) mhtml += `\n\n💡 ${escapeHtml(q.explanation)}`;
    model.innerHTML = mhtml;
    box.appendChild(model);

    if (a.submitted) { // 미응답 공개 시엔 자가채점 없음
    // 자가 채점
    const grade = document.createElement("div");
    grade.className = "self-grade";
    grade.innerHTML = `<div class="label">스스로 채점해 주세요</div>`;
    const btns = document.createElement("div");
    btns.className = "grade-buttons";

    const okBtn = document.createElement("button");
    okBtn.className = "grade-btn pick-correct" + (a.selfGrade === "correct" ? " active" : "");
    okBtn.textContent = "⭕ 맞음";
    okBtn.addEventListener("click", () => {
      a.selfGrade = "correct";
      renderQuestion();
    });

    const noBtn = document.createElement("button");
    noBtn.className = "grade-btn pick-wrong" + (a.selfGrade === "wrong" ? " active" : "");
    noBtn.textContent = "❌ 틀림";
    noBtn.addEventListener("click", () => {
      a.selfGrade = "wrong";
      renderQuestion();
    });

    btns.appendChild(okBtn);
    btns.appendChild(noBtn);
    grade.appendChild(btns);

    // 채점을 아직 안 했으면 다음으로 못 넘어간다는 안내
    if (!a.selfGrade) {
      const hint = document.createElement("p");
      hint.className = "grade-hint";
      hint.textContent = "⤷ ⭕/❌ 채점을 선택해야 다음 문제로 넘어갈 수 있어요.";
      grade.appendChild(hint);
    }

    box.appendChild(grade);
    } // if (a.submitted)
  }

  area.appendChild(box);
}

/* ---- 연결형(matching) 렌더 ---- */
const MATCH_MARKERS = ["(가)", "(나)", "(다)", "(라)", "(마)", "(바)", "(사)", "(아)", "(자)", "(차)"];

// 0..n-1 을 섞은 배열 (오른쪽 보기 표시 순서 — 정답이 대각선으로 드러나지 않게)
function shuffledIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 정답 right 인덱스가 표시 순서(order)에서 몇 번째인지 → 보기 마커
function rightMarkerOf(order, rightIdx) {
  const p = order.indexOf(rightIdx);
  return MATCH_MARKERS[p] || p + 1;
}

// 연결형 전부 정답인지
function matchingAllCorrect(q, a) {
  if (!a.submitted || !Array.isArray(a.selected) || !Array.isArray(a.rightOrder)) return false;
  return q.left.every((_, i) => {
    const p = a.selected[i];
    return p != null && a.rightOrder[p] === q.answer[i];
  });
}

function renderMatching(area, q, a) {
  const n = q.left.length;
  // 다시 보기에서 미응답이면 정답/해설을 공개(reveal)
  const reveal = state.fromResult && !a.submitted;
  // 오른쪽 보기 표시 순서(섞기)는 최초 1회만 정해 고정
  if (!Array.isArray(a.rightOrder) || a.rightOrder.length !== q.right.length) {
    a.rightOrder = shuffledIndices(q.right.length);
  }
  if (!Array.isArray(a.selected) || a.selected.length !== n) {
    a.selected = q.left.map(() => null); // selected[i] = 선택한 표시 위치(order 인덱스)
  }
  const order = a.rightOrder;

  const box = document.createElement("div");
  box.className = "matching-box";

  const rows = document.createElement("div");
  rows.className = "match-rows";

  q.left.forEach((leftText, i) => {
    const row = document.createElement("div");
    row.className = "match-row";

    const lm = document.createElement("span");
    lm.className = "match-left-marker";
    lm.textContent = CHOICE_MARKERS[i] || i + 1;
    const lt = document.createElement("span");
    lt.className = "match-left-text";
    lt.textContent = leftText;
    const arrow = document.createElement("span");
    arrow.className = "match-arrow";
    arrow.textContent = "→";

    row.appendChild(lm);
    row.appendChild(lt);
    row.appendChild(arrow);

    if (!a.submitted && !reveal) {
      const sel = document.createElement("select");
      sel.className = "match-select";
      const opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "선택하세요…";
      sel.appendChild(opt0);
      order.forEach((rIdx, p) => {
        const opt = document.createElement("option");
        opt.value = String(p);
        opt.textContent = `${MATCH_MARKERS[p] || p + 1} ${q.right[rIdx]}`;
        sel.appendChild(opt);
      });
      sel.value = a.selected[i] == null ? "" : String(a.selected[i]);
      sel.addEventListener("change", () => {
        a.selected[i] = sel.value === "" ? null : Number(sel.value);
        const sb = box.querySelector(".match-submit");
        if (sb) sb.disabled = a.selected.some((v) => v == null);
      });
      row.appendChild(sel);
    } else {
      const p = a.selected[i];
      const chosenRight = p == null ? null : order[p];
      const correctRight = q.answer[i];
      const correctText = `${rightMarkerOf(order, correctRight)} ${q.right[correctRight]}`;
      const res = document.createElement("span");
      if (p == null) {
        // 미응답(미선택) 공개: 고른 답이 없으므로 정답만 표시
        res.className = "match-result skip";
        res.innerHTML = `<span class="match-correct">정답: ${escapeHtml(correctText)}</span>`;
      } else {
        const ok = chosenRight === correctRight;
        res.className = "match-result " + (ok ? "ok" : "no");
        const chosenText = `${MATCH_MARKERS[p] || p + 1} ${q.right[chosenRight]}`;
        if (ok) {
          res.innerHTML = `${escapeHtml(chosenText)} <b class="mark">⭕</b>`;
        } else {
          res.innerHTML =
            `${escapeHtml(chosenText)} <b class="mark">❌</b>` +
            `<span class="match-correct">정답: ${escapeHtml(correctText)}</span>`;
        }
      }
      row.appendChild(res);
    }

    rows.appendChild(row);
  });
  // 보기 목록 (문제 바로 아래에 표시)
  const legend = document.createElement("div");
  legend.className = "match-legend";
  const ltitle = document.createElement("div");
  ltitle.className = "match-legend-title";
  ltitle.textContent = "보기 목록";
  legend.appendChild(ltitle);
  order.forEach((rIdx, p) => {
    const item = document.createElement("div");
    item.className = "match-legend-item";
    item.textContent = `${MATCH_MARKERS[p] || p + 1} ${q.right[rIdx]}`;
    legend.appendChild(item);
  });
  box.appendChild(legend);
  box.appendChild(rows);

  if (!a.submitted && !reveal) {
    const submit = document.createElement("button");
    submit.className = "btn btn-primary match-submit";
    submit.textContent = "제출하고 정답 보기";
    submit.disabled = a.selected.some((v) => v == null);
    submit.addEventListener("click", () => {
      a.submitted = true;
      renderQuestion();
    });
    box.appendChild(submit);
  } else {
    const expl = document.createElement("div");
    let cls, title;
    if (!a.submitted) {            // 미응답 공개
      cls = "skip";
      title = "▫️ 미응답 — 정답을 확인하세요.";
    } else if (matchingAllCorrect(q, a)) {
      cls = "ok";
      title = "✅ 모두 맞혔습니다!";
    } else {
      cls = "no";
      title = "❌ 틀린 연결이 있어요. (모두 맞아야 정답)";
    }
    expl.className = "explanation " + cls;
    let html = `<div class="explanation-title">${title}</div>`;
    if (q.explanation) html += escapeHtml(q.explanation);
    expl.innerHTML = html;
    box.appendChild(expl);
  }

  area.appendChild(box);
}

/* ---- 네비게이션 ---- */
$("#btn-prev").addEventListener("click", () => {
  const nav = state.nav || state.questions.map((_, i) => i);
  const pos = nav.indexOf(state.index);
  if (pos > 0) {
    state.index = nav[pos - 1];
    renderQuestion();
  }
});
$("#btn-next").addEventListener("click", () => {
  const nav = state.nav || state.questions.map((_, i) => i);
  const pos = nav.indexOf(state.index);
  if (pos < nav.length - 1) {
    state.index = nav[pos + 1];
    renderQuestion();
  }
});
$("#btn-finish").addEventListener("click", () => {
  // 최초 제출 시에만(다시 보기 중 재집계는 제외) 미응답 확인
  if (!state.fromResult) {
    const skipped = state.questions.reduce(
      (n, q, i) => n + (classify(q, state.answers[i]).cls === "skip" ? 1 : 0),
      0
    );
    if (skipped > 0 &&
        !confirm(`아직 응답하지 않은 문제가 ${skipped}개 있습니다.\n그래도 제출할까요?`)) {
      return;
    }
  }
  showResult();
});

/* =========================================================
 * 4-b. 풀이 시간 타이머 (분:초)
 * ========================================================= */
// 초 → "mm:ss" (60분이 넘으면 분이 계속 증가: 65:03)
function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 60))}:${p(s % 60)}`;
}
function updateTimerDisplay() {
  $("#timer-display").textContent = formatClock(state.elapsed);
}
function setPauseIcon() {
  const b = $("#btn-timer-pause");
  b.textContent = state.timerPaused ? "▶" : "⏸";
  b.title = state.timerPaused ? "계속" : "일시정지";
}
function startTimer() {
  stopTimer();
  state.timerPaused = false;
  setPauseIcon();
  $("#timer-box").classList.remove("paused");
  state.timerId = setInterval(() => {
    if (!state.timerPaused) {
      state.elapsed++;
      updateTimerDisplay();
    }
  }, 1000);
}
function stopTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
}
function resetTimer() {
  stopTimer();
  state.elapsed = 0;
  state.timerPaused = false;
  state.timeFinal = null;
  $("#timer-box").classList.remove("paused");
  updateTimerDisplay();
}
function pauseTimer() {
  state.timerPaused = !state.timerPaused;
  setPauseIcon();
  $("#timer-box").classList.toggle("paused", state.timerPaused);
}
// 풀이 화면 타이머 영역 표시: 사용 중이면 시계+조작, 아니면 '타이머' 버튼
function renderTimerUI() {
  const box = $("#timer-box");
  if (state.timerActive) {
    // 처음 푸는 중
    box.hidden = false;
    const on = state.timerEnabled;
    $("#timer-display").hidden = !on;
    $("#btn-timer-pause").hidden = !on;
    $("#btn-timer-off").hidden = !on;
    $("#btn-timer-enable").hidden = on;
  } else if (state.fromResult && state.timerEnabled && state.timeFinal != null) {
    // 결과 후 다시 보기: 타이머를 실제로 쓴 경우에만 버튼 없이 최종 시간만 표시
    box.hidden = false;
    box.classList.remove("paused");
    $("#timer-display").hidden = false;
    $("#timer-display").textContent = formatClock(state.timeFinal);
    $("#btn-timer-pause").hidden = true;
    $("#btn-timer-off").hidden = true;
    $("#btn-timer-enable").hidden = true;
  } else {
    box.hidden = true;
  }
}

// 첫 화면 토글(버튼 2개) UI를 state.timerEnabled 와 동기화
function syncTimerToggle() {
  $("#timer-opt-on").classList.toggle("on", state.timerEnabled);
  $("#timer-opt-off").classList.toggle("on", !state.timerEnabled);
}
$("#timer-opt-on").addEventListener("click", () => { state.timerEnabled = true; syncTimerToggle(); });
$("#timer-opt-off").addEventListener("click", () => { state.timerEnabled = false; syncTimerToggle(); });

// 풀이 화면 일시정지
$("#btn-timer-pause").addEventListener("click", pauseTimer);
// 풀이 화면 '타이머' 버튼: 사용 확인 → 타이머 시작
$("#btn-timer-enable").addEventListener("click", () => {
  if (!confirm("타이머 기능을 사용하시겠습니까?")) return;
  state.timerEnabled = true;
  resetTimer();
  startTimer();
  renderTimerUI();
});
// 풀이 화면 끄기(✕): 시간 초기화 확인 → '타이머' 버튼으로 전환
$("#btn-timer-off").addEventListener("click", () => {
  if (!confirm("타이머를 끄면 측정된 시간이 초기화됩니다. 끄시겠습니까?")) return;
  state.timerEnabled = false;
  resetTimer();
  renderTimerUI();
});

/* =========================================================
 * 4-c. 문항 분류 · 네비게이션 · 번호 검색 (공통)
 * ========================================================= */
// 한 문항의 정/오/미응답 분류 (결과 집계와 칩 네비가 함께 사용)
function classify(q, a) {
  if (q.type === "multiple") {
    if (!a.submitted) return { cls: "skip", mark: "미응답" };
    return a.selected === q.answer ? { cls: "ok", mark: "정답" } : { cls: "no", mark: "오답" };
  } else if (q.type === "matching") {
    if (!a.submitted) return { cls: "skip", mark: "미응답" };
    return matchingAllCorrect(q, a) ? { cls: "ok", mark: "정답" } : { cls: "no", mark: "오답" };
  } else {
    if (a.selfGrade === "correct") return { cls: "ok", mark: "맞음" };
    if (a.selfGrade === "wrong") return { cls: "no", mark: "틀림" };
    return { cls: "skip", mark: "미채점" };
  }
}

// 이미 푼(제출한) 문제인지
function isSolved(idx) {
  const a = state.answers[idx];
  return !!(a && a.submitted);
}

// 결과 화면에서 한 문항을 눌러 다시 보기 창으로 진입
function enterReview(index, items, filter) {
  state.nav = items.map((it) => it.index);
  state.navFilter = filter;
  state.index = index;
  state.fromResult = true;       // 결과 화면에서 들어왔음 → 돌아가기 버튼 표시
  state.timerActive = false;     // 다시 보기는 시간 측정 안 함
  stopTimer();
  show("quiz");
  renderQuestion();
}

// 풀이 화면 '푼 문제로 이동' 드롭다운 갱신 (이미 푼 문제만, 푸는 순서대로)
function openQuizJump() {
  $("#quiz-jump-menu").hidden = false;
  $("#quiz-jump-btn").setAttribute("aria-expanded", "true");
}
function closeQuizJump() {
  const menu = $("#quiz-jump-menu");
  if (menu) menu.hidden = true;
  const btn = $("#quiz-jump-btn");
  if (btn) btn.setAttribute("aria-expanded", "false");
}
function renderQuizJump() {
  const wrap = $("#quiz-jump");
  wrap.hidden = false; // 풀이 중·다시 보기 모두 표시
  closeQuizJump();

  let candidates;
  if (state.fromResult) {
    // 다시 보기: 현재 탭(또는 전체)의 문항들만
    candidates = state.nav && state.nav.length ? state.nav : state.questions.map((_, i) => i);
  } else {
    // 풀이 중: 지나간(방문) 문항만, 푸는 순서대로
    const orderList = state.order && state.order.length ? state.order : state.questions.map((_, i) => i);
    candidates = orderList.filter((idx) => state.visited && state.visited.has(idx));
  }
  // 현재 보고 있는 문제는 목록에서 제외
  const list = candidates.filter((idx) => idx !== state.index);

  $("#quiz-jump-btn").disabled = list.length === 0;
  // 버튼 라벨: 항목이 있으면 현재 보고 있는 문제의 이름(미리보기), 없으면 안내 문구
  if (list.length) {
    const curPreview = (state.questions[state.index].question || "").split("\n")[0];
    const curShort = curPreview.length > 28 ? curPreview.slice(0, 28) + "…" : curPreview;
    $("#quiz-jump-label").textContent = `Q${displayNumOf(state.index)}. ${curShort}`;
  } else {
    $("#quiz-jump-label").textContent = "이동할 문제 없음";
  }

  const menu = $("#quiz-jump-menu");
  menu.innerHTML = "";
  list.forEach((idx) => {
    const { cls } = classify(state.questions[idx], state.answers[idx]); // ok/no/skip
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.className = cls; // 정답=연한 초록 / 오답=연한 빨강 / 미응답=연한 회색
    const preview = (state.questions[idx].question || "").split("\n")[0];
    const short = preview.length > 28 ? preview.slice(0, 28) + "…" : preview;
    li.textContent = `Q${displayNumOf(idx)}. ${short}`;
    li.title = li.textContent;
    li.addEventListener("click", () => {
      closeQuizJump();
      state.index = idx;
      renderQuestion();
    });
    menu.appendChild(li);
  });
}

/* =========================================================
 * 5. 결과
 * ========================================================= */
function showResult() {
  // 타이머 정지 후 최종 풀이 시간 확정 (토글 on이고 풀이 중 끄지 않았을 때만)
  stopTimer();
  state.timerActive = false;
  state.timeFinal = state.timerEnabled ? state.elapsed : null;

  let mcTotal = 0, mcCorrect = 0, shTotal = 0, shCorrect = 0, maTotal = 0, maCorrect = 0;

  state.questions.forEach((q, i) => {
    const a = state.answers[i];
    const ok = classify(q, a).cls === "ok";
    if (q.type === "multiple") { mcTotal++; if (ok) mcCorrect++; }
    else if (q.type === "matching") { maTotal++; if (ok) maCorrect++; }
    else { shTotal++; if (ok) shCorrect++; }
  });

  const total = mcTotal + shTotal + maTotal;
  const correct = mcCorrect + shCorrect + maCorrect;
  const rate = total ? Math.round((correct / total) * 100) : 0;

  $("#result-total").textContent = total;
  $("#result-correct").textContent = correct;
  $("#result-mc").textContent = `${mcCorrect} / ${mcTotal}`;
  $("#result-short").textContent = `${shCorrect} / ${shTotal}`;
  $("#result-match").textContent = `${maCorrect} / ${maTotal}`;
  $("#result-match-row").hidden = maTotal === 0; // 연결형 없으면 줄 숨김
  $("#score-rate").textContent = rate + "%";
  $(".score-circle").style.setProperty("--rate", rate + "%");
  $("#score-message").textContent = encourageMessage(rate);

  // 풀이 시간 표시 (타이머를 사용한 경우만)
  const timeRow = $("#result-time-row");
  if (state.timeFinal != null) {
    timeRow.hidden = false;
    $("#result-time").textContent = formatClock(state.timeFinal);
  } else {
    timeRow.hidden = true;
  }

  // 내보내기에서 재사용할 점수 요약 저장
  state.summary = { total, correct, rate, mcTotal, mcCorrect, shTotal, shCorrect, maTotal, maCorrect, time: state.timeFinal };

  // 문제별 결과(정답/오답/미응답)를 미리 계산해 두고 필터링에 사용
  state.results = state.questions.map((q, i) => {
    const { cls, mark } = classify(q, state.answers[i]);
    return { index: i, displayNum: displayNumOf(i), cls, mark, question: q.question };
  });

  state.resultFilter = "all";
  syncFilterButtons();
  renderResultList();

  show("result");
}

/* 현재 필터(state.resultFilter)에 맞는 문항만 목록에 그린다 */
function renderResultList() {
  const list = $("#result-list");
  list.innerHTML = "";

  const filter = state.resultFilter || "all";
  const items = (state.results || [])
    .filter((r) => filter === "all" || r.cls === filter)
    .sort((a, b) => a.displayNum - b.displayNum); // 푸는 순서대로

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "result-list-empty";
    empty.textContent =
      filter === "ok" ? "정답인 문항이 없습니다." :
      filter === "no" ? "오답인 문항이 없습니다." :
      filter === "skip" ? "미응답 문항이 없습니다." :
      "표시할 문항이 없습니다.";
    list.appendChild(empty);
    return;
  }

  items.forEach((r) => {
    const item = document.createElement("div");
    item.className = "result-item " + r.cls;
    item.innerHTML = `
      <span class="ri-num">Q${r.displayNum}</span>
      <span class="ri-text">${escapeHtml(r.question.split("\n")[0])}</span>
      <span class="ri-mark">${r.mark}</span>`;
    item.addEventListener("click", () => {
      // 현재 탭(필터)에 보이는 문항들만 이전/다음으로 순회 ('전체'는 navFilter=null)
      enterReview(r.index, items, filter === "all" ? null : filter);
    });
    list.appendChild(item);
  });
}

/* 필터 버튼 활성 상태를 state.resultFilter 와 동기화 */
function syncFilterButtons() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === (state.resultFilter || "all"));
  });
}

// 정답만 / 오답만 / 전체 필터 버튼
document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.resultFilter = btn.dataset.filter;
    syncFilterButtons();
    renderResultList();
  });
});

// 문제 다시 보기: 내 답안을 유지한 채 전체 문항을 처음부터 다시 본다
$("#btn-review").addEventListener("click", () => {
  // 푼 순서(order) 그대로 다시 본다
  state.nav = state.order && state.order.length ? state.order.slice() : state.questions.map((_, i) => i);
  state.navFilter = null;
  state.index = state.nav.length ? state.nav[0] : 0;
  state.fromResult = true; // 결과 화면에서 들어왔음 → 돌아가기 버튼 표시
  state.timerActive = false; // 다시 보기는 시간 측정 안 함
  stopTimer();
  show("quiz");
  renderQuestion();
});

// 결과 보기로 돌아가기: 답안(자가채점·미응답 변경 가능)을 반영해 결과를 다시 집계하되,
// 보고 있던 필터 탭은 그대로 유지한다.
$("#btn-back-result").addEventListener("click", () => {
  const prevFilter = state.resultFilter;
  showResult(); // 내부에서 resultFilter를 "all"로 초기화함
  if (prevFilter && prevFilter !== "all") {
    state.resultFilter = prevFilter;
    syncFilterButtons();
    renderResultList();
  }
});
// 같은 문제로 다시 시작: 같은 파일의 문항으로 답안을 초기화하고 새로 푼다
$("#btn-retry").addEventListener("click", () => {
  if (!confirm("같은 문제로 처음부터 다시 풀까요? 지금까지의 풀이 내용이 초기화됩니다.")) return;
  startQuiz();
});
$("#btn-restart").addEventListener("click", () => {
  if (!confirm("다른 파일로 다시 시작할까요? 현재 결과와 불러온 파일이 사라집니다.")) return;
  resetTimer();
  state.timerActive = false;
  syncTimerToggle();
  clearFile();
  show("start");
});

// '푼 문제로 이동' 드롭다운 열기/닫기
$("#quiz-jump-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  if ($("#quiz-jump-btn").disabled) return;
  if ($("#quiz-jump-menu").hidden) openQuizJump(); else closeQuizJump();
});
// 바깥 클릭 / Esc 로 닫기
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("#quiz-jump")) closeQuizJump();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeQuizJump();
});

// 결과 내보내기: 시험 결과 요약 + 일시 + 문항별 정/오답을 텍스트 파일로 저장
$("#btn-export").addEventListener("click", exportResult);

async function exportResult() {
  if (!state.results || !state.results.length) {
    alert("내보낼 결과가 없습니다. 먼저 시험을 끝까지 풀어 결과를 확인하세요.");
    return;
  }

  const now = new Date();
  const stamp = formatDateTime(now);   // 사람이 읽는 일시 (보고서 본문)
  const s = state.summary || {};
  const fileLabel = state.filename || "문제";

  const sep = "=".repeat(50);
  const lines = [];

  lines.push(sep);
  lines.push("시험 결과");
  lines.push(sep);
  lines.push(`문제 파일 : ${fileLabel}`);
  lines.push(`응시 일시 : ${stamp}`);
  if (s.time != null) lines.push(`풀이 시간 : ${formatClock(s.time)}`);
  lines.push("");
  lines.push(`정답률    : ${s.rate}%`);
  lines.push(`총점      : 전체 ${s.total}문항 중 ${s.correct}문항 정답`);
  lines.push(`객관식    : ${s.mcCorrect} / ${s.mcTotal}`);
  lines.push(`주관식    : ${s.shCorrect} / ${s.shTotal} (자가 채점)`);
  if (s.maTotal) lines.push(`연결형    : ${s.maCorrect} / ${s.maTotal}`);
  lines.push("");
  lines.push(sep);
  lines.push("문항별 결과");
  lines.push(sep);

  const SYMBOL = { ok: "⭕ 정답", no: "❌ 오답", skip: "▫️ 미응답" };

  // 푸는 순서대로 정렬해 내보낸다
  const ordered = [...state.results].sort((a, b) => a.displayNum - b.displayNum);
  ordered.forEach((r) => {
    const q = state.questions[r.index];
    const a = state.answers[r.index];
    lines.push("");
    lines.push(`[Q${r.displayNum}] ${SYMBOL[r.cls] || r.mark}`);
    lines.push(`문제: ${q.question}`);

    if (q.type === "multiple") {
      const myMark = a.submitted
        ? `${CHOICE_MARKERS[a.selected] || a.selected + 1}. ${q.choices[a.selected]}`
        : "(미응답)";
      const ansMark = `${CHOICE_MARKERS[q.answer] || q.answer + 1}. ${q.choices[q.answer]}`;
      lines.push(`내 답: ${myMark}`);
      lines.push(`정답: ${ansMark}`);
    } else if (q.type === "matching") {
      const order = Array.isArray(a.rightOrder) ? a.rightOrder : q.right.map((_, k) => k);
      q.left.forEach((lt, i) => {
        const p = a.selected ? a.selected[i] : null;
        const chosen = p == null ? "(미선택)" : q.right[order[p]];
        const correct = q.right[q.answer[i]];
        const ok = p != null && order[p] === q.answer[i];
        const tail = ok ? "⭕" : `❌ (정답: ${correct})`;
        lines.push(`  ${CHOICE_MARKERS[i] || i + 1} ${lt} → ${chosen} ${tail}`);
      });
    } else {
      lines.push(`내 답: ${a.selected ? a.selected : "(작성하지 않음)"}`);
      lines.push(`모범답안: ${q.modelAnswer || "(없음)"}`);
      lines.push(`자가 채점: ${r.mark}`);
    }
  });

  lines.push("");
  lines.push(sep);

  const content = lines.join("\n");
  const baseName = fileLabel.replace(/\.[^.]+$/, ""); // 확장자 제거
  const fname = `시험결과_${baseName}_${formatStamp(now)}.txt`;
  await downloadText(content, fname);
}

// 보고서 본문용: 2026-06-15 14:30 (초 제외)
function formatDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 파일명용: 20260615 (년월일만)
function formatStamp(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// 텍스트 내용을 파일로 저장 (BOM 추가로 한글 깨짐 방지)
// File System Access API 지원 시 저장 위치 선택 다이얼로그를 띄우고,
// 미지원(또는 취소) 시 기본 다운로드로 폴백한다.
async function downloadText(content, filename) {
  const data = "﻿" + content; // UTF-8 BOM
  const blob = new Blob([data], { type: "text/plain;charset=utf-8" });

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: "텍스트 파일", accept: { "text/plain": [".txt"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return; // 사용자가 취소함
      // 그 외 오류는 아래 기본 다운로드로 폴백
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 파일 제거 버튼 (X)
$("#btn-remove").addEventListener("click", clearFile);

// 출제 형식 모달 열기/닫기
const ruleModal = $("#rule-modal");
$("#btn-rule").addEventListener("click", () => {
  if (typeof window.loadRuleDoc === "function") window.loadRuleDoc(); // RULE.md 최신 내용 반영
  ruleModal.hidden = false;
});
$("#btn-rule-close").addEventListener("click", () => (ruleModal.hidden = true));
ruleModal.addEventListener("click", (e) => {
  if (e.target === ruleModal) ruleModal.hidden = true; // 바깥 영역 클릭 시 닫기
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ruleModal.hidden) ruleModal.hidden = true;
});

// 키보드 좌우 화살표로도 이전/다음 이동 (기존 마우스/버튼 클릭은 그대로)
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (!ruleModal.hidden || screens.quiz.hidden) return; // 모달 열림 / 풀이 화면 아닐 때 무시
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = (e.target && e.target.tagName) || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return; // 답 입력/선택 중엔 커서 이동 우선
  if (e.key === "ArrowLeft") {
    const b = $("#btn-prev");
    if (!b.disabled) { e.preventDefault(); b.click(); }
  } else {
    const b = $("#btn-next"); // 마지막 문제에선 숨겨져 있어 결과가 자동 제출되지 않음
    if (!b.hidden && !b.disabled) { e.preventDefault(); b.click(); }
  }
});

// 풀이 중 홈 버튼: 처음 화면으로 돌아가며 파일도 제거
$("#btn-home").addEventListener("click", () => {
  if (!confirm("처음 화면으로 돌아갈까요? 현재 풀이 내용과 불러온 파일이 사라집니다.")) return;
  resetTimer();
  state.timerActive = false;
  syncTimerToggle();
  clearFile();
  show("start");
});

/* 정답률 구간별 응원 메시지 (100% → 0%) */
function encourageMessage(rate) {
  if (rate >= 100) return "🎉 완벽해요! 만점입니다. 정말 대단해요!";
  if (rate >= 90)  return "👏 거의 완벽해요! 조금만 더 하면 만점이에요.";
  if (rate >= 80)  return "💪 훌륭해요! 아주 잘하고 있어요.";
  if (rate >= 70)  return "😊 잘했어요! 이대로만 가면 충분해요.";
  if (rate >= 60)  return "📚 좋아요! 틀린 부분만 다시 보면 금방 올라요.";
  if (rate >= 50)  return "🔥 절반은 넘겼어요! 복습하면 확 오를 거예요.";
  if (rate >= 40)  return "✊ 조금만 더 힘내요! 오답부터 다시 봐요.";
  if (rate >= 30)  return "🌱 시작이 반이에요. 오답 위주로 복습해봐요.";
  if (rate >= 20)  return "🐢 천천히 가도 괜찮아요. 다시 도전해봐요!";
  if (rate >= 10)  return "💡 포기하지 마요! 한 문제씩 정복하면 돼요.";
  return "🌟 괜찮아요, 지금부터예요! 다시 한 번 풀어볼까요?";
}

/* ----------------------- 유틸 ----------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
