// CSRF 보호 — Double Submit Cookie 패턴
//
// refresh 토큰을 HttpOnly 쿠키로 보내므로, 쿠키 기반 요청(/api/auth/refresh, logout)은
// CSRF 에 노출된다. 이를 막기 위해:
//  - 로그인 시 비-HttpOnly CSRF 쿠키(tp_csrf)를 함께 내려준다(JS 가 읽을 수 있음).
//  - 보호 대상 요청은 X-CSRF-Token 헤더에 그 값을 실어 보내야 한다.
//  - 서버는 쿠키값 == 헤더값 인지 비교(상수시간)한다. 동일하면 통과.
// (access 토큰만 쓰는 Bearer API 는 쿠키를 안 쓰므로 CSRF 무관)
const crypto = require('crypto');
const config = require('./config');
const { HttpError } = require('./middleware/auth');

function newToken() {
    return crypto.randomBytes(32).toString('hex');
}

// 로그인 응답에서 CSRF 쿠키를 심는다 (HttpOnly 아님: 프론트가 읽어 헤더로 재전송)
function setCsrfCookie(res, token) {
    res.cookie(config.cookie.csrfName, token, {
        httpOnly: false,
        secure: config.isProd,
        sameSite: config.isProd ? 'strict' : 'lax',
        path: '/',
    });
}

function clearCsrfCookie(res) {
    res.clearCookie(config.cookie.csrfName, { path: '/' });
}

function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

// 쿠키 기반 라우트에 붙이는 미들웨어
function requireCsrf(req, res, next) {
    const cookieToken = req.cookies ? req.cookies[config.cookie.csrfName] : null;
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || !constantTimeEqual(cookieToken, headerToken)) {
        return next(new HttpError(403, 'CSRF 검증 실패', 'CSRF_FAILED'));
    }
    next();
}

module.exports = { newToken, setCsrfCookie, clearCsrfCookie, requireCsrf };
