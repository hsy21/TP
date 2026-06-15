// 비밀번호 해싱 모듈 (bcryptjs)
// 평문 비밀번호는 절대 저장하지 않는다. 해시는 솔트가 내장된 bcrypt 문자열($2a$...).
const bcrypt = require('bcryptjs');
const config = require('./config');

async function hash(plain) {
    if (typeof plain !== 'string' || plain.length === 0) {
        throw new Error('[password] 해싱할 비밀번호가 비어 있습니다.');
    }
    return bcrypt.hash(plain, config.password.bcryptRounds);
}

// 평문과 저장된 해시 비교. 해시가 손상/평문이어도 throw 대신 false 반환.
async function verify(plain, hashed) {
    if (typeof plain !== 'string' || typeof hashed !== 'string') return false;
    try {
        return await bcrypt.compare(plain, hashed);
    } catch {
        return false;
    }
}

// 기존 평문 비번 마이그레이션 판별용: 이미 bcrypt 해시인지 확인.
function isHashed(value) {
    return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

module.exports = { hash, verify, isHashed };
