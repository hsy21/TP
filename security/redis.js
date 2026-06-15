// Redis 클라이언트 (ioredis)
// RTR refresh 토큰 보관, Grace Period, 계정 잠금 카운터 등에 사용한다.
// 연결 실패가 곧바로 프로세스 종료로 이어지지 않도록 lazyConnect + 재시도 전략을 쓴다.
const Redis = require('ioredis');
const config = require('./config');

const client = new Redis(config.redis.url, {
    keyPrefix: config.redis.keyPrefix,
    lazyConnect: true,              // 첫 사용 시 연결
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy(times) {
        // 지수 백오프, 최대 3초
        return Math.min(times * 200, 3000);
    },
});

let connected = false;

client.on('ready', () => {
    connected = true;
    console.log('[redis] 연결됨:', config.redis.url);
});
client.on('end', () => { connected = false; });
client.on('error', (err) => {
    // 폭주 방지: 핵심 메시지만 1회성으로 가볍게 로깅
    if (connected) console.error('[redis] 오류:', err.message);
});

// 명시적 연결 시도. 실패해도 throw 하지 않고 false 반환(서버는 계속 뜬다).
async function connect() {
    try {
        if (client.status === 'wait') await client.connect();
        return true;
    } catch (err) {
        console.error('[redis] 연결 실패 — Redis 서버를 확인하세요:', err.message);
        return false;
    }
}

function isConnected() {
    return client.status === 'ready';
}

module.exports = { client, connect, isConnected };
