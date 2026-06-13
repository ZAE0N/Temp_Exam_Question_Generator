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
};

/* ----------------------- DOM ------------------------ */
const $ = (sel) => document.querySelector(sel);
const screens = {
  start: $("#screen-start"),
  quiz: $("#screen-quiz"),
  result: $("#screen-result"),
};
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
  $("#loaded-filename").textContent = filename || state.filename || "불러온 파일";
  $("#loaded-count").textContent = questions.length;
  $("#count-mc").textContent = mc;
  $("#count-short").textContent = sh;
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
  state.index = 0;
  state.reviewMode = false;
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.index];
  const a = state.answers[state.index];
  const total = state.questions.length;

  // 헤더
  $("#q-position").textContent = `${state.index + 1} / ${total}`;
  const badge = $("#q-type-badge");
  badge.textContent = q.type === "multiple" ? "객관식" : "주관식";
  badge.classList.toggle("short", q.type === "short");
  $("#progress-fill").style.width = `${((state.index + 1) / total) * 100}%`;

  // 본문
  const area = $("#question-area");
  area.innerHTML = "";

  const qNum = document.createElement("div");
  qNum.className = "q-number";
  qNum.textContent = `Q${state.index + 1}.`;
  area.appendChild(qNum);

  const qText = document.createElement("div");
  qText.className = "q-text";
  qText.textContent = q.question;
  area.appendChild(qText);

  if (q.type === "multiple") {
    renderMultiple(area, q, a);
  } else {
    renderShort(area, q, a);
  }

  // 푸터 버튼 상태
  $("#btn-prev").disabled = state.index === 0;
  const isLast = state.index === total - 1;
  $("#btn-next").hidden = isLast;
  $("#btn-finish").hidden = !isLast;
}

/* ---- 객관식 렌더 ---- */
function renderMultiple(area, q, a) {
  const ul = document.createElement("ul");
  ul.className = "choices";

  q.choices.forEach((text, i) => {
    const li = document.createElement("li");
    li.className = "choice";
    li.innerHTML = `
      <span class="choice-marker">${CHOICE_MARKERS[i] || i + 1}</span>
      <span class="choice-text">${escapeHtml(text)}</span>
      <span class="choice-verdict"></span>`;

    if (a.submitted) {
      li.classList.add("disabled");
      applyChoiceVerdict(li, q, i, a);
    } else {
      li.addEventListener("click", () => {
        a.selected = i;
        a.submitted = true;
        renderQuestion(); // 즉시 채점 표시
      });
      if (a.selected === i) li.classList.add("selected");
    }
    ul.appendChild(li);

    // 선택지별 해설 (제출 후 표시)
    if (a.submitted && q.choiceExplanations && q.choiceExplanations[i]) {
      const ce = document.createElement("div");
      ce.className = "choice-explain";
      ce.textContent = q.choiceExplanations[i];
      ul.appendChild(ce);
    }
  });
  area.appendChild(ul);

  // 전체 해설
  if (a.submitted) {
    const correct = a.selected === q.answer;
    const box = document.createElement("div");
    box.className = "explanation " + (correct ? "ok" : "no");
    const head = correct ? "✅ 정답입니다!" : "❌ 오답입니다.";
    const correctMarker = CHOICE_MARKERS[q.answer] || (q.answer + 1);
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
  const box = document.createElement("div");
  box.className = "short-answer-box";

  if (!a.submitted) {
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
    // 내 답안
    const mine = document.createElement("div");
    mine.className = "your-answer";
    mine.innerHTML = `<div class="label">📝 내가 작성한 답안</div>${
      escapeHtml(a.selected || "(작성하지 않음)")
    }`;
    box.appendChild(mine);

    // 모범답안
    const model = document.createElement("div");
    model.className = "model-answer";
    let mhtml = `<div class="label">✅ 모범 답안</div>${escapeHtml(q.modelAnswer || "(모범답안 없음)")}`;
    if (q.explanation) mhtml += `\n\n💡 ${escapeHtml(q.explanation)}`;
    model.innerHTML = mhtml;
    box.appendChild(model);

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
    box.appendChild(grade);
  }

  area.appendChild(box);
}

/* ---- 네비게이션 ---- */
$("#btn-prev").addEventListener("click", () => {
  if (state.index > 0) {
    state.index--;
    renderQuestion();
  }
});
$("#btn-next").addEventListener("click", () => {
  if (state.index < state.questions.length - 1) {
    state.index++;
    renderQuestion();
  }
});
$("#btn-finish").addEventListener("click", showResult);

/* =========================================================
 * 5. 결과
 * ========================================================= */
function showResult() {
  let mcTotal = 0, mcCorrect = 0, shTotal = 0, shCorrect = 0;

  state.questions.forEach((q, i) => {
    const a = state.answers[i];
    if (q.type === "multiple") {
      mcTotal++;
      if (a.submitted && a.selected === q.answer) mcCorrect++;
    } else {
      shTotal++;
      if (a.selfGrade === "correct") shCorrect++;
    }
  });

  const total = mcTotal + shTotal;
  const correct = mcCorrect + shCorrect;
  const rate = total ? Math.round((correct / total) * 100) : 0;

  $("#result-total").textContent = total;
  $("#result-correct").textContent = correct;
  $("#result-mc").textContent = `${mcCorrect} / ${mcTotal}`;
  $("#result-short").textContent = `${shCorrect} / ${shTotal}`;
  $("#score-rate").textContent = rate + "%";
  $(".score-circle").style.setProperty("--rate", rate + "%");

  // 문제별 목록
  const list = $("#result-list");
  list.innerHTML = "";
  state.questions.forEach((q, i) => {
    const a = state.answers[i];
    let cls, mark;
    if (q.type === "multiple") {
      if (!a.submitted) { cls = "skip"; mark = "미응답"; }
      else if (a.selected === q.answer) { cls = "ok"; mark = "정답"; }
      else { cls = "no"; mark = "오답"; }
    } else {
      if (a.selfGrade === "correct") { cls = "ok"; mark = "맞음"; }
      else if (a.selfGrade === "wrong") { cls = "no"; mark = "틀림"; }
      else { cls = "skip"; mark = "미채점"; }
    }
    const item = document.createElement("div");
    item.className = "result-item " + cls;
    item.innerHTML = `
      <span class="ri-num">Q${i + 1}</span>
      <span class="ri-text">${escapeHtml(q.question.split("\n")[0])}</span>
      <span class="ri-mark">${mark}</span>`;
    item.addEventListener("click", () => {
      state.index = i;
      show("quiz");
      renderQuestion();
    });
    list.appendChild(item);
  });

  show("result");
}

$("#btn-review").addEventListener("click", () => {
  state.index = 0;
  show("quiz");
  renderQuestion();
});
$("#btn-restart").addEventListener("click", () => {
  clearFile();
  show("start");
});

// 파일 제거 버튼 (X)
$("#btn-remove").addEventListener("click", clearFile);

// 출제 형식 모달 열기/닫기
const ruleModal = $("#rule-modal");
$("#btn-rule").addEventListener("click", () => (ruleModal.hidden = false));
$("#btn-rule-close").addEventListener("click", () => (ruleModal.hidden = true));
ruleModal.addEventListener("click", (e) => {
  if (e.target === ruleModal) ruleModal.hidden = true; // 바깥 영역 클릭 시 닫기
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ruleModal.hidden) ruleModal.hidden = true;
});

// 풀이 중 홈 버튼: 처음 화면으로 돌아가며 파일도 제거
$("#btn-home").addEventListener("click", () => {
  if (!confirm("처음 화면으로 돌아갈까요? 현재 풀이 내용과 불러온 파일이 사라집니다.")) return;
  clearFile();
  show("start");
});

/* ----------------------- 유틸 ----------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
