# Tasks

## Phase 0 — 데이터 준비 (선행)
- [ ] T01. DOCS의 hwpx 9개를 평문 텍스트로 추출 (`data/source/*.txt`)
- [ ] T02. 경전별 메타 정의 (id, 한글명, 빠알리명, 약어) → `data/sutta_meta.json`
- [ ] T03. **분해 스키마 확정** — 페이지/문장/단어/음절/어근 JSON 구조 1개 합의 후 샘플 1경전(자애경 등 짧은 것) 작성
- [ ] T04. 사용자 검토 → 스키마 OK 시 나머지 8경전 일괄 분해 (`data/sutta/<id>.json`)
- [ ] T05. 페이지 분할 알고리즘 — 문장 길이 기반 고정 분량 분할, 페이지 ID 부여 (`<sutta-id>-p<3자리>`)
- [ ] T06. 분해 결과 검증 스크립트 — 누락 단어/문장 0건 확인

## Phase 1 — 앱 골격
- [ ] T10. 프로젝트 구조 (`index.html`, `app.css`, `app.js`, `data/`, `vendor/` 없음)
- [ ] T11. 모바일 뷰포트 + 폰트 가변 CSS (clamp 기반)
- [ ] T12. 경전 목록 화면 → 경전 선택 → 첫 페이지 진입
- [ ] T13. 페이지 렌더러 — JSON 1페이지 → DOM (음절/단어/어근/독해)
- [ ] T14. 좌/우 스와이프 + 버튼 페이지 이동
- [ ] T15. 페이지 진입 시 URL 해시에 page_id 동기화 (`#M10-p015`)

## Phase 2 — 학습 기능
- [ ] T20. 단어 탭 → 분해 패널 펼침/접힘
- [ ] T21. 환경설정 화면 (모달 또는 별도 페이지)
- [ ] T22. 반복 노출 카운터 — 문법 N회, 단어/숙어 N회 (localStorage 누적)
- [ ] T23. N회 초과 시 분해/주석 자동 생략 렌더링 (본문은 항상 노출)
- [ ] T24. 독해 가림 토글 — 문장 단위 / 페이지 단위 모드
- [ ] T25. 환경설정 변경 즉시 현재 페이지 재렌더

## Phase 3 — 메모 + GitHub
- [ ] T30. GitHub 레포 생성 + Pages 호스팅 활성화
- [ ] T31. 사용자 PAT(Personal Access Token) 입력 화면 (localStorage 저장)
- [ ] T32. 페이지별 메모 입력 UI (페이지 하단 또는 슬라이드업)
- [ ] T33. 메모 저장 = GitHub Contents API로 `memos/<page_id>.json` commit
- [ ] T34. 메모 불러오기 = 같은 경로에서 fetch
- [ ] T35. 페이지 진입 시 해당 페이지 메모 자동 로드

## Phase 4 — 일괄 수정 사이클
- [ ] T40. 메모 JSON에 `status`, `proposal(diff)`, `approvals[]` 필드 추가
- [ ] T41. PR 감지 — 앱이 GitHub API로 열린 PR 목록 조회 → 메모와 매칭
- [ ] T42. 원본 / 수정안 좌우 비교 UI
- [ ] T43. 승인/보류/재요청 버튼 → 각각의 GitHub 액션 (PR 머지 / 라벨 / 코멘트)
- [ ] T44. 승인 시 `approvals.json`에 `{date, page_id, commit_hash}` append
- [ ] T45. 승인 이력 화면 (날짜별 조회)

## Phase 5 — 검증/배포
- [ ] T50. 9개 경전 전부 페이지 넘김 누락 없는지 자동 점검
- [ ] T51. 모바일 실기기 테스트 (iOS Safari, Android Chrome)
- [ ] T52. GitHub Pages 배포 + 첫 정식 URL 확보
- [ ] T53. README + 사용법 문서

## 백로그 (MVP 후)
- 음절 발음 오디오 (TTS)
- 학습 진도/통계 대시보드
- 다중 사용자 (현재는 단일 사용자 기준)
- 오프라인 PWA 지원
