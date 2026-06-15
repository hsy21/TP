// 데이터 유효성 검증 헬퍼 (express-validator)
// 라우트마다 검증 규칙 배열을 붙이고, 마지막에 runValidation 으로 결과를 모은다.
const { body, validationResult } = require('express-validator');
const config = require('./../config');
const { HttpError } = require('./auth');

// 검증 결과 수집 → 실패 시 400 으로 표준화하여 global exception 핸들러로 전달
function runValidation(req, res, next) {
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const err = new HttpError(400, '입력값이 유효하지 않습니다.', 'VALIDATION_ERROR');
    err.details = result.array().map(e => ({ field: e.path, message: e.msg }));
    next(err);
}

// 자주 쓰는 규칙 모음
const rules = {
    username: body('username')
        .trim()
        .isLength({ min: 3, max: 32 }).withMessage('아이디는 3~32자여야 합니다.')
        .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('아이디는 영문/숫자/._- 만 허용됩니다.'),

    // 회원가입용: 강도(최소 길이) 검증
    password: body('password')
        .isString()
        .isLength({ min: config.account.minPasswordLength })
        .withMessage(`비밀번호는 최소 ${config.account.minPasswordLength}자 이상이어야 합니다.`),

    // 로그인용: 존재 여부만 검증(레거시 비번 호환 — 강도 검사 금지)
    passwordPresent: body('password')
        .isString().bail()
        .notEmpty().withMessage('비밀번호를 입력하세요.'),
};

module.exports = { body, runValidation, rules };
