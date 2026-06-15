# TravelPlan 시스템 구성도

> 무장애(배리어프리) 여행 일정 공유 웹앱. 작성일 기준 코드 기반 구성도.

## 1. 전체 구성 (Mermaid)

```mermaid
flowchart TB
    subgraph Client["🌐 클라이언트 (브라우저 / PWA)"]
        UI["web/index.html · script.js · style.css"]
        SW["sw.js (Service Worker) · manifest.json"]
        LS["localStorage<br/>accessToken · csrfToken · currentUser"]
        LEAF["Leaflet 지도 (루트/미니맵/미리보기)"]
    end

    subgraph Server["🖥️ Node.js / Express (server/server.js)  :8000"]
        STATIC["정적 파일 서빙 (web/)"]
        subgraph Security["🔐 security/ (재사용 보안 모듈)"]
            MW["installSecurity<br/>helmet · CORS화이트리스트 · cookie-parser"]
            AUTH["/api/auth 라우터<br/>login·signup·refresh·logout·me"]
            GUARD["미들웨어<br/>requireAuth(Bearer) · CSRF · rateLimit · validate"]
            ERR["Global Exception 핸들러"]
            LIB["jwt · password(bcrypt) · tokenStore(RTR/Grace) · accountPolicy"]
        end
        subgraph Domain["📦 도메인 API"]
            COM["/api/community (피드·공유·리뷰)"]
            REC["/api/community/:id/recommended-places<br/>similar · access-breakdown"]
            PLC["/api/places · /api/search · /api/my_plan"]
            ACC["/api/accessibility/* (장소 후기·별점)"]
            QNA["/api/qna (질문·제보)"]
        end
    end

    subgraph Data["🗄️ 데이터 저장소"]
        SQLITE[("SQLite (travel.db)<br/>users·places·community_plans<br/>plan_reviews·accessibility_reviews·qna")]
        REDIS[("Redis (Docker)<br/>refresh 토큰(RTR)·rate limit·계정 잠금")]
    end

    subgraph Ext["☁️ 외부 서비스"]
        PHOTON["Photon/Komoot<br/>장소 검색·지오코딩"]
        OVERPASS["Overpass API (OSM)<br/>루트 주변 POI 추천"]
        OSRM["OSRM<br/>경로 탐색"]
        DUMMY["dummyjson<br/>리뷰/평점 (목업)"]
        TILES["OSM 타일<br/>지도 배경"]
    end

    UI -- "Bearer 헤더 + 쿠키(refresh/CSRF)" --> MW
    MW --> AUTH
    MW --> GUARD
    GUARD --> Domain
    AUTH --> LIB
    GUARD --> LIB
    Domain --> ERR

    AUTH --> SQLITE
    Domain --> SQLITE
    LIB --> REDIS

    PLC -. 서버경유 .-> PHOTON
    REC -. 서버경유 .-> OVERPASS
    LEAF -. 직접 .-> OSRM
    LEAF -. 직접 .-> TILES
    UI -. 직접 .-> DUMMY

    SW -. 캐시 .-> UI
```

## 2. 인증/보안 흐름 (RTR + Grace Period)

```mermaid
sequenceDiagram
    participant C as 클라이언트
    participant A as /api/auth
    participant R as Redis
    participant D as SQLite

    C->>A: POST /login (id/pw)
    A->>D: 사용자 조회 + bcrypt 검증<br/>(레거시 평문→해시 자동 마이그레이션)
    A->>R: refresh jti 저장(패밀리)
    A-->>C: accessToken(Bearer) + refresh(HttpOnly 쿠키) + CSRF 쿠키

    C->>A: 보호 API (Authorization: Bearer)
    Note over A: requireAuth 토큰 검증

    C->>A: POST /refresh (쿠키 + X-CSRF-Token)
    A->>R: jti 회전(rotate)
    alt 정상
        A-->>C: 새 accessToken + 회전된 refresh
    else Grace 내 재시도
        A-->>C: 후속 토큰 재발급
    else 탈취(재사용) 감지
        A->>R: 패밀리 전체 폐기
        A-->>C: 401 재로그인
    end
```

## 3. 계층 요약

| 계층 | 구성요소 | 역할 |
|---|---|---|
| **클라이언트** | `web/` (PWA, Leaflet, localStorage) | UI, 지도/미리보기, 토큰 보관 |
| **보안** | `security/` (JWT·RTR·bcrypt·CSRF·rateLimit·helmet) | 인증·인가·보호 (다른 프로젝트 재사용 가능) |
| **도메인 API** | `server/server.js` | 커뮤니티/일정/장소/접근성/QnA |
| **저장소** | SQLite, Redis(Docker) | 영속 데이터 / 토큰·잠금·레이트리밋 |
| **외부** | Photon·Overpass·OSRM·dummyjson·OSM타일 | 검색·POI추천·경로·리뷰·지도 |

## 4. 핵심 데이터 흐름

- **장소 검색**: 클라 → `/api/search` → Photon → 결과 반환
- **루트 주변 추천**: 클라 → `/api/community/:id/recommended-places` → Overpass(OSM, 캐시+미러) → 거리/카테고리 정리 → 클라가 평점·태그 적용
- **이동 지수(접근성 점수)**: `access-breakdown`이 장소별 접근성 후기(태그+턱/경사/폭 수치)와 도보 구간을 합산해 `100 − Σ감점` 산출 (카드/모달/추천 동일 규칙)
- **비슷한 동선**: 공통 장소(Jaccard) 유사도로 추천, 클릭 시 미니맵 미리보기
