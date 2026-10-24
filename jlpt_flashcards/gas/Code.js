// 웹앱 진입점. index.html 은 node data/build.js 가 app/ 파일을 묶어 만든다.
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('JLPT N4 암기장')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
