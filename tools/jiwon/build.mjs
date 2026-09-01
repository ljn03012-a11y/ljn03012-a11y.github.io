// 청년지원금 앱이 읽을 자료를 만든다.
//
// ## 이 파일이 하는 일
// 온통청년 API 에서 정책을 받아, **앱이 그대로 그리기만 하면 되도록** 정리해서
// 지역별 JSON 파일로 떨군다. 앱은 자기 지역 파일 하나만 받아 그린다.
//
// ## 왜 앱이 아니라 여기서 정리하나
// 2026-09-01 에 "충북을 골랐는데 경북 의성군 것이 나온다" 는 문제가 있었다.
// 원인은 자료 쪽이었는데, 고치려면 **앱을 새로 내고 심사받고 사용자가
// 업데이트할 때까지** 며칠이 걸렸다. 정리를 여기서 하면 이 파일만 고쳐
// 다시 돌리면 몇 분 만에 모든 사용자에게 반영된다.
//
// 실행: node tools/jiwon/build.mjs   (환경변수 YOUTH_API_KEY 필요)

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.YOUTH_API_KEY;
if (!KEY) {
  console.error('YOUTH_API_KEY 가 없다. GitHub Secrets 에 넣었는지 확인할 것.');
  process.exit(1);
}

const BASE = 'https://www.youthcenter.go.kr/go/ythip/getPlcy';
const OUT = 'jiwon/data';

/** 앱의 지역 목록. 파일 이름은 이 코드로 짓는다(앱이 그대로 갖고 있다). */
const REGIONS = [
  ['서울', '11110'], ['경기', '41111'], ['인천', '28125'], ['부산', '26110'],
  ['대구', '27110'], ['광주·전남', '12110'], ['대전', '30110'], ['울산', '31110'],
  ['세종', '36110'], ['강원', '51110'], ['충북', '43111'], ['충남', '44131'],
  ['전북', '52111'], ['경북', '47111'], ['경남', '48121'], ['제주', '50110'],
];

/** 시군구 코드 앞 두 자리 -> 시도. */
const SIDO = {
  '11': '서울', '12': '광주·전남', '26': '부산', '27': '대구', '28': '인천',
  '30': '대전', '31': '울산', '36': '세종', '41': '경기', '43': '충북',
  '44': '충남', '47': '경북', '48': '경남', '50': '제주', '51': '강원',
  '52': '전북',
};

/**
 * 등록 조직의 **최상위기관 코드** -> 시도. 지역을 알아내는 **첫째 수단**이다.
 *
 * 이름 맞추기보다 이게 훨씬 확실하다. 이름은 '의성군'·'관광복지국' 처럼
 * 제멋대로 적히지만 코드는 정해진 값이라 흔들리지 않는다.
 * 2026-09-02 에 응답 1,693건을 전부 세어 아래 18개를 확인했다.
 * 중앙부처는 `1xxxxxx`, 정부산하기관은 `B000000` 이라 여기 없다 = 전국.
 */
const INST_CODE_SIDO = {
  '6110000': '서울',
  '6260000': '부산',
  '6270000': '대구',
  '6280000': '인천',
  '6290000': '광주·전남', // 광주광역시
  '6300000': '대전',
  '6310000': '울산',
  '5690000': '세종', // 세종만 6 으로 시작하지 않는다
  '6410000': '경기',
  '6430000': '충북',
  '6440000': '충남',
  '6460000': '광주·전남', // 전라남도
  '6130000': '광주·전남', // 전남광주통합특별시
  '6470000': '경북',
  '6480000': '경남',
  '6500000': '제주',
  '6530000': '강원', // 강원특별자치도
  '6540000': '전북', // 전북특별자치도
};

/**
 * 코드가 지자체처럼 생겼는데 위 표에 없으면 **빌드를 멈춘다**([unknownLocal]).
 *
 * 이게 이 파일에서 가장 중요한 안전장치다. 새 지자체 코드가 생기거나 기존
 * 코드가 바뀌면, 아무 말 없이 '전국' 으로 분류되어 **16개 지역 모두에 그 지역
 * 정책이 섞인다.** 의성군 사건이 정확히 그렇게 났다. 조용히 새는 대신
 * 시끄럽게 멈춘다 — 멈추면 직전 자료가 그대로 살아 있어 사용자는 멀쩡하다.
 */
const looksLocal = (code) => /^6\d{6}$/.test(code) || code === '5690000';

const unknownLocal = new Map();

// 코드가 비어 있는 정책(2026-09-02 기준 187건)을 위한 **둘째 수단**.
// 기관 이름으로 맞추되 **행정구역 전체 이름으로만** 맞춘다. '서울'·'부산' 두
// 글자로 맞추면 서울대학교·부산대학교가 하는 전국 사업까지 지역 것이 된다.
const INST_SIDO = {
  '서울특별시': '서울', '부산광역시': '부산', '대구광역시': '대구',
  '인천광역시': '인천', '광주광역시': '광주·전남', '대전광역시': '대전',
  '울산광역시': '울산', '세종특별자치시': '세종', '경기도': '경기',
  '강원특별자치도': '강원', '강원도': '강원', '충청북도': '충북',
  '충청남도': '충남', '전북특별자치도': '전북', '전라북도': '전북',
  '전라남도': '광주·전남', '전남광주통합특별시': '광주·전남',
  '경상북도': '경북', '경상남도': '경남', '제주특별자치도': '제주',
  '제주도': '제주',
};

/** 학력 코드 -> 사람이 읽는 말. 0049010(제한없음)·0049009(기타)는 안 쓴다. */
const SCHOOL = {
  '0049001': '고졸 미만', '0049002': '고교 재학', '0049003': '고교 졸업예정',
  '0049004': '고교 졸업', '0049005': '대학 재학', '0049006': '대학 졸업예정',
  '0049007': '대학 졸업', '0049008': '석·박사',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 한 지역치를 받는다.
 *
 * 서버가 몰아치면 JSON 대신 HTML 안내 페이지를 준다(2026-09-02 에 겪었다).
 * 그래서 천천히 부르고, HTML 이 오면 쉬었다 다시 시도한다.
 */
async function fetchRegion(zipCd) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const url = `${BASE}?apiKeyNm=${KEY}&pageNum=${page}&pageSize=250&rtnType=json&zipCd=${zipCd}`;
    let json = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(url, { headers: { 'User-Agent': 'jiwon-data-builder' } });
      const body = await res.text();
      if (body.startsWith('{')) { json = JSON.parse(body); break; }
      console.warn(`  ${zipCd} ${page}쪽 ${attempt}번째 실패(HTML). 쉬었다 재시도`);
      await sleep(4000 * attempt);
    }
    if (!json) throw new Error(`${zipCd} ${page}쪽을 끝내 못 받았다`);
    const list = json?.result?.youthPolicyList ?? [];
    out.push(...list);
    if (list.length < 250) break; // 더 없다
    await sleep(800);
  }
  return out;
}

const text = (v) => (v ?? '').toString().trim();

function ageOf(v) {
  const n = Number.parseInt(text(v), 10);
  return Number.isNaN(n) || n === 0 ? null : n;
}

function regionOf(p) {
  const zip = text(p.zipCd);
  const prefixes = new Set(
    zip.split(',').map((c) => c.trim()).filter((c) => c.length >= 2)
      .map((c) => c.slice(0, 2)),
  );
  // 한 시도만 적혀 있으면 그대로 믿는다.
  if (prefixes.size === 1) return SIDO[[...prefixes][0]] ?? '전국';

  // 여러 시도가 적혀 있으면 지역 코드로는 알 수 없다. 진짜 전국 정책(국토부 등)도
  // 16개 시도를 다 적고, 의성군처럼 **지역 정책인데 다 적어 놓은 곳**도 있다.

  // ① 등록 기관 **코드**로 판단한다. 가장 확실하다.
  const code = text(p.rgtrHghrkInstCd);
  if (code) {
    const byCode = INST_CODE_SIDO[code];
    if (byCode) return byCode;
    if (looksLocal(code)) {
      // 모르는 지자체 코드다. 조용히 넘기면 전국으로 새어 나간다.
      unknownLocal.set(code, text(p.rgtrHghrkInstCdNm) || text(p.plcyNm));
    }
  }

  // ② 코드가 비어 있으면 기관 **이름**으로. 시도 이름으로 시작하면 믿을 수 있다.
  for (const k of ['rgtrHghrkInstCdNm', 'rgtrUpInstCdNm', 'sprvsnInstCdNm', 'operInstCdNm']) {
    const inst = text(p[k]);
    if (!inst) continue;
    for (const [name, sido] of Object.entries(INST_SIDO)) {
      if (inst.startsWith(name)) return sido;
    }
  }
  return '전국';
}

function schoolingOf(p) {
  const codes = new Set(text(p.schoolCd).split(',').map((c) => c.trim()).filter(Boolean));
  if (codes.size === 0 || codes.has('0049010')) return null;
  const labels = Object.entries(SCHOOL).filter(([c]) => codes.has(c)).map(([, v]) => v);
  if (labels.length === 0) return null;
  return labels.length > 2 ? `${labels[0]} 등` : labels.join('·');
}

function categoryOf(p) {
  const l = text(p.lclsfNm);
  if (l.includes('주거')) return '주거';
  if (l.includes('일자리')) return '일자리';
  if (l.includes('교육') || l.includes('직업훈련')) return '교육';
  if (l.includes('복지') || l.includes('문화') || l.includes('금융')) return '복지문화';
  if (l.includes('참여') || l.includes('기반')) return '참여권리';
  return null;
}

/** 줄바꿈은 살리고 가로 공백만 정리. 상세 화면에서 글벽이 되지 않게. */
const multiline = (raw) => text(raw)
  .replace(/\r\n?/g, '\n')
  .replace(/[^\S\n]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const oneline = (raw) => text(raw).replace(/\s+/g, ' ').trim();

function periodOf(p) {
  const m = /^(\d{8})\s*~\s*(\d{8})$/.exec(text(p.aplyYmd));
  return m ? [m[1], m[2]] : [null, null];
}

const YMD = (() => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
})();

function toPolicy(p) {
  const [start, end] = periodOf(p);

  let support = multiline(p.plcySprtCn);
  if (!support) {
    support = [text(p.lclsfNm), text(p.mclsfNm)].filter(Boolean).join(' · ');
  }

  const conditions = [];
  const method = oneline(p.plcyAplyMthdCn);
  if (method) conditions.push(`신청방법: ${method}`);
  const add = oneline(p.addAplyQlfcCndCn);
  if (add) conditions.push(`추가조건: ${add}`);
  const docs = oneline(p.sbmsnDcmntCn);
  if (docs) conditions.push(`제출서류: ${docs}`);
  if (conditions.length === 0) conditions.push('자세한 조건은 공식 페이지에서 확인');

  const url = [p.aplyUrlAddr, p.refUrlAddr1, p.refUrlAddr2]
    .map(text).find((u) => u.startsWith('http')) ?? 'https://www.youthcenter.go.kr';

  const cat = categoryOf(p);

  return {
    id: text(p.plcyNo),
    title: text(p.plcyNm),
    summary: oneline(p.plcyExplnCn),
    amount: support,
    minAge: ageOf(p.sprtTrgtMinAge),
    maxAge: ageOf(p.sprtTrgtMaxAge),
    region: regionOf(p),
    schooling: schoolingOf(p),
    situations: cat ? [cat] : [],
    conditions,
    applyUrl: url,
    source: [text(p.sprvsnInstCdNm), text(p.operInstCdNm)].find(Boolean) || '온통청년',
    applyStart: start,
    applyEnd: end,
  };
}

/** 마감이 지난 것은 애초에 안 내보낸다. */
const stillOpen = (s) => !s.applyEnd || s.applyEnd >= YMD;

/** 마감 급한 순. 마감 없는 것(상시)은 뒤로 보낸다. */
const sortKey = (s) => s.applyEnd ?? '99999999';

async function main() {
  await mkdir(OUT, { recursive: true });
  const summary = [];

  for (const [name, zip] of REGIONS) {
    const raw = await fetchRegion(zip);

    const seen = new Set();
    const list = [];
    for (const p of raw) {
      const s = toPolicy(p);
      if (!s.title) continue;
      if (s.id && seen.has(s.id)) continue;
      if (s.id) seen.add(s.id);
      // 이 지역 사람에게 해당되는 것만 남긴다.
      if (s.region !== '전국' && s.region !== name) continue;
      if (!stillOpen(s)) continue;
      list.push(s);
    }
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    await writeFile(path.join(OUT, `${zip}.json`), JSON.stringify({
      region: name,
      builtAt: new Date().toISOString(),
      count: list.length,
      policies: list,
    }), 'utf8');

    summary.push(`${name}(${zip}): 받음 ${raw.length} -> 내보냄 ${list.length}`);
    console.log(summary[summary.length - 1]);
    await sleep(1200);
  }

  await writeFile(path.join(OUT, 'index.json'), JSON.stringify({
    builtAt: new Date().toISOString(),
    regions: Object.fromEntries(REGIONS.map(([n, z]) => [n, `${z}.json`])),
  }), 'utf8');

  // 모르는 지자체 코드가 하나라도 나왔으면 여기서 멈춘다.
  // 이 자료는 사람이 안 보고 앱으로 바로 가므로, 의심스러우면 안 내보낸다.
  if (unknownLocal.size > 0) {
    console.error('\n=== 모르는 지자체 코드가 나왔다. 자료를 내보내지 않는다 ===');
    for (const [code, who] of unknownLocal) {
      console.error(`  ${code}  ${who}`);
    }
    console.error('\n이 코드를 INST_CODE_SIDO 에 넣고 다시 돌릴 것.');
    console.error('그때까지 직전 자료가 그대로 쓰이므로 사용자에게는 영향이 없다.');
    process.exit(1);
  }

  console.log('\n=== 끝 ===');
  console.log(summary.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
