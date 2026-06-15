// JWT 유틸 — access/refresh 토큰 발급·검증 및 만료 시간 계산
// access: 짧은 수명, Authorization: Bearer 헤더로 전달
// refresh: 긴 수명, HttpOnly 쿠키로 전달, RTR 대상 (Phase 2)
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

const { jwt: J } = config;

// 토큰 식별자(JTI) — RTR 회전/폐기/Grace Period 추적의 키가 된다.
function newJti() {
    return crypto.randomUUID();
}

// 만료 시간 계산: 현재 기준 ttlSec 초 뒤의 epoch(초)와 ISO 문자열을 반환.
function computeExpiry(ttlSec, nowMs = Date.now()) {
    const nowSec = Math.floor(nowMs / 1000);
    const expSec = nowSec + ttlSec;
    return { iat: nowSec, exp: expSec, expiresAt: new Date(expSec * 1000).toISOString() };
}

function signAccess(payload) {
    const { iat, exp, expiresAt } = computeExpiry(J.accessTtlSec);
    const token = jwt.sign(
        { ...payload, type: 'access', iat, exp },
        J.accessSecret,
        { issuer: J.issuer, audience: J.audience }
    );
    return { token, expiresAt, expiresInSec: J.accessTtlSec };
}

// refresh 발급. jti 를 호출측에 돌려줘 Redis 저장소에 회전 상태를 기록하게 한다.
function signRefresh(payload, jti = newJti()) {
    const { iat, exp, expiresAt } = computeExpiry(J.refreshTtlSec);
    const token = jwt.sign(
        { ...payload, type: 'refresh', jti, iat, exp },
        J.refreshSecret,
        { issuer: J.issuer, audience: J.audience }
    );
    return { token, jti, expiresAt, expiresInSec: J.refreshTtlSec };
}

// 서명/만료/발급자 검증. 실패 시 throw (호출측에서 401 처리).
function verifyAccess(token) {
    const decoded = jwt.verify(token, J.accessSecret, { issuer: J.issuer, audience: J.audience });
    if (decoded.type !== 'access') throw new Error('토큰 타입이 access 가 아닙니다.');
    return decoded;
}

function verifyRefresh(token) {
    const decoded = jwt.verify(token, J.refreshSecret, { issuer: J.issuer, audience: J.audience });
    if (decoded.type !== 'refresh') throw new Error('토큰 타입이 refresh 가 아닙니다.');
    return decoded;
}

module.exports = {
    newJti,
    computeExpiry,
    signAccess,
    signRefresh,
    verifyAccess,
    verifyRefresh,
};
