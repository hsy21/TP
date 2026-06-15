# security — 재사용 가능한 Express 인증/보안 모듈

JWT + RTR(Refresh Token Rotation) + Grace Period 기반의 인증 레이어. 다른 Express 웹
프로젝트에 **폴더째 복사**해서 쓸 수 있도록 설계되었다.

## 제공 기능

- **JWT 인증**: access(짧은 수명, `Authorization: Bearer`) + refresh(긴 수명, HttpOnly 쿠키)
- **RTR + Grace Period**: refresh 토큰 회전, 동시요청 흡수(grace), **재사용 공격 탐지 시 패밀리 전체 폐기**
- **비밀번호 해싱**: bcrypt (+ 레거시 평문 비번 자동 마이그레이션 훅)
- **CSRF**: double-submit 쿠키
- **계정 보안 정책**: 로그인 실패 잠금 + IP rate limit (Redis)
- **CORS/보안 헤더**: helmet + 화이트리스트 CORS
- **Global Exception** + 데이터 유효성 검증(express-validator)

## 의존성

```
npm install jsonwebtoken bcryptjs ioredis helmet cookie-parser express-validator dotenv express
```

Redis 필요 (RTR 저장소/잠금/rate limit). 로컬은 Docker 권장:

```
docker run -d -p 6379:6379 redis:7-alpine
```

## 사용법

```js
const express = require('express');
const security = require('./security');   // 이 폴더

const app = express();

security.installSecurity(app);            // helmet + CORS + cookie-parser + Redis 연결
app.use(express.json());

// users 테이블(id, username, password, role)을 가진 DB 핸들을 주입
app.use('/api/auth', security.createAuthRouter(db));

// 보호 라우트 예시
app.get('/api/me', security.auth.requireAuth, (req, res) => res.json(req.user));
app.get('/api/admin', security.auth.requireAuth, security.auth.requireRole('admin'), handler);

security.installErrorHandling(app);       // 404 + 표준 에러 핸들러 (모든 라우트 뒤)
app.listen(3000);
```

### 다른 프로젝트로 이식할 때
- `createAuthRouter(db)` 는 `db.get/db.run` (sqlite3 시그니처)를 기대한다. 다른 DB라면
  `routes/auth.js` 의 `getAsync/runAsync` 와 쿼리만 교체하면 된다.
- `users` 테이블에 `id, username, password, role` 컬럼이 있어야 한다.
- 환경변수는 `.env.example` 참고. 운영에서 `NODE_ENV=production` 이면 약한 시크릿은 부팅을 막는다.

## 엔드포인트

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/api/auth/signup` | - | 가입 + 세션 발급 |
| POST | `/api/auth/login` | - | 로그인 + 세션 발급 (실패 잠금/rate limit) |
| POST | `/api/auth/refresh` | refresh 쿠키 + CSRF | access 재발급 + 토큰 회전 |
| POST | `/api/auth/logout` | refresh 쿠키 + CSRF | 세션 폐기 |
| GET | `/api/auth/me` | Bearer | 현재 사용자 |

## 클라이언트 흐름

1. login/signup → 응답의 `accessToken`(+`csrfToken`) 보관, refresh 는 쿠키로 자동 저장.
2. 보호 API 호출: `Authorization: Bearer <accessToken>`.
3. access 만료(401) → `POST /api/auth/refresh` (헤더 `X-CSRF-Token: <csrfToken>`) → 새 accessToken.
4. logout → `POST /api/auth/logout` (헤더 `X-CSRF-Token`).

---

## 보안 점검 — 알려진 취약점 / 주의사항

> 최종 점검일: 2026-06-08. ⬜ = 미수정. 심각도순.
>
> ⚠️ **중요:** 이 모듈(`security/`)은 인증/암호화 인프라만 제공한다. 실제 자원
> API(예: `server/server.js` 의 `/api/community` 등)에 `requireAuth` 를 붙이고
> 신원을 토큰에서 끌어내는 것은 **호스트 앱의 책임**이다. 아래 Critical 항목이
> 그 누락을 지적한다 — 모듈을 도입한 것만으로 끝이 아니다.

### 🔴 Critical — 인증/인가가 자원 API에 미적용

- ⬜ **권한 상승 (admin 위조)** — `server/server.js:454` `DELETE /api/community/:id`
  가 `req.body.user_role` 을 신뢰. `{"user_role":"admin"}` 만 보내면 토큰 없이
  남의 데이터를 삭제 가능.
- ⬜ **IDOR / 신원 위조** — `/api/community`(:375), `/api/community/review`(:478),
  `/api/accessibility/review`(:669), `/api/qna`(:731, :769), `/api/my_plan` 등이
  클라이언트가 보낸 `user_id` 를 그대로 사용. 타인 명의 작성·비공개 일정 열람 가능.
- **대응:** 자원 라우트에 `security.auth.requireAuth` 적용하고, `user_id`/`user_role`
  을 요청 본문이 아니라 **`req.user`(검증된 access 토큰)** 에서 도출. 프론트는
  `Authorization: Bearer <accessToken>` 헤더로 호출하도록 전환.

### 🟠 High

- ⬜ **저장형 XSS (Stored XSS)** — 사용자 입력(후기/제목/설명/QnA)이 DB 저장 후
  `innerHTML` 로 렌더됨: `web/script.js:1797`(`${r.review}`, `${r.username}`),
  `:1787`(`${item.name}`), `:2230`(`${post.username}`) 외 다수. 후기에
  `<img src=x onerror=...>` 저장 시 모든 열람자에서 실행 → localStorage 의
  accessToken 탈취 가능(refresh 는 HttpOnly 라 안전).
- **대응:** `textContent` 사용 또는 출력 이스케이프 + 아래 CSP 활성화.

### 🟡 Medium

- ⬜ **CSP 비활성화** — `security/middleware/security-headers.js:13`
  `contentSecurityPolicy: false`. XSS 2차 방어선 부재. 인라인 스크립트 정리 후 활성화.
- ⬜ **accessToken 을 localStorage 저장** — `web/script.js`. XSS 와 결합 시 탈취 위험.
- ⬜ **계정 잠금 DoS** — `security/accountPolicy.js`. username 단독 키라 공격자가
  피해자 아이디로 일부러 실패시켜 정상 사용자를 잠글 수 있음. IP+username 조합 고려.
- ⬜ **개발용 JWT 시크릿 하드코딩** — `security/config.js:13`. `NODE_ENV=production`
  없이 배포하면 공개된 기본 시크릿으로 토큰 위조 가능(가드는 production 에서만 동작).

### 🟢 Low

- ⬜ **`trust proxy` 미설정** — `security/middleware/rate-limit.js:9` 의 IP 추정이
  `X-Forwarded-For` 기반이라 프록시 뒤에서 스푸핑/오탐 가능. `app.set('trust proxy', ...)` 필요.
- ⬜ **입력 검증 부재** — `/api/community/share` 등이 클라이언트 `lat/lng/id` 무검증 저장(데이터 무결성).
- ℹ️ **Redis 장애 시 fail-open** — 잠금/rate-limit 이 무력화됨(가용성 우선의 의도된 설계, 운영 시 인지 필요).
