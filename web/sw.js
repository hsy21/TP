// 캐시 버전을 올리면 activate 시 옛 캐시가 삭제됩니다. (수정 후 반드시 버전 증가)
const CACHE_NAME = 'travelplan-v4';
const urlsToCache = [
  '/',
  '/index.html',
  '/my_routes.html',
  '/style.css',
  '/script.js',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames.map(name => (name !== CACHE_NAME ? caches.delete(name) : null))
      ))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선(Network-first) 전략:
//  - 온라인이면 항상 최신 파일을 받아오고 캐시도 갱신한다(개발 중 변경 즉시 반영).
//  - 네트워크 실패(오프라인) 시에만 캐시로 폴백한다(NFC-03 오프라인 조회 지원).
self.addEventListener('fetch', event => {
  const req = event.request;
  // GET 이외(POST 등 API 쓰기)는 서비스워커가 개입하지 않음
  if (req.method !== 'GET') return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // 동일 출처의 정상 응답만 캐시에 저장
        if (res && res.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
