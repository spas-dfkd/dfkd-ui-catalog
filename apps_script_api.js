/**
 * DFKD UI 카탈로그 — JSON API 전용
 *
 * GitHub Pages에서 호스팅하는 프론트엔드가 이 API를 호출합니다.
 *
 * 엔드포인트:
 *   GET  ?api=all        → 카테고리 + UI목록 + 상태관리 전체 반환
 *   POST                 → 상태 업데이트
 */

var CACHE_TTL = 300; // 5분

// ────────────────────────────────────────
// GET: JSON API
// ────────────────────────────────────────
function doGet(e) {
  var api = e && e.parameter && e.parameter.api;

  // CORS 헤더가 필요하지만 Apps Script는 직접 설정 불가
  // → fetch 시 mode: 'cors'가 아닌 기본값 사용, 응답은 redirect로 처리됨

  if (api === 'all') {
    return serveAll();
  }

  // 기본: 안내 메시지
  return ContentService.createTextOutput(JSON.stringify({
    error: 'api 파라미터가 필요합니다. 예: ?api=all'
  })).setMimeType(ContentService.MimeType.JSON);
}

function serveAll() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('api_all');

  if (cached) {
    return ContentService.createTextOutput(cached)
      .setMimeType(ContentService.MimeType.JSON);
  }

  var categories = sheetToObjects('카테고리');
  var entries = sheetToObjects('UI목록');
  var statuses = sheetToObjects('상태관리');

  var result = JSON.stringify({
    categories: categories,
    entries: entries,
    statuses: statuses
  });

  // 전체 응답 캐싱
  try {
    cache.put('api_all', result, CACHE_TTL);
  } catch (e) {
    // 100KB 초과 시 캐시 생략
  }

  return ContentService.createTextOutput(result)
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────
// Sheets 데이터 읽기
// ────────────────────────────────────────
function sheetToObjects(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    result.push(row);
  }

  return result;
}

// ────────────────────────────────────────
// POST: 상태 업데이트 + 이미지 업로드
// ────────────────────────────────────────
var SCREENSHOT_FOLDER_NAME = 'DFKD-UI-Screenshots';

function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // 이미지 업로드 액션
  if (data.action === 'uploadImage') {
    return handleImageUpload(data);
  }

  // 기존 상태 업데이트
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('상태관리');

  if (!data['UI이름']) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'UI이름 필수' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var values = sheet.getRange('A:A').getValues();
  var rowIdx = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === data['UI이름']) {
      rowIdx = i + 1;
      break;
    }
  }

  if (rowIdx === -1) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: '항목 없음: ' + data['UI이름'] }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (data['상태'] !== undefined) sheet.getRange(rowIdx, 4).setValue(data['상태']);
  if (data['담당자'] !== undefined) sheet.getRange(rowIdx, 5).setValue(data['담당자']);
  if (data['메모'] !== undefined) sheet.getRange(rowIdx, 6).setValue(data['메모']);
  if (data['수정안URL'] !== undefined) sheet.getRange(rowIdx, 7).setValue(data['수정안URL']);
  if (data['스크린샷URL'] !== undefined) sheet.getRange(rowIdx, 10).setValue(data['스크린샷URL']);

  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
  sheet.getRange(rowIdx, 8).setValue(today);

  // 캐시 무효화
  CacheService.getScriptCache().remove('api_all');

  return ContentService.createTextOutput(JSON.stringify({ ok: true, 'UI이름': data['UI이름'] }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ────────────────────────────────────────
// 이미지 업로드 → Drive 저장 → 시트 반영
// ────────────────────────────────────────
function handleImageUpload(data) {
  try {
    if (!data['UI이름'] || !data.imageData) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'UI이름과 imageData 필수' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Drive 폴더 찾기 또는 생성
    var folder = getOrCreateFolder(SCREENSHOT_FOLDER_NAME);

    // 파일명 생성: UIType_날짜시간.png
    var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss');
    var ext = (data.mimeType || 'image/png').split('/')[1] || 'png';
    var fileName = data['UI이름'] + '_' + now + '.' + ext;

    // base64 → Blob → Drive 파일 생성
    var decoded = Utilities.base64Decode(data.imageData);
    var blob = Utilities.newBlob(decoded, data.mimeType || 'image/png', fileName);
    var file = folder.createFile(blob);

    // 누구나 볼 수 있도록 공유 설정
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var driveUrl = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    // 시트에 스크린샷 URL 자동 반영
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('상태관리');
    var values = sheet.getRange('A:A').getValues();
    for (var i = 1; i < values.length; i++) {
      if (values[i][0] === data['UI이름']) {
        var rowIdx = i + 1;
        sheet.getRange(rowIdx, 10).setValue(driveUrl); // 스크린샷URL 컬럼
        var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
        sheet.getRange(rowIdx, 8).setValue(today); // 수정일
        break;
      }
    }

    // 캐시 무효화
    CacheService.getScriptCache().remove('api_all');

    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      driveUrl: driveUrl,
      fileId: file.getId(),
      fileName: fileName
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.message || String(err)
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}
