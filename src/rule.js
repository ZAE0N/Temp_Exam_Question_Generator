/* =========================================================================
 * rule.js — RULE.md를 실시간으로 읽어 "출제 형식 보기" 모달에 렌더링합니다.
 *
 * 목적: 모달 내용을 HTML에 중복으로 적지 않고 RULE.md 한 곳만 관리하면 되도록.
 *       RULE.md를 수정하면 페이지를 새로고침할 때 모달도 자동으로 바뀝니다.
 *
 * 주의: 브라우저 보안 정책상 file:// 로 직접 열면 fetch 가 막힐 수 있습니다.
 *       그 경우 index.html 안에 들어 있는 정적 내용(폴백)이 그대로 표시됩니다.
 *       로컬 서버(예: VS Code Live Server, `python -m http.server`)나
 *       GitHub Pages 등으로 열면 RULE.md 가 그대로 반영됩니다.
 * ========================================================================= */
(function () {
  "use strict";

  const RULE_URL = "RULE.md";

  // ── 아주 작은 Markdown → HTML 변환기 (RULE.md 에서 쓰는 문법만 지원) ──
  // 지원: #~#### 제목, --- 구분선, ``` 코드블록, | | 표,
  //       - 목록(2칸 들여쓰기 중첩), > 인용, **굵게**, *기울임*, `인라인 코드`
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 줄 안의 인라인 서식 처리 (코드 → 굵게 → 기울임 순서)
  function inline(text) {
    let s = escapeHtml(text);
    // `코드`
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    // **굵게**
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // *기울임* (굵게 처리 후 남은 단일 별표)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    return s;
  }

  function renderMarkdown(md) {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const out = [];

    // 목록 스택: 들여쓰기 깊이 관리
    let listDepth = 0;
    const closeLists = (toDepth = 0) => {
      while (listDepth > toDepth) {
        out.push("</ul>");
        listDepth--;
      }
    };

    let i = 0;
    while (i < lines.length) {
      let line = lines[i];

      // 코드블록 ```
      const fence = line.match(/^```/);
      if (fence) {
        closeLists();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(escapeHtml(lines[i]));
          i++;
        }
        i++; // 닫는 ``` 건너뛰기
        out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
        continue;
      }

      // 표 (| ... |) — 헤더줄 + 구분줄 + 본문줄
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
          /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeLists();
        const splitRow = (row) =>
          row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const headers = splitRow(line);
        i += 2; // 헤더줄 + 구분줄
        const bodyRows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          bodyRows.push(splitRow(lines[i]));
          i++;
        }
        let t = '<table class="rule-table"><thead><tr>';
        headers.forEach((h) => (t += `<th>${inline(h)}</th>`));
        t += "</tr></thead><tbody>";
        bodyRows.forEach((r) => {
          t += "<tr>";
          r.forEach((c) => (t += `<td>${inline(c)}</td>`));
          t += "</tr>";
        });
        t += "</tbody></table>";
        out.push(t);
        continue;
      }

      // 인용 (> ...) — 연속된 줄을 한 blockquote 로
      if (/^\s*>\s?/.test(line)) {
        closeLists();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        // 인용 안의 - 목록도 단순 처리
        const inner = buf
          .map((b) => (/^\s*-\s+/.test(b) ? `• ${b.replace(/^\s*-\s+/, "")}` : b))
          .map((b) => inline(b))
          .join("<br>");
        const cls = /^\s*[⚠️]/.test(buf[0] || "") ? ' class="note"' : "";
        out.push(`<blockquote${cls}>${inner}</blockquote>`);
        continue;
      }

      // 제목
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeLists();
        const level = Math.min(h[1].length, 6);
        // RULE.md 의 # → 모달에선 h2 부터 시작 (h1 은 모달 헤더가 이미 차지)
        const tag = "h" + Math.min(level + 1, 6);
        out.push(`<${tag}>${inline(h[2])}</${tag}>`);
        i++;
        continue;
      }

      // 구분선
      if (/^\s*---+\s*$/.test(line) || /^\s*===+\s*$/.test(line)) {
        closeLists();
        out.push("<hr>");
        i++;
        continue;
      }

      // 목록 (- 또는 * 시작, 2칸 들여쓰기 = 중첩)
      const li = line.match(/^(\s*)[-*]\s+(.*)$/);
      if (li) {
        const depth = Math.floor(li[1].length / 2) + 1;
        if (depth > listDepth) {
          while (listDepth < depth) {
            out.push("<ul>");
            listDepth++;
          }
        } else if (depth < listDepth) {
          closeLists(depth);
        }
        out.push(`<li>${inline(li[2])}</li>`);
        i++;
        continue;
      }

      // 빈 줄
      if (/^\s*$/.test(line)) {
        closeLists();
        i++;
        continue;
      }

      // 일반 문단
      closeLists();
      out.push(`<p>${inline(line)}</p>`);
      i++;
    }
    closeLists();
    return out.join("\n");
  }

  // ── RULE.md 를 가져와 모달에 주입 ──
  function loadRule() {
    const container = document.querySelector("#rule-modal .rule-doc");
    if (!container) return;

    // 1) 임베드된 내용(rule-data.js)을 먼저 렌더 → file:// 로 더블클릭해도 즉시 표시
    if (typeof window.RULE_MD === "string") {
      container.innerHTML = renderMarkdown(window.RULE_MD);
    }

    // 2) 서버(http/https) 환경이면 RULE.md 를 직접 읽어 최신 내용으로 덮어씀
    fetch(RULE_URL, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("RULE.md 응답 오류: " + res.status);
        return res.text();
      })
      .then((md) => {
        container.innerHTML = renderMarkdown(md);
      })
      .catch((err) => {
        // file:// 등에서 fetch 가 막히면 위의 임베드 내용을 그대로 사용
        console.info("[rule] RULE.md 직접 읽기 실패 — 임베드된 내용을 표시합니다.", err.message);
      });
  }

  // 전역에 노출 (quiz.js 의 모달 열기 핸들러에서 호출)
  window.loadRuleDoc = loadRule;

  // 페이지 로드 시 미리 한 번 시도 (서버 환경이면 즉시 최신화)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadRule);
  } else {
    loadRule();
  }
})();
