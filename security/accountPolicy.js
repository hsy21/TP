// 계정 보안 정책 — 로그인 실패 횟수 기반 잠금(brute-force 완화)
// Redis 카운터를 사용한다. Redis 장애 시에는 "fail-open"(잠그지 않음)으로 동작해
// 저장소 문제로 정상 사용자가 전부 잠기는 사태를 피한다.
const { client, isConnected } = require('./redis');
const config = require('./config');

const { maxFailedAttempts, lockDurationSec } = config.account;

const failKey = (id) => `fail:${id}`;
const lockKey = (id) => `lock:${id}`;

// 식별자 정규화(대소문자 무시) — username 기준
function norm(id) {
    return String(id || '').trim().toLowerCase();
}

// 현재 잠금 상태 확인. 반환: { locked, retryAfterSec }
async function checkLock(identifier) {
    if (!isConnected()) return { locked: false, retryAfterSec: 0 };
    const id = norm(identifier);
    const ttl = await client.ttl(lockKey(id));
    return ttl > 0 ? { locked: true, retryAfterSec: ttl } : { locked: false, retryAfterSec: 0 };
}

// 로그인 실패 기록. 임계치 도달 시 계정을 잠근다.
// 반환: { locked, attempts, remaining, retryAfterSec }
async function recordFailure(identifier) {
    if (!isConnected()) return { locked: false, attempts: 0, remaining: maxFailedAttempts, retryAfterSec: 0 };
    const id = norm(identifier);
    const attempts = await client.incr(failKey(id));
    if (attempts === 1) {
        // 첫 실패에 카운터 만료시간 설정(슬라이딩 윈도우 아님: 고정 윈도우)
        await client.expire(failKey(id), lockDurationSec);
    }
    if (attempts >= maxFailedAttempts) {
        await client.set(lockKey(id), '1', 'EX', lockDurationSec);
        return { locked: true, attempts, remaining: 0, retryAfterSec: lockDurationSec };
    }
    return { locked: false, attempts, remaining: maxFailedAttempts - attempts, retryAfterSec: 0 };
}

// 로그인 성공 시 실패 카운터/잠금 해제
async function clearFailures(identifier) {
    if (!isConnected()) return;
    const id = norm(identifier);
    await client.del(failKey(id), lockKey(id));
}

module.exports = { checkLock, recordFailure, clearFailures };
