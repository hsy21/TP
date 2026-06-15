// 보안 설정 중앙 집중 모듈
// 시크릿/TTL/쿠키 옵션을 한 곳에서 관리한다. 운영 환경에서는 .env 로 주입한다.
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// 시크릿: 운영에서는 반드시 .env 로 강한 랜덤 값을 주입한다.
// 개발 편의를 위해 미설정 시 기본값을 쓰되, 운영에서는 예외로 막는다.
function requireSecret(name, devFallback) {
    const v = process.env[name];
    if (v && v.length >= 16) return v;
    if (isProd) {
        throw new Error(`[security] 환경변수 ${name} 가 설정되지 않았거나 너무 짧습니다(최소 16자).`);
    }
    return devFallback;
}

// 사람이 읽는 기간 표기를 초 단위로 변환 (예: '15m', '7d', '30s', '2h')
function toSeconds(str) {
    if (typeof str === 'number') return str;
    const m = String(str).trim().match(/^(\d+)\s*([smhd])$/);
    if (!m) throw new Error(`[security] 잘못된 기간 형식: ${str}`);
    const n = parseInt(m[1], 10);
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
    return n * unit;
}

const config = {
    isProd,

    jwt: {
        accessSecret: requireSecret('JWT_ACCESS_SECRET', 'dev-access-secret-change-me-0001'),
        refreshSecret: requireSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me-002'),
        issuer: process.env.JWT_ISSUER || 'travelplan',
        audience: process.env.JWT_AUDIENCE || 'travelplan-web',
        // 만료 시간(초). access 는 짧게, refresh 는 길게.
        accessTtlSec: toSeconds(process.env.ACCESS_TTL || '15m'),
        refreshTtlSec: toSeconds(process.env.REFRESH_TTL || '7d'),
        // RTR Grace Period: 회전 직후 구버전 refresh 를 잠시 허용해 동시요청/네트워크 재시도 충돌을 흡수.
        graceTtlSec: toSeconds(process.env.GRACE_TTL || '30s'),
    },

    password: {
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    },

    account: {
        // 계정 보안 정책 (Phase 3 에서 사용)
        maxFailedAttempts: parseInt(process.env.MAX_FAILED_ATTEMPTS || '5', 10),
        lockDurationSec: toSeconds(process.env.LOCK_DURATION || '15m'),
        minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10),
    },

    redis: {
        url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        keyPrefix: process.env.REDIS_PREFIX || 'tp:',
    },

    cors: {
        // 허용 출처: 콤마 구분. 미설정 시 개발 기본값.
        origins: (process.env.CORS_ORIGINS || 'http://localhost:8000,http://127.0.0.1:8000')
            .split(',').map(s => s.trim()).filter(Boolean),
    },

    cookie: {
        // refresh 토큰을 담는 HttpOnly 쿠키 옵션 (Phase 2 에서 사용)
        refreshName: 'tp_rt',
        csrfName: 'tp_csrf',
        baseOptions: {
            httpOnly: true,
            secure: isProd,             // 운영(HTTPS)에서만 secure
            sameSite: isProd ? 'strict' : 'lax',
            path: '/api/auth',          // refresh 엔드포인트로 전송 범위 제한
        },
    },

    toSeconds,
};

module.exports = config;
