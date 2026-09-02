// 까치뉴스 주소록(magpie/sources.json)이 멀쩡한지 매일 검사한다.
//
// ## 무엇을 하나
// 1. 파일 형식 검사 — 앱(lib/source_book.dart)과 **같은 규칙**으로 본다.
//    앱이 거부할 파일이면 여기서 먼저 걸려야 한다.
// 2. 모든 RSS 주소를 실제로 받아 본다. 90개 미만이 살아 있으면 실패한다.
//
// ## 실패하면 어떻게 되나
// 워크플로가 빨간불이 되고 GitHub 이 주인에게 메일을 보낸다. 그때 이 파일이
// 찍어 준 죽은 주소를 sources.json 에서 고치고 push 하면 **5분 안에 모든
// 사용자에게 반영**된다. 앱을 새로 낼 필요가 없다 — 그러려고 만든 구조다.
//
// 실행: node tools/magpie/check.mjs

import { readFile } from 'node:fs/promises';

const FILE = 'magpie/sources.json';
const MIN_ALIVE = 90; // 앱의 dart 검사기(tool/check_sources.dart)와 같은 기준
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';

const raw = await readFile(FILE, 'utf8');
let json;
try {
  json = JSON.parse(raw);
} catch (e) {
  console.error(`JSON 이 깨졌다: ${e.message}`);
  process.exit(1);
}

// ── 형식 검사 (앱과 같은 규칙) ──────────────────────────────
const problems = [];
if (json.version !== 1) problems.push(`version 이 1 이 아니다 (${json.version})`);
const outlets = json.outlets ?? {};
const sources = json.sources ?? [];
if (Object.keys(outlets).length === 0) problems.push('outlets 가 비었다');
if (!Array.isArray(sources) || sources.length < 50) {
  problems.push(`sources 가 ${sources.length ?? 0}개뿐이다 (최소 50)`);
}
for (const s of sources) {
  if (!s.outlet || !s.name || !s.section) {
    problems.push(`빈 칸이 있는 항목: ${JSON.stringify(s)}`);
    break;
  }
  if (!String(s.url).startsWith('http')) {
    problems.push(`http 로 시작하지 않는 주소: ${s.url}`);
    break;
  }
  if (!outlets[s.outlet]) {
    problems.push(`outlets 에 없는 언론사 id: ${s.outlet} (${s.name})`);
    break;
  }
}
if (problems.length > 0) {
  console.error('=== 형식 검사 실패 — 앱이 이 파일을 거부한다 ===');
  console.error(problems.join('\n'));
  process.exit(1);
}

// ── 생존 검사 ───────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(s) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(s.url, {
        headers: { 'User-Agent': UA },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      if (res.ok) {
        const body = await res.text();
        // 기사가 실제로 들어 있는지만 본다. 빈 껍데기 RSS 도 죽은 것이다.
        if (body.includes('<item') || body.includes('<entry')) return null;
        return `${s.name} ${s.section} ${s.url} (기사 0건)`;
      }
      if (attempt === 2) return `${s.name} ${s.section} ${s.url} (상태 ${res.status})`;
    } catch (e) {
      if (attempt === 2) return `${s.name} ${s.section} ${s.url} (${e.name})`;
    }
    await sleep(2000); // 순간 장애일 수 있으니 한 번은 쉬었다 다시
  }
  return null;
}

let ok = 0;
const dead = [];
for (let i = 0; i < sources.length; i += 8) {
  const results = await Promise.all(sources.slice(i, i + 8).map(probe));
  for (const r of results) (r === null ? ok++ : dead.push(r));
}

console.log(`살아 있음: ${ok} / ${sources.length}`);
if (dead.length > 0) {
  console.log('죽음:');
  for (const d of dead) console.log(`  ${d}`);
}
if (ok < MIN_ALIVE) {
  console.error(`\n=== ${MIN_ALIVE}개 미만이다. magpie/sources.json 에서 죽은 주소를 고칠 것 ===`);
  console.error('고치고 push 하면 5분 안에 모든 사용자에게 반영된다. 앱은 안 내도 된다.');
  process.exit(1);
}
console.log('\n=== 통과 ===');
