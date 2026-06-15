// RTR(Refresh Token Rotation) + Grace Period 저장소 (Redis 기반)
//
// 설계:
//  - refresh 토큰마다 고유 jti 를 부여하고 Redis 에 상태 레코드를 둔다.
//  - 같은 로그인에서 파생된 토큰들은 하나의 "패밀리(family)"로 묶는다.
//  - 토큰을 쓰면(refresh) 즉시 회전(rotate): 옛 토큰은 'rotated' 로 표시하고 새 토큰을 발급.
//  - Grace Period: 회전 직후 graceUntil 까지는 옛 토큰 재사용을 "정상 재시도"로 보고
//    이미 발급한 후속(successor) 토큰을 다시 내준다. (동시요청/네트워크 재시도 흡수)
//  - 재사용 공격 탐지: graceUntil 이후에 옛(rotated) 토큰이 다시 오면 탈취로 간주,
//    해당 패밀리 전체를 폐기(revoke)한다.
const crypto = require('crypto');
const { client } = require('./redis');
const config = require('./config');

const RT_TTL = config.jwt.refreshTtlSec;
const GRACE = config.jwt.graceTtlSec;

const rtKey = (jti) => `rt:${jti}`;
const famKey = (family) => `fam:${family}`;

function newFamily() {
    return crypto.randomUUID();
}

// 로그인 시: 새 패밀리에 첫 refresh 레코드를 등록한다.
async function registerNew(jti, userId, family) {
    const rec = { jti, userId, family, status: 'active', rotatedTo: null, graceUntil: 0 };
    const pipe = client.pipeline();
    pipe.set(rtKey(jti), JSON.stringify(rec), 'EX', RT_TTL);
    pipe.sadd(famKey(family), jti);
    pipe.expire(famKey(family), RT_TTL);
    await pipe.exec();
    return rec;
}

async function getRecord(jti) {
    const raw = await client.get(rtKey(jti));
    return raw ? JSON.parse(raw) : null;
}

// 패밀리 전체 폐기 (재사용 공격 탐지 시)
async function revokeFamily(family) {
    const jtis = await client.smembers(famKey(family));
    const pipe = client.pipeline();
    for (const j of jtis) pipe.del(rtKey(j));
    pipe.del(famKey(family));
    await pipe.exec();
    return jtis.length;
}

// 단일 토큰 폐기 (로그아웃)
async function revokeJti(jti) {
    const rec = await getRecord(jti);
    if (!rec) return false;
    await client.del(rtKey(jti));
    await client.srem(famKey(rec.family), jti);
    return true;
}

// 회전 결과 종류
const RESULT = {
    ROTATE: 'rotate',     // 정상 회전 → newJti 로 새 토큰 발급하라
    GRACE: 'grace',       // Grace 내 재시도 → rotatedTo(기존 후속)로 토큰 재발급하라
    REUSE: 'reuse',       // 재사용 공격 → 패밀리 폐기됨, 거부하라
    INVALID: 'invalid',   // 레코드 없음(만료/폐기) → 거부하라
};

// refresh 토큰 사용 시도를 평가하고 상태를 전이시킨다.
// 반환: { result, userId?, family?, nextJti? }
//  - ROTATE: nextJti(=호출측이 새로 만든 jti)로 active 레코드 생성됨
//  - GRACE : nextJti(=기존 rotatedTo)로 재발급. 새 레코드 생성 안 함.
async function useAndRotate(jti, nowMs = Date.now()) {
    const rec = await getRecord(jti);
    if (!rec) return { result: RESULT.INVALID };

    if (rec.status === 'active') {
        const nextJti = crypto.randomUUID();
        const now = Math.floor(nowMs / 1000);
        // 옛 레코드: rotated 로 전이, 후속 jti 와 grace 마감시각 기록
        const rotated = { ...rec, status: 'rotated', rotatedTo: nextJti, graceUntil: now + GRACE };
        const next = { jti: nextJti, userId: rec.userId, family: rec.family, status: 'active', rotatedTo: null, graceUntil: 0 };
        const pipe = client.pipeline();
        pipe.set(rtKey(jti), JSON.stringify(rotated), 'EX', RT_TTL);          // 재사용 탐지 위해 만료까지 유지
        pipe.set(rtKey(nextJti), JSON.stringify(next), 'EX', RT_TTL);
        pipe.sadd(famKey(rec.family), nextJti);
        pipe.expire(famKey(rec.family), RT_TTL);
        await pipe.exec();
        return { result: RESULT.ROTATE, userId: rec.userId, family: rec.family, nextJti };
    }

    if (rec.status === 'rotated') {
        const now = Math.floor(nowMs / 1000);
        if (now <= rec.graceUntil) {
            // Grace 내 재시도: 후속 토큰을 다시 내준다 (jti 동일, 토큰 문자열만 재서명)
            return { result: RESULT.GRACE, userId: rec.userId, family: rec.family, nextJti: rec.rotatedTo };
        }
        // Grace 이후 옛 토큰 재등장 → 탈취로 간주, 패밀리 전체 폐기
        await revokeFamily(rec.family);
        return { result: RESULT.REUSE, family: rec.family };
    }

    return { result: RESULT.INVALID };
}

module.exports = {
    RESULT,
    newFamily,
    registerNew,
    getRecord,
    useAndRotate,
    revokeJti,
    revokeFamily,
};
