// Global Exception 핸들러 — 모든 라우트의 에러를 한 곳에서 표준 JSON 으로 응답
// 라우트에서 next(err) 로 넘기거나, async 핸들러는 asyncHandler 로 감싼다.
const config = require('./../config');

// async 라우트의 reject 를 자동으로 next(err) 로 전달
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 404 (라우트 미매칭) — 에러 핸들러 직전에 등록
function notFound(req, res, next) {
    const err = new Error(`경로를 찾을 수 없습니다: ${req.method} ${req.path}`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    next(err);
}

// 최종 에러 핸들러 (인자 4개여야 Express 가 에러 핸들러로 인식)
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');

    if (status >= 500) {
        console.error('[error]', req.method, req.path, '-', err.stack || err.message);
    }

    const body = {
        success: false,
        error: { code, message: err.message || '서버 오류가 발생했습니다.' },
    };
    // 운영에서는 내부 5xx 메시지를 숨긴다(정보 노출 방지)
    if (config.isProd && status >= 500) {
        body.error.message = '서버 오류가 발생했습니다.';
    }
    if (!config.isProd && err.stack) body.error.stack = err.stack;

    res.status(status).json(body);
}

module.exports = { asyncHandler, notFound, errorHandler };
