// 사용법: node run-tests.js [v1|v2]
const { grade } = require('./grade');
const data = require('./test-data.json');

const version = process.argv[2] || 'v2';
const falseReject = [];
const falseAccept = [];
let total = 0;

for (const item of data) {
  for (const input of item.accept) {
    total++;
    const r = grade(input, item.meanings, version);
    if (!r.ok) falseReject.push(`${item.display}  "${input}"`);
  }
  for (const input of item.reject) {
    total++;
    const r = grade(input, item.meanings, version);
    if (r.ok) falseAccept.push(`${item.display}  "${input}"  ← ${r.rule} (${r.meaning})`);
  }
}

const accepts = data.reduce((n, i) => n + i.accept.length, 0);
const rejects = data.reduce((n, i) => n + i.reject.length, 0);
console.log(`[${version}] 문항 ${data.length}개, 입력 ${total}개`);
console.log(`맞는 답 ${accepts}개 중 정답 처리 ${accepts - falseReject.length}개`);
console.log(`틀린 답 ${rejects}개 중 오답 처리 ${rejects - falseAccept.length}개`);
console.log(`\n틀린 답인데 정답 처리 (${falseAccept.length}):`);
falseAccept.forEach(s => console.log('  ' + s));
console.log(`\n맞는 답인데 오답 처리 (${falseReject.length}):`);
falseReject.forEach(s => console.log('  ' + s));
