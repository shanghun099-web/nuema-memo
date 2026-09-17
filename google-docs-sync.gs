/**
 * 누에마 메모 → 구글 독스 연동 스크립트
 *
 * 설치 (한 번만):
 *  1. https://script.google.com 에서 "새 프로젝트" → 이 파일 내용을 전부 붙여넣고 저장
 *  2. 오른쪽 위 "배포" → "새 배포" → 유형 "웹 앱"
 *       - 다음 사용자 인증 정보로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자   ← 이게 아니면 앱에서 연결이 안 됩니다
 *  3. "배포" → 권한 허용(내 계정, 문서 만들기/편집 허용) → 나오는 웹 앱 URL(…/exec) 복사
 *  4. 누에마 메모 → 설정 → "Apps Script 웹앱 URL"에 붙여넣고 "연결 확인" → 저장
 *
 * 문서는 처음 전송될 때 내 드라이브에 "누에마 메모"라는 이름으로 자동 생성됩니다.
 * 이미 있는 문서에 쌓고 싶으면 아래 DOC_ID에 그 문서 ID(주소의 /d/와 /edit 사이)를 넣으세요.
 * 스크립트를 고친 뒤에는 "배포 관리" → 연필 → 버전 "새 버전" → 배포 를 해야 반영됩니다.
 */

const DOC_ID = '';          // 비워두면 자동 생성
const DOC_NAME = '누에마 메모';

function doGet() {
  const doc = getDoc_();
  return json_({ ok: true, url: doc ? doc.getUrl() : '' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = JSON.parse(e.postData.contents);
    const props = PropertiesService.getScriptProperties();
    const key = p.id ? 'sent_' + p.id : '';
    if (key && props.getProperty(key)) {
      // 같은 메모를 다시 보내면 문서에 중복으로 쌓지 않는다
      const d = getDoc_();
      return json_({ ok: true, dup: true, url: d ? d.getUrl() : '' });
    }
    const doc = getDoc_(true);
    const url = doc.getUrl();
    appendMemo_(doc.getBody(), p);
    doc.saveAndClose();
    if (key) props.setProperty(key, String(Date.now()));
    return json_({ ok: true, url: url });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 내부 ---------- */

function appendMemo_(body, p) {
  const H = DocumentApp.ParagraphHeading;
  body.appendParagraph(p.title || '제목 없음').setHeading(H.HEADING2);

  const meta = [p.category, p.created, p.kind === 'voice' ? '녹음' : '글', p.model].filter(Boolean).join('  ·  ');
  const metaP = body.appendParagraph(meta).setHeading(H.NORMAL);
  metaP.editAsText().setItalic(true).setForegroundColor('#888888');
  if (p.tags && p.tags.length) body.appendParagraph(p.tags.map(t => '#' + t).join('  ')).editAsText().setForegroundColor('#888888');

  section_(body, '내가 한 말', null);
  body.appendParagraph(p.transcript || '');

  list_(body, '핵심', p.points);
  list_(body, '살릴 점 (AI)', p.good);
  list_(body, '비어 있는 곳 (AI)', p.weak);
  list_(body, '생각해볼 질문 (AI)', p.questions);
  list_(body, '덧붙인 방향 (AI)', p.extend);
  if (p.draft) {
    section_(body, '초안 (AI)');
    body.appendParagraph(p.draft).editAsText().setItalic(true);
  }
  body.appendParagraph('');
  body.appendHorizontalRule();
}

function section_(body, title) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING4);
}

function list_(body, title, items) {
  if (!items || !items.length) return;
  section_(body, title);
  items.forEach(t => body.appendListItem(String(t)).setGlyphType(DocumentApp.GlyphType.BULLET));
}

/* 문서 찾기: DOC_ID → 저장된 ID → (create=true면) 새로 만들기 */
function getDoc_(create) {
  const props = PropertiesService.getScriptProperties();
  const id = DOC_ID || props.getProperty('doc_id');
  if (id) {
    try { return DocumentApp.openById(id); } catch (e) { /* 지워졌으면 아래에서 새로 만든다 */ }
  }
  if (!create) return null;
  const doc = DocumentApp.create(DOC_NAME);
  doc.getBody().appendParagraph(DOC_NAME).setHeading(DocumentApp.ParagraphHeading.TITLE);
  doc.saveAndClose();
  props.setProperty('doc_id', doc.getId());
  return DocumentApp.openById(doc.getId());
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
