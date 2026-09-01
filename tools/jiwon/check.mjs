// 만들어진 자료가 멀쩡한지 검사한다. 하나라도 어긋나면 실패시켜 **커밋을 막는다.**
//
// ## 왜 필요한가
// 이 자료는 앱이 곧바로 받아서 그린다. 중간에 사람이 보는 눈이 없다.
// 온통청년 API 가 하루 이상해서 빈 목록을 주면, 검사가 없으면 그대로 커밋되고
// **모든 사용자 화면이 텅 빈다.** 그때는 이미 늦다.
//
// 그래서 "의심스러우면 실패" 로 만든다. 실패하면 **직전에 커밋된 멀쩡한 자료가
// 그대로 살아 있으므로** 사용자는 아무 일도 겪지 않는다.
//
// 실행: node tools/jiwon/check.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = 'jiwon/data';

const REGIONS = [
  ['서울', '11110'], ['경기', '41111'], ['인천', '28125'], ['부산', '26110'],
  ['대구', '27110'], ['광주·전남', '12110'], ['대전', '30110'], ['울산', '31110'],
  ['세종', '36110'], ['강원', '51110'], ['충북', '43111'], ['충남', '44131'],
  ['전북', '52111'], ['경북', '47111'], ['경남', '48121'], ['제주', '50110'],
];

/**
 * 지역당 최소 건수.
 *
 * 2026-09-02 첫 수집에서 가장 적은 곳이 강원 194건이었다. 절반인 100 밑으로
 * 떨어지면 정상적인 변동이 아니라 자료가 깨진 것으로 본다.
 */
const MIN_COUNT = 100;

const problems = [];
const notes = [];

const YMD = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
})();

for (const [name, zip] of REGIONS) {
  const file = path.join(OUT, `${zip}.json`);
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    problems.push(`${name}: 파일을 읽을 수 없다 (${e.message})`);
    continue;
  }

  const list = data.policies;
  if (!Array.isArray(list)) {
    problems.push(`${name}: policies 가 목록이 아니다`);
    continue;
  }
  if (list.length < MIN_COUNT) {
    problems.push(`${name}: ${list.length}건뿐이다 (최소 ${MIN_COUNT})`);
  }
  if (data.region !== name) {
    problems.push(`${name}: 파일 안 region 이 '${data.region}' 이다`);
  }

  // 남의 지역 것이 섞였는지. 이게 2026-09-01 의 의성군 사건이다.
  const wrong = list.filter((p) => p.region !== '전국' && p.region !== name);
  if (wrong.length > 0) {
    problems.push(`${name}: 남의 지역 정책 ${wrong.length}건 섞임 (예: ${wrong[0].title})`);
  }

  // 마감이 지난 것은 애초에 빠져 있어야 한다.
  const expired = list.filter((p) => p.applyEnd && p.applyEnd < YMD);
  if (expired.length > 0) {
    problems.push(`${name}: 마감 지난 정책 ${expired.length}건 남아 있음`);
  }

  // 제목이나 링크가 빈 것은 화면에서 빈 카드가 된다.
  const broken = list.filter((p) => !p.title || !p.applyUrl);
  if (broken.length > 0) {
    problems.push(`${name}: 제목·링크가 빈 정책 ${broken.length}건`);
  }

  // 정렬이 맞는지 (마감 급한 순). 앱은 다시 정렬하지 않는다.
  const keys = list.map((p) => p.applyEnd ?? '99999999');
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  if (keys.join() !== sorted.join()) {
    problems.push(`${name}: 마감 급한 순으로 정렬돼 있지 않다`);
  }

  const withSchool = list.filter((p) => p.schooling).length;
  notes.push(`${name}: ${list.length}건 (학력조건 있는 것 ${withSchool}건)`);
}

// index.json 도 확인
try {
  const idx = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'));
  for (const [name, zip] of REGIONS) {
    if (idx.regions?.[name] !== `${zip}.json`) {
      problems.push(`index.json: ${name} 항목이 잘못됐다`);
    }
  }
} catch (e) {
  problems.push(`index.json 을 읽을 수 없다 (${e.message})`);
}

console.log(notes.join('\n'));

if (problems.length > 0) {
  console.error('\n=== 검사 실패 — 커밋하지 않는다 ===');
  console.error(problems.join('\n'));
  console.error('\n직전 자료가 그대로 살아 있으므로 사용자에게는 영향이 없다.');
  process.exit(1);
}

console.log('\n=== 검사 통과 ===');
