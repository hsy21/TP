// 보안 모듈 진입점(배럴)
// server.js 는 여기서 installSecurity / installErrorHandling 만 가져다 쓰면 된다.
const config = require('./config');
const redis = require('./redis');
const password = require('./password');
const jwt = require('./jwt');
const cookieParser = require('cookie-parser');

const { securityHeaders, corsMiddleware } = require('./middleware/security-headers');
const auth = require('./middleware/auth');
const { asyncHandler, notFound, errorHandler } = require('./middleware/error-handler');
const validate = require('./middleware/validate');
const tokenStore = require('./tokenStore');
const authService = require('./authService');
const csrf = require('./csrf');
const accountPolicy = require('./accountPolicy');
const { rateLimit } = require('./middleware/rate-limit');
const createAuthRouter = require('./routes/auth');

// 요청 파이프라인 "앞단"에 붙이는 보안 미들웨어 묶음.
// app.use(express.json()) 등 본문 파서보다 먼저/같이 호출한다.
function installSecurity(app) {
    app.use(securityHeaders());
    app.use(corsMiddleware());
    app.use(cookieParser());
    // 시작 시 Redis 연결 시도 (실패해도 서버는 계속 동작)
    redis.connect();
}

// 모든 라우트 등록 "뒤"에 붙이는 404 + Global Exception 핸들러.
function installErrorHandling(app) {
    app.use(notFound);
    app.use(errorHandler);
}

module.exports = {
    config,
    redis,
    password,
    jwt,
    auth,
    validate,
    asyncHandler,
    tokenStore,
    authService,
    csrf,
    accountPolicy,
    rateLimit,
    createAuthRouter,
    installSecurity,
    installErrorHandling,
};
