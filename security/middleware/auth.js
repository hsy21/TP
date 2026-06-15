// 인증 미들웨어 — Authorization: Bearer <access_token> 검증
// 성공 시 req.user 에 토큰 페이로드를 실어 다음 핸들러로 넘긴다.
const { verifyAccess } = require('../jwt');

// HTTP 에러를 표준화하기 위한 헬퍼 (global exception 핸들러가 status 를 읽는다)
class HttpError extends Error {
    constructor(status, message, code) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function extractBearer(req) {
    const h = req.headers['authorization'] || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].trim() : null;
}

// 필수 인증: 토큰 없거나 무효면 401
function requireAuth(req, res, next) {
    const token = extractBearer(req);
    if (!token) return next(new HttpError(401, '인증 토큰이 필요합니다.', 'NO_TOKEN'));
    try {
        req.user = verifyAccess(token);
        next();
    } catch (err) {
        const expired = err.name === 'TokenExpiredError';
        next(new HttpError(401, expired ? '토큰이 만료되었습니다.' : '유효하지 않은 토큰입니다.',
            expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'));
    }
}

// 선택 인증: 토큰이 있으면 검증해 req.user 설정, 없거나 무효여도 통과
function optionalAuth(req, res, next) {
    const token = extractBearer(req);
    if (!token) return next();
    try { req.user = verifyAccess(token); } catch { /* 무시 */ }
    next();
}

// 역할 기반 접근 제어
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) return next(new HttpError(401, '인증이 필요합니다.', 'NO_TOKEN'));
        if (!roles.includes(req.user.role)) {
            return next(new HttpError(403, '권한이 없습니다.', 'FORBIDDEN'));
        }
        next();
    };
}

module.exports = { requireAuth, optionalAuth, requireRole, extractBearer, HttpError };
