# 누에마 메모

떠오른 생각을 말로 남기면 Gemini가 받아쓰고 정리해 주는 아이디어 메모.
단일 HTML 파일이며, 데이터는 브라우저(localStorage / IndexedDB)에만 저장됩니다.

- 열기: https://shanghun099-web.github.io/nuema-memo/
- 설정에서 Gemini API 키를 입력해야 정리 기능이 동작합니다. 키는 이 기기 브라우저에만 저장됩니다.
- 폰에서 "홈 화면에 추가"하면 앱처럼 쓸 수 있습니다.

## 구글 독스 자동 업로드

정리된 메모를 구글 독스 문서 하나에 차례로 쌓을 수 있습니다.
[google-docs-sync.gs](google-docs-sync.gs) 파일 맨 위의 설치 순서대로 Apps Script를 한 번 배포하고,
나온 웹앱 URL을 앱 설정 → 구글 독스에 붙여넣으면 됩니다.
