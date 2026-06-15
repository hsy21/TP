// 보안 헤더(helmet) + CORS 설정
// 기존의 무제한 app.use(cors()) 를 화이트리스트 기반으로 교체한다.
const helmet = require('helmet');
const cors = require('cors');
const config = require('./../config');

// helmet: 기본 보안 헤더 일괄 적용. 정적 프론트(web/)를 같이 서빙하므로
// CSP 는 우선 완화 모드로 두고 Phase 후반에 출처를 좁힌다.
function securityHeaders() {
    return helmet({
        contentSecurityPolicy: false,        // 프론트 인라인 스크립트 충돌 방지(추후 강화)
        crossOriginEmbedderPolicy: false,
    });
}

// CORS: 화이트리스트 출처만 허용, 자격증명(쿠키) 허용
function corsMiddleware() {
    return cors({
        origin(origin, cb) {
            // 동일 출처/서버-서버(origin 없음) 요청 허용
            if (!origin) return cb(null, true);
            if (config.cors.origins.includes(origin)) return cb(null, true);
            cb(new Error(`CORS 차단: 허용되지 않은 출처(${origin})`));
        },
        credentials: true,                   // refresh 쿠키/CSRF 전송 허용
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
        exposedHeaders: ['X-CSRF-Token'],
    });
}

module.exports = { securityHeaders, corsMiddleware };
