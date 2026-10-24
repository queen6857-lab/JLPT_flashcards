// 사용법: node data/build.js
// data/src 의 원본(한 줄 = 한 항목, | 구분)을 읽어 PRD 3.4 구조의 JSON을 만들고 검증한다.
//   vocab-*.txt / n5-vocab-*.txt     : 표기|읽기|뜻;뜻|품사|예문|예문 읽기|예문 해석   (가나 단어는 읽기 생략 가능)
//   pattern-*.txt / n5-pattern-*.txt : 문형|뜻;뜻|예문|예문 읽기|예문 해석
// 결과: n4-vocab.json, n4-pattern.json, n5-review.json (N5 단어 + 문형)
const fs = require('fs');
const path = require('path');
const { normalize } = require('../grading-test/grade');

const SRC = path.join(__dirname, 'src');
const KANJI = /[一-鿿々]/;
const KATAKANA_ONLY = /^[゠-ヿー]+$/;

function scriptOf(display) {
  if (KANJI.test(display)) return 'kanji';
  if (KATAKANA_ONLY.test(display)) return 'katakana';
  return 'hiragana';
}

function readLines(prefix) {
  const files = fs.readdirSync(SRC).filter(f => f.startsWith(prefix) && f.endsWith('.txt')).sort();
  const lines = [];
  for (const f of files) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split(/\r?\n/).forEach((text, i) => {
      if (text.trim() && !text.startsWith('#')) lines.push({ text, where: `${f}:${i + 1}` });
    });
  }
  return lines;
}

const errors = [];
const warn = (where, msg) => errors.push(`${where}  ${msg}`);

function checkExample(where, ex) {
  if (!ex.text || !ex.reading || !ex.ko) return warn(where, '예문/읽기/해석 누락');
  if (KANJI.test(ex.reading)) warn(where, `예문 읽기에 한자: ${ex.reading}`);
  const end = s => s.slice(-1);
  if (end(ex.text) !== end(ex.reading)) warn(where, '예문과 읽기의 끝 문장부호가 다름');
  // 예문의 한자 아닌 부분(가나·문장부호)이 읽기에 같은 순서로 다 들어 있어야 함
  let pos = 0;
  for (const run of ex.text.split(/[一-鿿々]+/).filter(Boolean)) {
    const i = ex.reading.indexOf(run, pos);
    if (i === -1) return warn(where, `예문 읽기에 "${run}" 부분이 없음`);
    pos = i + run.length;
  }
}

function checkMeanings(where, meanings) {
  if (!meanings.length) warn(where, '뜻 없음');
  meanings.forEach(m => { if (!normalize(m)) warn(where, `정규화하면 빈 뜻: "${m}"`); });
}

// 단어 (seen은 N4·N5 공통: N5 복습에 N4 단어가 다시 들어가면 중복으로 잡는다)
const seen = new Set();
function buildVocab(prefix, level) {
  const vocab = [];
  for (const { text, where } of readLines(prefix)) {
    const f = text.split('|');
    if (f.length !== 7) { warn(where, `칸 수 ${f.length} (7이어야 함)`); continue; }
    const [display, readingRaw, meaningsRaw, category, exText, exReading, exKo] = f.map(s => s.trim());
    const script = scriptOf(display);
    const reading = readingRaw || display;
    if (script === 'kanji' && !readingRaw) warn(where, '한자 단어인데 읽기 없음');
    if (KANJI.test(reading)) warn(where, `읽기에 한자: ${reading}`);

    const key = `${display}|${reading}`;
    if (seen.has(key)) warn(where, `중복: ${display}`);
    seen.add(key);

    const meanings = meaningsRaw.split(';').map(s => s.trim()).filter(Boolean);
    checkMeanings(where, meanings);
    const example = { text: exText, reading: exReading, ko: exKo };
    checkExample(where, example);

    // 활용하는 말(동사·い형용사)은 끝 글자가 바뀌므로 어간만 비교
    const conjugates = category === '동사' || category === 'い형용사';
    // 예문에 그 단어가 실제로 들어 있는지 (한자 단어는 첫 한자, 가나 단어는 표기 앞부분)
    const kanaAnchor = conjugates ? display.slice(0, Math.max(1, display.length - 1)) : display.slice(0, 2);
    const anchor = script === 'kanji' ? [...display].find(c => KANJI.test(c)) : kanaAnchor;
    if (!exText.includes(anchor)) warn(where, `예문에 "${anchor}" 없음`);
    const readingStem = conjugates ? reading.slice(0, Math.max(1, reading.length - 1)) : reading.slice(0, 2);
    if (script === 'kanji' && !exReading.includes(readingStem)) warn(where, `예문 읽기에 "${readingStem}" 없음`);

    vocab.push({ type: 'vocab', script, display, reading, meanings, example, level, category });
  }
  return vocab;
}

// 문형
function buildPatterns(prefix, level) {
  const patterns = [];
  for (const { text, where } of readLines(prefix)) {
    const f = text.split('|');
    if (f.length !== 5) { warn(where, `칸 수 ${f.length} (5여야 함)`); continue; }
    const [display, meaningsRaw, exText, exReading, exKo] = f.map(s => s.trim());
    const meanings = meaningsRaw.split(';').map(s => s.trim()).filter(Boolean);
    checkMeanings(where, meanings);
    const example = { text: exText, reading: exReading, ko: exKo };
    checkExample(where, example);
    patterns.push({ type: 'pattern', script: scriptOf(display), display, meanings, example, level });
  }
  return patterns;
}

// id는 학습 기록의 키이므로 급수끼리 겹치지 않게 접두어를 다르게 둔다
function withIds(items, prefix) {
  return items.map((item, i) => ({ id: prefix + String(i + 1).padStart(4, '0'), ...item }));
}
const write = (file, data) => fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2) + '\n');

const n4Vocab = buildVocab('vocab-', 'N4');
const n4Patterns = buildPatterns('pattern-', 'N4');
const n5Vocab = buildVocab('n5-vocab-', 'N5');
const n5Patterns = buildPatterns('n5-pattern-', 'N5');

write('n4-vocab.json', withIds(n4Vocab, 'v'));
write('n4-pattern.json', withIds(n4Patterns, 'p'));
write('n5-review.json', [...withIds(n5Vocab, 'n5v'), ...withIds(n5Patterns, 'n5p')]);

// 앱(app/)은 더블클릭(file://)으로 열어 fetch가 막히므로, 데이터와 채점기를 스크립트로 묶어 넣는다
const APP = path.join(__dirname, '..', 'app');
fs.mkdirSync(APP, { recursive: true });
const appData = {
  'n4-vocab': withIds(n4Vocab, 'v'),
  'n4-pattern': withIds(n4Patterns, 'p'),
  'n5-review': [...withIds(n5Vocab, 'n5v'), ...withIds(n5Patterns, 'n5p')],
};
fs.writeFileSync(path.join(APP, 'data.js'),
  '// node data/build.js 가 만든 파일. 직접 고치지 말 것\nwindow.JLPT_DATA = ' + JSON.stringify(appData) + ';\n');
const gradeSrc = fs.readFileSync(path.join(__dirname, '..', 'grading-test', 'grade.js'), 'utf8');
fs.writeFileSync(path.join(APP, 'grade.js'),
  '// grading-test/grade.js 를 브라우저용으로 감싼 파일 (node data/build.js 가 만듦). 직접 고치지 말 것\n' +
  '(function () {\nconst module = { exports: {} };\n' + gradeSrc + '\nwindow.Grader = module.exports;\n})();\n');

// 구글 앱스 스크립트(gas/)용: 앱 파일을 HTML 한 장에 모두 넣는다 (clasp push 로 올림)
const GAS = path.join(__dirname, '..', 'gas');
const inline = file => fs.readFileSync(path.join(APP, file), 'utf8').replace(/<\/(script|style)/gi, '<\\/$1');
const gasHtml = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  .replace(/<link rel="stylesheet" href="([^"]+)">/, (_, f) => `<style>\n${inline(f)}</style>`)
  .replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${inline(f)}</script>`);
fs.writeFileSync(path.join(GAS, 'index.html'), gasHtml);

const summary = (label, vocab, patterns) => {
  const count = s => vocab.filter(v => v.script === s).length;
  console.log(`${label}: 단어 ${vocab.length}개 (한자 ${count('kanji')}, 히라가나 ${count('hiragana')}, 가타카나 ${count('katakana')}), 문형 ${patterns.length}개`);
};
summary('N4', n4Vocab, n4Patterns);
summary('N5 복습', n5Vocab, n5Patterns);
console.log(errors.length ? `\n검증 경고 ${errors.length}개:\n` + errors.join('\n') : '검증 경고 없음');
process.exitCode = errors.length ? 1 : 0;
