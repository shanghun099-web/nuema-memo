/**
 * 누에마 메모 → 구글 독스 연동 + 드라이브 백업 스크립트  (v4)
 *   - 다시 보내면 문서의 그 항목을 새 내용으로 바꿈 (이름표가 없는 예전 항목도 제목·날짜로 찾아 바꿈)
 *   - 앱에서 메모를 지우면 문서에서도 지움
 *   - v4: 내 드라이브 "누에마 메모 백업" 폴더에 메모 전체(최근 7개)와 녹음 파일을 백업하고, 새 폰에서 되살림
 *
 * v3 에서 v4 로 바꿀 때 (이미 쓰고 있다면 이것만):
 *  1. script.google.com 의 이 프로젝트에서 코드를 전부 지우고 이 파일 내용을 붙여넣고 저장
 *  2. 위쪽 함수 고르는 칸에서 "setupBackup" 을 고르고 "실행" → 권한 허용
 *       (드라이브에 백업 폴더를 만들려고 "드라이브 파일 보기·수정" 권한을 새로 묻습니다)
 *  3. "배포" → "배포 관리" → 연필(수정) → 버전: "새 버전" → "배포"   (URL 은 그대로)
 *
 * 설치 (한 번만):
 *  1. https://script.google.com 에서 "새 프로젝트" → 이 파일 내용을 전부 붙여넣고 저장
 *  2. 오른쪽 위 "배포" → "새 배포" → 유형 "웹 앱"
 *       - 다음 사용자 인증 정보로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자   ← 이게 아니면 앱에서 연결이 안 됩니다
 *  3. "배포" → 권한 허용(내 계정, 문서 만들기/편집 허용) → 나오는 웹 앱 URL(…/exec) 복사
 *  4. 누에마 메모 → 설정 → "Apps Script 웹앱 URL"에 붙여넣고 "연결 확인" → 저장
 *
 * 스크립트를 고친 뒤(이 파일을 새로 붙여넣은 뒤)에는:
 *    "배포" → "배포 관리" → 연필(수정) → 버전: "새 버전" → "배포"   를 해야 반영됩니다. URL은 그대로입니다.
 *    ("새 배포"를 누르면 다른 URL이 생기니 주의)
 *
 * 문서는 처음 전송될 때 내 드라이브에 "누에마 메모"라는 이름으로 자동 생성됩니다.
 * 이미 있는 문서에 쌓고 싶으면 아래 DOC_ID에 그 문서 ID(주소의 /d/와 /edit 사이)를 넣으세요.
 */

const DOC_ID = '';          // 비워두면 자동 생성
const DOC_NAME = '누에마 메모';
const BACKUP_FOLDER = '누에마 메모 백업';
const KEEP_BACKUPS = 7;      // 메모 전체 백업은 최근 몇 개까지 남길지

function doGet() {
  const doc = getDoc_();
  return json_({ ok: true, v: 4, url: doc ? doc.getUrl() : '' });
}

/* 처음 한 번 편집기에서 실행해 드라이브 권한을 허용하고 백업 폴더를 만든다 */
function setupBackup() {
  Logger.log('백업 폴더: ' + folder_().getUrl());
}

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: '요청을 읽지 못했습니다' }); }
  if (String(p.action || '').indexOf('bk') === 0) return backup_(p);   // 백업은 문서를 건드리지 않는다
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = p.id ? 'sent_' + p.id : '';
    const doc = getDoc_(true);
    const body = doc.getBody();
    const url = doc.getUrl();
    const rangeName = p.id ? 'nuema_' + p.id : '';

    // 문서에서 이 메모의 자리를 찾는다: 이름표 → (없으면) 제목·날짜 모양으로
    let at = null, legacy = false;
    if (rangeName) {
      const found = doc.getNamedRanges(rangeName);
      if (found.length) at = removeRange_(doc, body, found[0]);
      else {
        at = removeLegacy_(doc, body, p);
        if (at === null && key && props.getProperty(key)) legacy = true;   // 못 찾음: 끝에 새로 붙인다
      }
    }

    // 지우기 요청이면 여기서 끝
    if (p.action === 'delete') {
      doc.saveAndClose();
      if (key) props.deleteProperty(key);
      return json_({ ok: true, url: url, deleted: at !== null });
    }

    // 그 자리(없으면 끝)에 새 내용을 쓰고 이름표를 붙인다
    const made = writeMemo_(body, p, at);
    if (rangeName) {
      const rb = doc.newRange();
      made.forEach(el => rb.addElement(el));
      doc.addNamedRange(rangeName, rb.build());
    }
    doc.saveAndClose();
    if (key) props.setProperty(key, String(Date.now()));
    return json_({ ok: true, url: url, replaced: at !== null, legacy: legacy });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 드라이브 백업 ----------
   bkAudio   {id, mime, data(base64)}  녹음 하나 저장 (같은 id 가 이미 있으면 건너뜀)
   bkMemos   {data(JSON 문자열)}        메모 전체를 새 파일로 저장하고 최근 KEEP_BACKUPS 개만 남김
   bkRestore                            가장 최근 메모 전체 백업을 돌려줌
   bkAudioGet {id}                      녹음 하나를 base64 로 돌려줌
   bkDelete  {ids}                      지운 메모의 녹음을 휴지통으로 (30일 안에는 드라이브에서 되살릴 수 있음)
   bkInfo                               백업 현황 */
function backup_(p) {
  try {
    const folder = folder_();
    if (p.action === 'bkAudio') {
      if (!p.id || !p.data) throw new Error('녹음 내용이 비었습니다');
      if (audioFile_(folder, p.id)) return json_({ ok: true, skipped: true });
      const mime = String(p.mime || 'audio/webm').split(';')[0];
      folder.createFile(Utilities.newBlob(Utilities.base64Decode(p.data), mime, 'audio_' + p.id + '.' + ext_(mime)));
      return json_({ ok: true });
    }
    if (p.action === 'bkMemos') {
      if (!p.data) throw new Error('메모 내용이 비었습니다');
      const name = 'memos_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss') + '.json';
      folder.createFile(name, p.data, 'application/json');
      memoFiles_(folder).slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
      return json_({ ok: true, name: name });
    }
    if (p.action === 'bkRestore') {
      const f = memoFiles_(folder)[0];
      if (!f) return json_({ ok: false, error: '드라이브에 백업이 아직 없습니다' });
      return json_({ ok: true, name: f.getName(), data: f.getBlob().getDataAsString() });
    }
    if (p.action === 'bkAudioGet') {
      const f = audioFile_(folder, p.id);
      if (!f) return json_({ ok: false, error: '드라이브에 그 녹음이 없습니다' });
      const b = f.getBlob();
      return json_({ ok: true, mime: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) });
    }
    if (p.action === 'bkDelete') {
      let n = 0;
      (p.ids || []).forEach(id => { const f = audioFile_(folder, id); if (f) { f.setTrashed(true); n++; } });
      return json_({ ok: true, deleted: n });
    }
    if (p.action === 'bkInfo') {
      let audio = 0;
      const it = folder.searchFiles('title contains "audio_" and trashed = false');
      while (it.hasNext()) { it.next(); audio++; }
      const f = memoFiles_(folder)[0];
      return json_({ ok: true, audio: audio, latest: f ? f.getName() : '', url: folder.getUrl() });
    }
    throw new Error('모르는 백업 요청입니다: ' + p.action);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* 백업 폴더: 저장된 ID → 내 드라이브에서 이름으로 → 새로 만들기 */
function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('bk_folder');
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* 지워졌으면 아래에서 */ }
  }
  const found = DriveApp.getRootFolder().getFoldersByName(BACKUP_FOLDER);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(BACKUP_FOLDER);
  props.setProperty('bk_folder', folder.getId());
  return folder;
}

/* 메모 전체 백업 파일들, 최신 것부터 (이름에 날짜·시각이 들어 있어 이름순 = 시간순) */
function memoFiles_(folder) {
  const out = [], it = folder.searchFiles('title contains "memos_" and trashed = false');
  while (it.hasNext()) out.push(it.next());
  return out.sort((a, b) => b.getName() < a.getName() ? -1 : 1);
}

/* 녹음 파일 찾기. "audio_m123." 처럼 점까지 붙여 찾아야 m123_1 같은 조각 파일과 헷갈리지 않는다 */
function audioFile_(folder, id) {
  const it = folder.searchFiles('title contains "audio_' + String(id).replace(/[^\w-]/g, '') + '." and trashed = false');
  return it.hasNext() ? it.next() : null;
}

function ext_(mime) {
  return ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' })[mime] || 'webm';
}

/* ---------- 내부 ---------- */

/* 메모 한 건을 body의 at 번째 자리에(at이 null이면 끝에) 쓰고, 만들어진 최상위 요소들을 돌려준다 */
function writeMemo_(body, p, at) {
  const H = DocumentApp.ParagraphHeading;
  const made = [];
  let i = at;
  const par = t => { const el = i === null ? body.appendParagraph(t) : body.insertParagraph(i++, t); made.push(el); return el; };
  const li  = t => { const el = i === null ? body.appendListItem(t) : body.insertListItem(i++, t); made.push(el); return el; };
  const hr  = () => { const h = i === null ? body.appendHorizontalRule() : body.insertHorizontalRule(i++); made.push(h.getParent()); };
  const section = t => par(t).setHeading(H.HEADING4);
  const list = (t, items) => { if (!items || !items.length) return; section(t); items.forEach(x => li(String(x)).setGlyphType(DocumentApp.GlyphType.BULLET)); };

  par(p.title || '제목 없음').setHeading(H.HEADING2);
  par(metaLine_(p)).setHeading(H.NORMAL).editAsText().setItalic(true).setForegroundColor('#888888');
  if (p.tags && p.tags.length) par(p.tags.map(t => '#' + t).join('  ')).setHeading(H.NORMAL).editAsText().setForegroundColor('#888888');

  section('내가 한 말');
  par(p.transcript || '').setHeading(H.NORMAL);
  list('핵심', p.points);
  list('살릴 점 (AI)', p.good);
  list('비어 있는 곳 (AI)', p.weak);
  list('생각해볼 질문 (AI)', p.questions);
  list('덧붙인 방향 (AI)', p.extend);
  if (p.draft) { section('초안 (AI)'); par(p.draft).setHeading(H.NORMAL).editAsText().setItalic(true); }
  par('').setHeading(H.NORMAL);
  hr();
  return made;
}

function metaLine_(p) {
  return [p.category, p.created, p.kind === 'voice' ? '녹음' : '글', p.model].filter(Boolean).join('  ·  ');
}

/* 이름표가 가리키는 요소들을 문서에서 지우고, 첫 요소가 있던 자리 번호를 돌려준다 */
function removeRange_(doc, body, named) {
  const idx = [];
  named.getRange().getRangeElements().forEach(re => {
    const k = topIndex_(body, re.getElement());
    if (k >= 0 && idx.indexOf(k) < 0) idx.push(k);
  });
  try { named.remove(); } catch (e) {}
  if (!idx.length) return null;
  idx.sort((a, b) => a - b);
  removeChildren_(body, idx);
  return idx[0];
}

/* 이름표가 없는 예전 항목 찾기: "제목(H2) 줄" 바로 다음에 "이 메모의 날짜가 든 줄"이 오는 곳부터, 다음 구분선까지 */
function removeLegacy_(doc, body, p) {
  if (!p.created) return null;
  const tagged = taggedIndexes_(doc, body);     // 이름표 붙은 자리는 후보에서 뺀다
  const n = body.getNumChildren();
  for (let i = 0; i < n - 1; i++) {
    if (tagged[i]) continue;
    const el = body.getChild(i);
    if (el.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    if (el.asParagraph().getHeading() !== DocumentApp.ParagraphHeading.HEADING2) continue;
    const next = body.getChild(i + 1);
    if (next.getType() !== DocumentApp.ElementType.PARAGRAPH) continue;
    const meta = next.asParagraph().getText();
    if (meta.indexOf(p.created) < 0) continue;
    if (p.kind && meta.indexOf(p.kind === 'voice' ? '녹음' : '글') < 0) continue;
    // 구분선(HR)이 든 문단까지가 이 항목
    let end = i + 1;
    for (let j = i + 1; j < n; j++) {
      const c = body.getChild(j);
      if (c.getType() === DocumentApp.ElementType.PARAGRAPH && c.asParagraph().findElement(DocumentApp.ElementType.HORIZONTAL_RULE)) { end = j; break; }
      if (j > i + 1 && c.getType() === DocumentApp.ElementType.PARAGRAPH && c.asParagraph().getHeading() === DocumentApp.ParagraphHeading.HEADING2) { end = j - 1; break; }
      end = j;
    }
    const idx = []; for (let k = i; k <= end; k++) idx.push(k);
    removeChildren_(body, idx);
    return i;
  }
  return null;
}

function taggedIndexes_(doc, body) {
  const map = {};
  doc.getNamedRanges().forEach(nr => {
    if (nr.getName().indexOf('nuema_') !== 0) return;
    nr.getRange().getRangeElements().forEach(re => { const k = topIndex_(body, re.getElement()); if (k >= 0) map[k] = true; });
  });
  return map;
}

function topIndex_(body, el) {
  while (el && el.getParent() && el.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) el = el.getParent();
  if (!el) return -1;
  try { return body.getChildIndex(el); } catch (e) { return -1; }
}

/* 자리 번호 목록의 요소들을 뒤에서부터 지운다 (문서 맨 끝 문단은 지울 수 없으므로 빈 문단을 하나 붙여 둔다) */
function removeChildren_(body, idx) {
  if (idx[idx.length - 1] >= body.getNumChildren() - 1) body.appendParagraph('');
  for (let n = idx.length - 1; n >= 0; n--) {
    try { body.removeChild(body.getChild(idx[n])); } catch (e) {}
  }
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
