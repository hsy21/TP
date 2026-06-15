// Rate limiting 미들웨어 (Redis 고정 윈도우, IP 기준)
// 로그인/회원가입/refresh 같은 인증 엔드포인트 남용을 완화한다.
// Redis 장애 시 fail-open(차단하지 않음).
const { client, isConnected } = require('../redis');
const { HttpError } = require('./auth');

// req 의 클라이언트 IP 추정 (프록시 뒤라면 app.set('trust proxy', ...) 필요)
function clientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket.remoteAddress || 'unknown';
}

// rateLimit({ windowSec, max, prefix })
function rateLimit({ windowSec = 60, max = 30, prefix = 'rl' } = {}) {
    return async function (req, res, next) {
        try {
            if (!isConnected()) return next();
            const key = `${prefix}:${clientIp(req)}`;
            const count = await client.incr(key);
            if (count === 1) await client.expire(key, windowSec);
            if (count > max) {
                const ttl = await client.ttl(key);
                res.set('Retry-After', String(ttl > 0 ? ttl : windowSec));
                return next(new HttpError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 'RATE_LIMITED'));
            }
            next();
        } catch {
            next(); // 한도 계산 실패는 통과(fail-open)
        }
    };
}

module.exports = { rateLimit };
