/* =========================================================
 * 문제 파일 파서 (DOM 비의존 — 브라우저/Node 양쪽 동작)
 *   - parseTxt(text) : .txt 파일 파싱
 *   - parseJs(text)  : .js 파일 파싱
 * ========================================================= */

const CHOICE_MARKERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

function markerToIndex(ch) {
  const i = CHOICE_MARKERS.indexOf(ch);
  return i >= 0 ? i : -1;
}

/* 객체를 내부 표준 형태로 정규화 */
function normalizeQuestion(q) {
  const type = (q.type || (q.choices ? "multiple" : "short")).toLowerCase();
  if (type === "multiple") {
    // 이 함수에 들어오는 answer 는 이미 0-based 인덱스로 통일된 값입니다.
    return {
      type: "multiple",
      question: q.question,
      choices: q.choices || [],
      answer: q.answer,
      explanation: q.explanation || "",
      choiceExplanations: q.choiceExplanations || null,
    };
  }
  return {
    type: "short",
    question: q.question,
    modelAnswer: q.modelAnswer || q.answer || "",
    explanation: q.explanation || "",
  };
}

/* =========================== JS =========================== */
function parseJs(text) {
  const fakeWindow = {};
  const fakeModule = { exports: {} };
  const fn = new Function(
    "window",
    "module",
    "exports",
    text +
      "\n;return (typeof QUIZ_QUESTIONS!=='undefined'?QUIZ_QUESTIONS:(window.QUIZ_QUESTIONS||module.exports));"
  );
  const result = fn(fakeWindow, fakeModule, fakeModule.exports);
  if (!Array.isArray(result)) {
    throw new Error("QUIZ_QUESTIONS 배열을 찾을 수 없습니다. RULE.md의 JS 형식을 확인하세요.");
  }
  // JS 파일의 answer 는 보기 번호(1-based) → 내부 0-based 인덱스로 변환
  return result.map((q) => {
    const c = Object.assign({}, q);
    if (typeof c.answer === "number" && c.answer >= 1) c.answer = c.answer - 1;
    return normalizeQuestion(c);
  });
}

/* =========================== TXT ========================== */
function parseTxt(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // "정답 및 해설" 구분선 탐지
  let splitAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/정답\s*(및|\/)?\s*해설/.test(lines[i])) {
      splitAt = i;
      break;
    }
  }

  let questionLines = lines;
  let answerLines = [];
  if (splitAt >= 0) {
    questionLines = lines.slice(0, splitAt);
    answerLines = lines.slice(splitAt + 1);
  }

  const questions = parseQuestionBlocks(questionLines);

  if (answerLines.length) {
    const answerMap = parseAnswerSection(answerLines);
    applyAnswerSection(questions, answerMap);
  }

  return questions.map(normalizeQuestion);
}

function parseQuestionBlocks(lines) {
  const questions = [];
  let cur = null;

  const startQuestion = (qText, forceShort) => {
    if (cur) questions.push(cur);
    cur = {
      type: "multiple",
      question: qText,
      choices: [],
      answer: undefined,
      explanation: "",
      modelAnswer: "",
      choiceExplanations: {},
      _forceShort: !!forceShort,
    };
  };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[=\-_*~]{3,}$/.test(line)) continue; // 구분선 무시

    const qMatch = line.match(/^(?:\[(객관식|주관식)\]\s*)?(?:Q\s*)?(\d+)\s*[.)]\s*(.*)$/i);
    const labelOnly = line.match(/^\[(객관식|주관식)\]\s*(.*)$/);
    const munje = line.match(/^문제\s*[:：]\s*(.*)$/);

    // 번호로 시작하는 새 문제
    if (qMatch && qMatch[3] !== undefined) {
      const canStart =
        !cur || cur.choices.length > 0 || cur._sawMeta || cur._forceShort;
      // 직전 문제가 본문만 있고 비어있지 않다면 그래도 새 문제로 (번호가 증가하므로)
      if (canStart || true) {
        startQuestion(qMatch[3], qMatch[1] === "주관식");
        continue;
      }
    }
    if (munje) {
      startQuestion(munje[1], false);
      continue;
    }
    if (labelOnly && labelOnly[2]) {
      startQuestion(labelOnly[2], labelOnly[1] === "주관식");
      continue;
    }

    if (!cur) continue;

    // 선택지 ①②③④
    if (markerToIndex(line[0]) >= 0) {
      if (cur._inChoiceExp) {
        appendChoiceExp(cur, line);
      } else {
        cur.choices.push(line.slice(1).trim());
      }
      continue;
    }
    // 선택지 "1)" "2." 형식 (메타 이전 & 보기해설 아닐 때만)
    const numChoice = line.match(/^(\d+)\s*[).]\s*(.+)$/);
    if (numChoice && !cur._sawMeta && cur.choices.length < 10) {
      cur.choices.push(numChoice[2].trim());
      continue;
    }

    const ans = line.match(/^정답\s*[:：]\s*(.+)$/);
    if (ans) {
      cur._sawMeta = true;
      cur._inChoiceExp = false;
      cur.answer = parseAnswerToken(ans[1]);
      continue;
    }
    const model = line.match(/^(모범\s*답안|모범답|예시\s*답안)\s*[:：]\s*(.*)$/);
    if (model) {
      cur._sawMeta = true;
      cur._inChoiceExp = false;
      cur._forceShort = true;
      cur._lastMeta = "model";
      cur.modelAnswer = model[2];
      continue;
    }
    const exp = line.match(/^해설\s*[:：]\s*(.*)$/);
    if (exp) {
      cur._sawMeta = true;
      cur._inChoiceExp = false;
      cur._lastMeta = "exp";
      cur.explanation = exp[1];
      continue;
    }
    const choiceExp = line.match(/^보기\s*해설\s*[:：]?\s*(.*)$/);
    if (choiceExp) {
      cur._sawMeta = true;
      cur._inChoiceExp = true;
      if (choiceExp[1]) appendChoiceExp(cur, choiceExp[1]);
      continue;
    }

    // 이어지는 줄 처리
    if (cur._lastMeta === "model") {
      cur.modelAnswer += "\n" + line;
    } else if (cur._lastMeta === "exp") {
      cur.explanation += "\n" + line;
    } else if (!cur._sawMeta) {
      cur.question += "\n" + line;
    }
  }
  if (cur) questions.push(cur);

  // 후처리
  questions.forEach((q) => {
    if (q._forceShort || q.choices.length === 0) q.type = "short";

    if (q.choiceExplanations && Object.keys(q.choiceExplanations).length > 0) {
      const arr = [];
      for (let i = 0; i < q.choices.length; i++) arr[i] = q.choiceExplanations[i] || "";
      q.choiceExplanations = arr;
    } else {
      q.choiceExplanations = null;
    }
    delete q._forceShort;
    delete q._sawMeta;
    delete q._inChoiceExp;
    delete q._lastMeta;
  });

  return questions;
}

function appendChoiceExp(cur, line) {
  const idx = markerToIndex(line[0]);
  if (idx >= 0) cur.choiceExplanations[idx] = line.slice(1).trim();
}

/* "③" / "3" / "정답 ③번" 등에서 0-based 인덱스 추출 */
function parseAnswerToken(token) {
  token = String(token).trim();
  for (let i = 0; i < CHOICE_MARKERS.length; i++) {
    if (token.includes(CHOICE_MARKERS[i])) return i;
  }
  const num = token.match(/\d+/);
  if (num) return parseInt(num[0], 10) - 1;
  return undefined;
}

/* 기존 "정답 및 해설" 섹션 → {번호: {answer, explanation, model}} */
function parseAnswerSection(lines) {
  const map = {};
  let curNum = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^=+$/.test(line)) continue;

    const m = line.match(/^(?:Q\s*)?(\d+)\s*[.)]?\s*정답\s*[:：]?\s*(.+)$/i);
    if (m) {
      curNum = parseInt(m[1], 10);
      map[curNum] = { answer: parseAnswerToken(m[2]), explanation: "", model: "" };
      continue;
    }
    const head = line.match(/^(?:Q\s*)?(\d+)\s*[.)]\s*$/i);
    if (head) {
      curNum = parseInt(head[1], 10);
      if (!map[curNum]) map[curNum] = { answer: undefined, explanation: "", model: "" };
      continue;
    }
    if (curNum == null) continue;

    const ans = line.match(/^정답\s*[:：]?\s*(.+)$/);
    if (ans && map[curNum].answer === undefined) {
      map[curNum].answer = parseAnswerToken(ans[1]);
      continue;
    }
    const model = line.match(/^(모범\s*답안|예시\s*답안)\s*[:：]?\s*(.*)$/);
    if (model) {
      map[curNum].model = model[2];
      continue;
    }
    const tip = line.match(/^암기\s*팁\s*[:：]?\s*(.*)$/);
    if (tip) {
      map[curNum].explanation += (map[curNum].explanation ? "\n" : "") + "💡 암기 팁: " + tip[1];
      continue;
    }
    const exp = line.match(/^해설\s*[:：]?\s*(.*)$/);
    if (exp) {
      map[curNum].explanation += (map[curNum].explanation ? "\n" : "") + exp[1];
      continue;
    }
    map[curNum].explanation += (map[curNum].explanation ? "\n" : "") + line;
  }
  return map;
}

function applyAnswerSection(questions, map) {
  questions.forEach((q, i) => {
    const entry = map[i + 1];
    if (!entry) return;
    if (q.answer === undefined && entry.answer !== undefined) q.answer = entry.answer;
    if (!q.explanation && entry.explanation) q.explanation = entry.explanation;
    if (entry.model) {
      q.modelAnswer = entry.model;
      q.type = "short";
    }
  });
}

/* Node 환경 export (브라우저에서는 무시됨) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseTxt, parseJs, normalizeQuestion, CHOICE_MARKERS };
}
