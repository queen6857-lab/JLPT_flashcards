// grading-test/grade.js 를 브라우저용으로 감싼 파일 (node data/build.js 가 만듦). 직접 고치지 말 것
(function () {
const module = { exports: {} };
// 한국어 뜻 유연 채점기
// v1 = PRD v0.5에 적힌 규칙 그대로, v2 = 테스트 후 조정한 규칙

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JONG_B = 17;

// 활용 어미 (긴 것부터 검사)
const ENDINGS = {
  ha: ['하였습니다', '했습니다', '합니다', '하였다', '했다', '해요', '하다', '하는', '하기', '한다', '한', '함', '해'],
  doe: ['되었습니다', '됐습니다', '됩니다', '되었다', '됐다', '돼요', '되요', '되다', '되는', '된다', '된', '됨', '돼'],
  ida: ['입니다', '이에요', '이다', '예요'],
  gen: ['었습니다', '았습니다', '습니다', '었다', '았다', '어요', '아요', '여요', '는다', '다', '요'],
};
const NEGATIONS = ['없', '않', '아니', '못', '안되', '안돼'];

function stripChars(s) {
  return s.replace(/[.,~〜!?！？·…'"“”‘’\-]/g, '').toLowerCase();
}

function normalize(s) {
  return stripChars(s.replace(/\(.*?\)|（.*?）/g, '')).replace(/\s+/g, '');
}

// 정규화 문자열과 함께, 원래 띄어쓰기 기준 단어 시작 위치를 돌려준다
function tokenStarts(s) {
  const tokens = stripChars(s.replace(/\(.*?\)|（.*?）/g, '')).split(/\s+/).filter(Boolean);
  const starts = new Set();
  let pos = 0;
  for (const t of tokens) { starts.add(pos); pos += t.length; }
  return starts;
}

function decompose(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  return { cho: Math.floor(code / 588), jung: Math.floor((code % 588) / 28), jong: code % 28 };
}

function compose({ cho, jung, jong }) {
  return String.fromCharCode(0xac00 + cho * 588 + jung * 28 + jong);
}

function toJamo(s) {
  const out = [];
  for (const ch of s) {
    const d = decompose(ch);
    if (!d) { out.push(ch); continue; }
    out.push(CHO[d.cho], JUNG[d.jung]);
    if (d.jong) out.push(JONG[d.jong]);
  }
  return out;
}

// 어미를 떼어 낸 어간 후보들. 이다/입니다를 뗀 결과는 1글자면 버린다 (모이다 → 모 방지)
function stems(norm) {
  const out = new Set([norm]);
  for (const [group, list] of Object.entries(ENDINGS)) {
    for (const e of list) {
      if (norm.endsWith(e) && norm.length > e.length) {
        const stem = norm.slice(0, -e.length);
        if (group === 'ida' && stem.length < 2) continue;
        out.add(stem);
        break;
      }
    }
  }
  // ㅂ니다: 보냅니다 → 보내
  if (norm.endsWith('니다') && norm.length > 2) {
    const prev = decompose(norm[norm.length - 3]);
    if (prev && prev.jong === JONG_B) out.add(norm.slice(0, -3) + compose({ ...prev, jong: 0 }));
  }
  return [...out].filter(Boolean);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function hasNewNegation(input, meaning) {
  return NEGATIONS.some(n => input.includes(n) && !meaning.includes(n));
}

function matchOne(rawInput, rawMeaning, version) {
  const x = normalize(rawInput);
  const m = normalize(rawMeaning);
  if (!x || !m) return null;

  // 규칙 1: 정규화 후 일치
  if (x === m) return 'normalize';

  // 규칙 3: 어미 차이 허용
  const xs = stems(x);
  const ms = stems(m);
  if (xs.some(s => ms.includes(s))) return 'stem';

  // 규칙 4: 포함 일치
  if (version === 'v1') {
    if (ms.some(s => s.length >= 2 && x.includes(s))) return 'contains';
    if (xs.some(s => s.length >= 2 && m.includes(s))) return 'contains';
  } else {
    const starts = tokenStarts(rawInput);
    if (!hasNewNegation(x, m)) {
      // 입력이 정답 어간을 담고 있음: 띄어쓴 단어의 시작에서만 (불친절 ✕, 친절한 것 ○)
      for (const s of ms) {
        if (s.length < 2) continue;
        let i = x.indexOf(s);
        while (i !== -1) {
          if (starts.has(i)) return 'contains';
          i = x.indexOf(s, i + 1);
        }
      }
      // 정답이 입력을 담고 있음: 정답의 앞부분이고 절반 이상일 때만 (고장 ○, 자다 ✕)
      if (xs.some(s => s.length >= 2 && m.startsWith(s) && s.length / m.length >= 0.5)) return 'prefix';
    }
  }

  // 규칙 5: 오타 허용
  if (version === 'v1') {
    if (m.length >= 3 && levenshtein([...x], [...m]) <= 1) return 'typo';
  } else {
    if (toJamo(m).length >= 7) {
      const pairs = [[x, m], ...xs.flatMap(a => ms.map(b => [a, b]))];
      for (const [a, b] of pairs) {
        if (a.length < 2 || b.length < 2 || a[0] !== b[0]) continue; // 첫 글자는 같아야 함 (늦/늘, 간단/단단 방지)
        if (levenshtein(toJamo(a), toJamo(b)) <= 1) return 'typo';
      }
    }
  }
  return null;
}

function grade(input, meanings, version = 'v2') {
  for (const m of meanings) {
    const rule = matchOne(input, m, version);
    if (rule) return { ok: true, rule, meaning: m };
  }
  return { ok: false };
}

module.exports = { grade, normalize, stems };

window.Grader = module.exports;
})();
