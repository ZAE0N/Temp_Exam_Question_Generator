/* =========================================================================
 * build-rule.js — RULE.md 내용을 src/rule-data.js 로 구워 넣습니다.
 *
 * 왜 필요한가:
 *   브라우저 보안 정책상 index.html 을 file:// 로 직접 열면 fetch("RULE.md") 가
 *   막힙니다. 그래서 RULE.md 내용을 JS 변수(window.RULE_MD)로도 미리 넣어 두면
 *   서버 없이 더블클릭으로 열어도 최신 내용이 보입니다.
 *
 * 사용법: RULE.md 를 고친 뒤 (프로젝트 루트에서) 터미널에서
 *   node src/build-rule.js
 * 를 한 번 실행하면 됩니다. (로컬 서버/호스팅으로 여는 경우엔 안 해도 자동 반영)
 * ========================================================================= */
const fs = require("fs");
const path = require("path");

// 이 스크립트는 src/ 안에 있으므로 RULE.md 는 상위 폴더, 출력은 같은 폴더(src)
const srcDir = __dirname;
const projectRoot = path.join(srcDir, "..");
const md = fs.readFileSync(path.join(projectRoot, "RULE.md"), "utf8");
const out =
  "/* 이 파일은 src/build-rule.js 가 RULE.md 로부터 자동 생성합니다. 직접 수정하지 마세요. */\n" +
  "window.RULE_MD = " + JSON.stringify(md) + ";\n";

fs.writeFileSync(path.join(srcDir, "rule-data.js"), out, "utf8");
console.log("[build-rule] src/rule-data.js 생성 완료 (" + md.length + "자)");
