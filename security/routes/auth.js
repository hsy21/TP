// 인증 라우터 — /api/auth/{login, refresh, logout, me, signup}
// db(sqlite3) 를 주입받는 팩토리. server.js 에서 app.use('/api/auth', createAuthRouter(db)).
const express = require('express');
const password = require('../password');
const authService = require('../authService');
const { asyncHandler } = require('../middleware/error-handler');
const { requireAuth, HttpError } = require('../middleware/auth');
const { requireCsrf } = require('../csrf');
const { runValidation, rules } = require('../middleware/validate');
const { rateLimit } = require('../middleware/rate-limit');
const accountPolicy = require('../accountPolicy');

// 인증 엔드포인트 rate limit (IP 기준)
const authLimiter = rateLimit({ windowSec: 60, max: 20, prefix: 'rl:auth' });

// sqlite3 콜백 → Promise 헬퍼
const getAsync = (db, sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const runAsync = (db, sql, params) => new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); }));

module.exports = function createAuthRouter(db) {
    const router = express.Router();

    // 로그인: rate limit → 계정 잠금 확인 → 비번 검증(+평문→해시 마이그레이션) → 세션 발급
    router.post('/login',
        authLimiter,
        rules.username, rules.passwordPresent, runValidation,
        asyncHandler(async (req, res) => {
            const { username, plain } = { username: req.body.username, plain: req.body.password };

            // 계정 잠금 상태면 즉시 차단(자격증명 확인조차 안 함)
            const lock = await accountPolicy.checkLock(username);
            if (lock.locked) {
                res.set('Retry-After', String(lock.retryAfterSec));
                throw new HttpError(429,
                    `로그인 시도가 많아 계정이 잠겼습니다. ${lock.retryAfterSec}초 후 다시 시도하세요.`, 'ACCOUNT_LOCKED');
            }

            const user = await getAsync(db, 'SELECT * FROM users WHERE username = ?', [username]);

            let ok = false;
            if (user) {
                if (password.isHashed(user.password)) {
                    ok = await password.verify(plain, user.password);
                } else {
                    // 레거시 평문 비번: 일치하면 즉시 해시로 교체(마이그레이션)
                    ok = user.password === plain;
                    if (ok) {
                        const hashed = await password.hash(plain);
                        await runAsync(db, 'UPDATE users SET password = ? WHERE id = ?', [hashed, user.id]);
                    }
                }
            }

            if (!ok) {
                // 실패 기록(존재하지 않는 계정도 동일하게 카운트 — 계정 존재 여부 노출 방지)
                const fail = await accountPolicy.recordFailure(username);
                const err = new HttpError(401, '아이디 또는 비밀번호가 잘못되었습니다.', 'BAD_CREDENTIALS');
                if (fail.locked) {
                    err.status = 429; err.code = 'ACCOUNT_LOCKED';
                    err.message = `로그인 시도가 많아 계정이 잠겼습니다. ${fail.retryAfterSec}초 후 다시 시도하세요.`;
                    res.set('Retry-After', String(fail.retryAfterSec));
                }
                throw err;
            }

            await accountPolicy.clearFailures(username);     // 성공 시 카운터 초기화
            const session = await authService.issueSession(res, user);
            res.json({ success: true, ...session });
        }));

    // 회원가입: 중복 확인 후 해시 저장, 곧바로 세션 발급
    router.post('/signup',
        authLimiter,
        rules.username, rules.password, runValidation,
        asyncHandler(async (req, res) => {
            const { username } = req.body;
            const plain = req.body.password;
            const exists = await getAsync(db, 'SELECT id FROM users WHERE username = ?', [username]);
            if (exists) throw new HttpError(409, '이미 존재하는 아이디입니다.', 'USERNAME_TAKEN');

            const hashed = await password.hash(plain);
            const result = await runAsync(db,
                'INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashed, 'user']);
            const user = { id: result.lastID, username, role: 'user' };
            const session = await authService.issueSession(res, user);
            res.status(201).json({ success: true, ...session });
        }));

    // access 재발급 + RTR 회전 (쿠키 기반 → CSRF 필요)
    router.post('/refresh', authLimiter, requireCsrf, asyncHandler(async (req, res) => {
        const result = await authService.rotateSession(req, res);
        res.json({ success: true, ...result });
    }));

    // 로그아웃 (쿠키 기반 → CSRF 필요)
    router.post('/logout', requireCsrf, asyncHandler(async (req, res) => {
        await authService.endSession(req, res);
        res.json({ success: true });
    }));

    // 현재 사용자 (Bearer access 필요)
    router.get('/me', requireAuth, (req, res) => {
        res.json({ success: true, user: { id: Number(req.user.sub), username: req.user.username, role: req.user.role } });
    });

    return router;
};
