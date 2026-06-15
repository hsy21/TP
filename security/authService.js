const config = require('./config');
const jwt = require('./jwt');
const tokenStore = require('./tokenStore');
const csrf = require('./csrf');
const { HttpError } = require('./middleware/auth');

function setRefreshCookie(res, token) {
    res.cookie(config.cookie.refreshName, token, {
        ...config.cookie.baseOptions,
        maxAge: config.jwt.refreshTtlSec * 1000,
    });
}

function clearRefreshCookie(res) {
    res.clearCookie(config.cookie.refreshName, { path: config.cookie.baseOptions.path });
}

function claims(user) {
    return { sub: String(user.id), username: user.username, role: user.role };
}

async function issueSession(res, user) {
    const family = tokenStore.newFamily();
    const refresh = jwt.signRefresh(claims(user));       
    await tokenStore.registerNew(refresh.jti, String(user.id), family);

    const access = jwt.signAccess(claims(user));
    const csrfToken = csrf.newToken();

    setRefreshCookie(res, refresh.token);
    csrf.setCsrfCookie(res, csrfToken);

    return {
        accessToken: access.token,
        expiresAt: access.expiresAt,
        expiresInSec: access.expiresInSec,
        csrfToken,
        user: { id: user.id, username: user.username, role: user.role },
    };
}

async function rotateSession(req, res) {
    const cookieToken = req.cookies ? req.cookies[config.cookie.refreshName] : null;
    if (!cookieToken) throw new HttpError(401, 'refresh 토큰이 없습니다.', 'NO_REFRESH');

    let decoded;
    try {
        decoded = jwt.verifyRefresh(cookieToken);
    } catch (err) {
        clearRefreshCookie(res);
        const expired = err.name === 'TokenExpiredError';
        throw new HttpError(401, expired ? 'refresh 토큰이 만료되었습니다.' : '유효하지 않은 refresh 토큰입니다.',
            expired ? 'REFRESH_EXPIRED' : 'INVALID_REFRESH');
    }

    const outcome = await tokenStore.useAndRotate(decoded.jti);

    if (outcome.result === tokenStore.RESULT.INVALID) {
        clearRefreshCookie(res);
        throw new HttpError(401, '세션을 찾을 수 없습니다. 다시 로그인하세요.', 'SESSION_NOT_FOUND');
    }
    if (outcome.result === tokenStore.RESULT.REUSE) {
        clearRefreshCookie(res);
        throw new HttpError(401, '보안상 세션이 종료되었습니다. 다시 로그인하세요.', 'TOKEN_REUSE');
    }

    const payload = { sub: decoded.sub, username: decoded.username, role: decoded.role };
    const newRefresh = jwt.signRefresh(payload, outcome.nextJti);   
    const newAccess = jwt.signAccess(payload);

    setRefreshCookie(res, newRefresh.token);

    return {
        accessToken: newAccess.token,
        expiresAt: newAccess.expiresAt,
        expiresInSec: newAccess.expiresInSec,
        rotated: outcome.result === tokenStore.RESULT.ROTATE,   
    };
}

async function endSession(req, res) {
    const cookieToken = req.cookies ? req.cookies[config.cookie.refreshName] : null;
    if (cookieToken) {
        try {
            const decoded = jwt.verifyRefresh(cookieToken);
            await tokenStore.revokeJti(decoded.jti);
        } catch { /* 이미 무효면 무시 */ }
    }
    clearRefreshCookie(res);
    csrf.clearCsrfCookie(res);
}

module.exports = { issueSession, rotateSession, endSession, setRefreshCookie, clearRefreshCookie };
