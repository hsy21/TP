const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const security = require('../security');

const app = express();
const PORT = process.env.PORT || 8000;
const DB_FILE = 'travel.db';

// 보안 미들웨어 (helmet + 화이트리스트 CORS + cookie-parser + Redis 연결)
security.installSecurity(app);
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// DB 초기화
const db = new sqlite3.Database(DB_FILE);

// 보안 인증 라우터 (RTR/Grace Period 기반): /api/auth/{login,signup,refresh,logout,me}
app.use('/api/auth', security.createAuthRouter(db));

function initDB() {
    db.serialize(() => {
        // 사용자 테이블
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            role TEXT DEFAULT 'user'
        )`);

        // 장소 테이블
        db.run(`CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY,
            name TEXT,
            category TEXT,
            address TEXT,
            tags TEXT,
            lat REAL,
            lng REAL
        )`);

        // 내 일정 테이블
        db.run(`CREATE TABLE IF NOT EXISTS my_plan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER,
            stay_time INTEGER,
            memo TEXT,
            transport_mode TEXT,
            user_tags TEXT,
            move_time INTEGER,
            move_cost INTEGER,
            day INTEGER DEFAULT 1,
            photo TEXT
        )`);

        // 커뮤니티 일정 메타 테이블
        db.run(`CREATE TABLE IF NOT EXISTS community_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author TEXT,
            title TEXT,
            description TEXT,
            likes INTEGER,
            author_id INTEGER
        )`, (err) => {
            if (!err) {
                db.run('ALTER TABLE community_plans ADD COLUMN author_id INTEGER', () => {});
                db.run('ALTER TABLE community_plans ADD COLUMN description TEXT', () => {});
                // REQ-COM-01: 공개 범위(전체공개 'public' / 지정 그룹공개 'group')와 그룹명
                db.run("ALTER TABLE community_plans ADD COLUMN visibility TEXT DEFAULT 'public'", () => {});
                db.run('ALTER TABLE community_plans ADD COLUMN group_name TEXT', () => {});
            }
        });

        // 리뷰/평점 테이블
        db.run(`CREATE TABLE IF NOT EXISTS plan_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER,
            user_id INTEGER,
            rating INTEGER,
            review TEXT,
            FOREIGN KEY(plan_id) REFERENCES community_plans(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 배리어프리 전용 커뮤니티 및 소통 테이블 추가
        db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
            user_id INTEGER PRIMARY KEY,
            mobility_type TEXT, -- e.g., 'wheelchair_manual', 'wheelchair_power', 'stroller', 'none'
            visual_impairment BOOLEAN DEFAULT 0,
            hearing_impairment BOOLEAN DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS accessibility_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER,
            user_id INTEGER,
            ramp_angle INTEGER, -- 1-5 scale
            door_step INTEGER,  -- 1-5 scale or cm
            space_width INTEGER, -- 1-5 scale
            photo TEXT,
            comment TEXT,
            FOREIGN KEY(place_id) REFERENCES places(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, (err) => {
            if (!err) {
                // REQ-COM-05: 휠체어/엘리베이터/경사 등 보행 편의성 태그(콤마 구분)와 작성시각
                db.run('ALTER TABLE accessibility_reviews ADD COLUMN access_tags TEXT', () => {});
                db.run('ALTER TABLE accessibility_reviews ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP', () => {});
                db.run('ALTER TABLE accessibility_reviews ADD COLUMN rating INTEGER', () => {}); // 장소 후기에 통합된 별점(1~5)
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS qna_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER,
            user_id INTEGER,
            question TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(place_id) REFERENCES places(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, (err) => {
            if (!err) {
                // REQ-COM-06: 현지 정보 게시판용 보강(지역명/제목/분류)
                db.run('ALTER TABLE qna_posts ADD COLUMN region TEXT', () => {});
                db.run('ALTER TABLE qna_posts ADD COLUMN title TEXT', () => {});
                db.run("ALTER TABLE qna_posts ADD COLUMN category TEXT DEFAULT 'question'", () => {}); // 'question' | 'report'
            }
        });

        // REQ-COM-06: 질문에 대한 실시간 답변/제보
        db.run(`CREATE TABLE IF NOT EXISTS qna_answers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            user_id INTEGER,
            answer TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(post_id) REFERENCES qna_posts(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_follows (
            follower_id INTEGER,
            following_id INTEGER,
            PRIMARY KEY(follower_id, following_id),
            FOREIGN KEY(follower_id) REFERENCES users(id),
            FOREIGN KEY(following_id) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS place_accessibility_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER,
            user_id INTEGER,
            proposed_tags TEXT,
            status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
            FOREIGN KEY(place_id) REFERENCES places(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // 커뮤니티 일정 상세 테이블
        db.run(`CREATE TABLE IF NOT EXISTS community_plan_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER,
            place_id INTEGER,
            stay_time INTEGER,
            memo TEXT,
            transport_mode TEXT,
            user_tags TEXT,
            move_time INTEGER,
            move_cost INTEGER,
            day INTEGER DEFAULT 1,
            photo TEXT,
            FOREIGN KEY(plan_id) REFERENCES community_plans(id)
        )`);

        // 기본 관리자 계정 생성
        db.get('SELECT count(*) as count FROM users', (err, row) => {
            if (row && row.count === 0) {
                db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['admin', '1234', 'admin']);
                db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['testuser', '1234', 'user']);
            }
        });

        // 초기 목업 데이터 삽입
        db.get('SELECT count(*) as count FROM places', (err, row) => {
            if (row && row.count === 0) {
                const stmt = db.prepare('INSERT INTO places VALUES (?,?,?,?,?,?,?)');
                const placesData = [
                    [1, '경복궁', 'attraction', '서울 종로구 사직로 161', 'wheelchair,parking', 37.579617, 126.977041],
                    [2, '남산 서울타워', 'attraction', '서울 용산구 남산공원길 105', 'elevator,wheelchair', 37.551169, 126.988226],
                    [3, '명동교자', 'restaurant', '서울 중구 명동10길 29', 'wheelchair', 37.562544, 126.985612],
                    [4, '신라호텔', 'accommodation', '서울 중구 동호로 249', 'wheelchair,elevator,parking', 37.556214, 127.006325],
                    [5, '광장시장', 'attraction', '서울 종로구 창경궁로 88', '', 37.570221, 126.999518]
                ];
                placesData.forEach(p => stmt.run(p));
                stmt.finalize();

                db.run('INSERT INTO community_plans (author, title, likes, author_id, description) VALUES (?,?,?,?,?)', ['배리어프리여행자', '휠체어로 떠나는 서울 중심부 당일치기', 24, 2, '서울의 중심을 휠체어로 편하게 둘러보는 루트입니다.'], function(err) {
                    if (!err) {
                        const planId = this.lastID;
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 1, 120, '경복궁 관람', 'wheelchair', 'wheelchair', 0, 0, 1, '']);
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 3, 60, '명동교자 식사', 'taxi', 'wheelchair', 15, 8000, 1, '']);
                    }
                });

                db.run('INSERT INTO community_plans (author, title, likes, author_id, description) VALUES (?,?,?,?,?)', ['뚜벅이', '걸어서 만나는 서울 명소', 15, 1, '도보와 대중교통을 이용한 서울 명소 탐방'], function(err) {
                    if (!err) {
                        const planId = this.lastID;
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 5, 90, '광장시장 구경 및 간식', 'walk', '', 0, 0, 1, '']);
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 2, 120, '남산타워 전망대', 'bus', '', 30, 1500, 1, '']);
                    }
                });

                db.run('INSERT INTO community_plans (author, title, likes, author_id, description) VALUES (?,?,?,?,?)', ['호캉스매니아', '도심 속 럭셔리 휴식', 42, 2, '신라호텔에서 즐기는 완벽한 호캉스와 주변 맛집'], function(err) {
                    if (!err) {
                        const planId = this.lastID;
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 4, 1440, '신라호텔 체크인 및 휴식', 'taxi', 'wheelchair,elevator', 0, 0, 1, '']);
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 3, 90, '저녁 식사로 명동교자 방문', 'taxi', 'wheelchair', 20, 9000, 1, '']);
                    }
                });

                db.run('INSERT INTO community_plans (author, title, likes, author_id, description) VALUES (?,?,?,?,?)', ['역사탐방가', '서울의 역사를 찾아서', 8, 1, '아이들과 함께하기 좋은 역사 탐방 루트'], function(err) {
                    if (!err) {
                        const planId = this.lastID;
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 1, 180, '경복궁 구석구석 살펴보기', 'walk', 'stroller', 0, 0, 1, '']);
                        db.run(`INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)`, [planId, 5, 60, '광장시장에서 늦은 점심', 'bus', 'stroller', 25, 1500, 1, '']);
                    }
                });
            }
        });

        // 멱등 시더: 이동 지수 100점 루트(배리어프리 완비). 이미 있으면 건너뜀.
        // 100점 조건: 모든 장소가 모든 접근성 차원(문턱/엘리베이터/폭/경사) 태그를 갖춘
        //   후기를 보유 → 장소 감점 0, 그리고 구간 이동을 지하철로 → 도보 감점 0.
        seedPerfectRoutes();

        // 실제 서울 명소로 만든 자연스러운 커뮤니티 루트들(비슷한 동선 추천 풍부화)
        seedRealisticRoutes();
    });
}

// 실제 서울 명소 기반 커뮤니티 루트 다수 시드 (자가치유: author_id=SEED_MARK 인 것들을 갈아끼움)
function seedRealisticRoutes() {
    const SEED_MARK = 777; // 시드 식별용 author_id

    // 도심 명소들(실좌표). 기존 1~5 와 함께 사용해 동선이 겹치도록.
    const places = [
        [9101, '북촌한옥마을', 'attraction', '서울 종로구 계동길 37', 'wheelchair', 37.582604, 126.983084],
        [9102, '인사동거리', 'attraction', '서울 종로구 인사동길', 'wheelchair,parking', 37.571607, 126.985838],
        [9103, '청계천', 'attraction', '서울 종로구 청계천로', 'wheelchair,ramp', 37.569524, 126.978573],
        [9104, '익선동 한옥거리', 'restaurant', '서울 종로구 익선동', '', 37.573977, 126.990986],
        [9105, '통인시장', 'attraction', '서울 종로구 자하문로15길 18', 'wheelchair', 37.580373, 126.970550],
        [9106, '삼청동길', 'attraction', '서울 종로구 삼청로', '', 37.584512, 126.981128],
        [9107, '창덕궁', 'attraction', '서울 종로구 율곡로 99', 'wheelchair,parking', 37.582604, 126.991700],
        [9108, '동대문디자인플라자(DDP)', 'attraction', '서울 중구 을지로 281', 'wheelchair,elevator,parking', 37.566295, 127.009240],
        [9109, '명동성당', 'attraction', '서울 중구 명동길 74', 'wheelchair', 37.563447, 126.987345],
        [9110, '남대문시장', 'attraction', '서울 중구 남대문시장4길 21', 'wheelchair', 37.559198, 126.977442],
        [9111, '토속촌 삼계탕', 'restaurant', '서울 종로구 자하문로5길 5', 'wheelchair', 37.576493, 126.973739],
        [9112, '광화문광장', 'attraction', '서울 종로구 세종대로 172', 'wheelchair,ramp', 37.572450, 126.976848],
    ];
    const pstmt = db.prepare('INSERT OR IGNORE INTO places VALUES (?,?,?,?,?,?,?)');
    places.forEach(p => pstmt.run(p));
    pstmt.finalize();

    // 자연스러운 닉네임/제목/설명/후기. 기존 장소(1=경복궁,3=명동교자,2=남산,5=광장시장)와 겹치게.
    const routes = [
        { author: '종로토박이', title: '경복궁부터 광장시장까지 종로 한바퀴',
          desc: '주말에 부모님 모시고 다녀온 코스. 경복궁 보고 인사동 천천히 구경하다가 광장시장에서 빈대떡에 막걸리 한잔했어요.',
          items: [1, 9102, 5], reviews: [['user', 5, '동선이 안 겹쳐서 편했어요'], ['admin', 4, '광장시장은 사람 진짜 많네요ㅎㅎ']] },
        { author: '뚜벅이여행', title: '서촌·북촌 골목 산책',
          desc: '한옥 골목 천천히 걷기 좋음. 통인시장 기름떡볶이 꼭 드세요.',
          items: [9105, 1, 9101, 9106], reviews: [['user', 5, '사진 맛집 천지입니다']] },
        { author: '미식가K', title: '명동 칼국수 먹고 남산 야경',
          desc: '명동교자에서 칼국수랑 만두 먹고 케이블카 타고 남산 올라가 야경 봤어요. 저녁 추천.',
          items: [3, 9109, 2], reviews: [['admin', 4, '케이블카 줄이 좀 길어요'], ['user', 5, '야경 최고']] },
        { author: '주말나들이', title: '고궁 두 곳 천천히 보기',
          desc: '경복궁이랑 창덕궁 후원까지. 다리는 좀 아픈데 그만한 값어치 합니다.',
          items: [1, 9107, 9102], reviews: [['user', 4, '후원 해설 예약 필수예요']] },
        { author: '식도락러', title: '광장시장 먹킷리스트 정주행',
          desc: '마약김밥, 육회, 빈대떡 순서로. 줄 짧은 집 위주로 돌았어요.',
          items: [5, 9104], reviews: [['admin', 5, '육회골목 강추']] },
        { author: '연남러버', title: '익선동 한옥카페 데이트',
          desc: '익선동 골목 카페 돌고 인사동까지 걸었어요. 비 오는 날 분위기 좋음.',
          items: [9104, 9102, 5], reviews: [['user', 4, '주말엔 웨이팅 각오하세요']] },
        { author: '효도여행', title: '부모님과 도심 고궁 나들이',
          desc: '수문장 교대식 보고 광화문광장 분수에서 좀 쉬다가 북촌 구경.',
          items: [9112, 1, 9101], reviews: [['user', 5, '어르신들 좋아하셨어요']] },
        { author: '가성비트래블', title: '남대문·명동 쇼핑데이',
          desc: '남대문시장 호떡 먹고 명동에서 화장품 쇼핑. 환전은 명동이 환율 좋아요.',
          items: [9110, 3, 9109], reviews: [['admin', 4, '평일 낮이 한산해서 좋네요']] },
        { author: '서울밤산책', title: '청계천 따라 동대문 DDP까지',
          desc: '청계천 산책로 걷다가 DDP 야경 보는 코스. 여름밤에 시원합니다.',
          items: [9103, 9108, 5], reviews: [['user', 5, '밤에 조명 예뻐요']] },
        { author: '한복스타그램', title: '한복 입고 고궁 투어',
          desc: '한복 빌려서 경복궁-북촌-삼청동 돌면 인생샷 건집니다. 신발 편한 거 신으세요.',
          items: [1, 9101, 9106, 9102], reviews: [['user', 5, '한복 입으면 입장 무료!'], ['admin', 5, '코스 알차요']] },
        { author: '혼밥러', title: '혼자서 종로 당일치기',
          desc: '토속촌 삼계탕으로 든든하게 시작, 경복궁 산책하고 인사동 책방 구경하고 마무리.',
          items: [9111, 1, 9102], reviews: [['user', 4, '혼자 다니기 딱 좋아요']] },
        { author: '맛집헌터', title: '명동교자 본점 점심 코스',
          desc: '명동교자 본점에서 점심 먹고 명동성당 구경, 남산까지 걸어 올라갔어요.',
          items: [3, 9109, 2], reviews: [['admin', 4, '본점은 역시 다르네요']] },
    ];

    // 자가치유: 기존 시드 루트 + 자식(items/reviews) 삭제 후 재삽입
    db.all('SELECT id FROM community_plans WHERE author_id = ?', [SEED_MARK], (e, rows) => {
        if (e) return;
        (rows || []).forEach(r => {
            db.run('DELETE FROM community_plan_items WHERE plan_id = ?', [r.id]);
            db.run('DELETE FROM plan_reviews WHERE plan_id = ?', [r.id]);
        });
        db.run('DELETE FROM community_plans WHERE author_id = ?', [SEED_MARK], () => {
            const transports = ['walk', 'subway', 'bus', 'walk', 'taxi'];
            routes.forEach((rt, ri) => {
                const likes = 5 + ((ri * 7) % 40);
                db.run('INSERT INTO community_plans (author, title, description, likes, author_id, visibility) VALUES (?,?,?,?,?,?)',
                    [rt.author, rt.title, rt.desc, likes, SEED_MARK, 'public'], function (e2) {
                        if (e2) return;
                        const planId = this.lastID;
                        rt.items.forEach((placeId, idx) => {
                            const tm = idx === 0 ? '' : transports[idx % transports.length];
                            db.run('INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)',
                                [planId, placeId, 60 + idx * 20, '', tm, '', idx === 0 ? 0 : 15, 0, 1, '']);
                        });
                        (rt.reviews || []).forEach(([uname, rating, text]) => {
                            const uid = uname === 'admin' ? 1 : 2;
                            db.run('INSERT INTO plan_reviews (plan_id, user_id, rating, review) VALUES (?,?,?,?)', [planId, uid, rating, text]);
                        });
                    });
            });
        });
    });
}

// 100점짜리 배리어프리 루트 시드 (자가치유형: 시드 루트를 항상 올바른 상태로 재생성)
function seedPerfectRoutes() {
    // 모든 차원을 충족하는 태그 집합(접근성 100점)
    const FULL = 'no_step,flat,elevator,wheelchair,ramp,accessible_toilet,parking';
    const places = [
        [9001, '국립중앙박물관', 'attraction', '서울 용산구 서빙고로 137', 'wheelchair,elevator,parking', 37.523978, 126.980470],
        [9002, '서울식물원', 'attraction', '서울 강서구 마곡동로 161', 'wheelchair,elevator,ramp', 37.569660, 126.835410],
        [9003, '스타필드 코엑스몰', 'attraction', '서울 강남구 영동대로 513', 'wheelchair,elevator,parking', 37.512710, 127.058870],
        [9004, '롯데월드몰', 'attraction', '서울 송파구 올림픽로 300', 'wheelchair,elevator,parking', 37.513310, 127.104250],
    ];
    // 장소: 멱등 삽입
    const pstmt = db.prepare('INSERT OR IGNORE INTO places VALUES (?,?,?,?,?,?,?)');
    places.forEach(p => pstmt.run(p));
    pstmt.finalize();

    // 접근성 후기: 시드 장소에 후기가 없을 때만 1건씩 추가(중복 방지)
    places.forEach(p => {
        db.get('SELECT COUNT(*) c FROM accessibility_reviews WHERE place_id = ?', [p[0]], (e, row) => {
            if (!e && row && row.c === 0) {
                db.run('INSERT INTO accessibility_reviews (place_id, user_id, access_tags, ramp_angle, door_step, space_width, comment) VALUES (?,?,?,?,?,?,?)',
                    [p[0], 1, FULL, 5, 5, 5, '배리어프리 시설 완비 확인']);
            }
        });
    });

    // 100점 루트 — 전 구간 지하철 이동(순서와 무관하게 도보 감점 0)
    const perfectPlans = [
        { author: '배리어프리여행자', title: '♿ 완벽 무장애 서울 박물관 코스', likes: 51, author_id: 2,
          desc: '엘리베이터·경사로·휠체어 통행이 모두 확인된 100점 무장애 루트입니다.', items: [9001, 9002] },
        { author: '무장애로드', title: '♿ 휠체어로 즐기는 서울 쇼핑 100점 루트', likes: 38, author_id: 2,
          desc: '전 구간 지하철 연결 + 배리어프리 시설 완비. 이동 지수 100점.', items: [9003, 9004] },
    ];
    // 자가치유: 기존 시드 루트(+items)를 먼저 모두 삭제한 뒤, 삭제가 끝나면 새로 삽입
    const titles = perfectPlans.map(p => p.title);
    const ph = titles.map(() => '?').join(',');
    db.all(`SELECT id FROM community_plans WHERE title IN (${ph})`, titles, (e, rows) => {
        if (e) return;
        (rows || []).forEach(r => db.run('DELETE FROM community_plan_items WHERE plan_id = ?', [r.id]));
        db.run(`DELETE FROM community_plans WHERE title IN (${ph})`, titles, () => {
            perfectPlans.forEach(pl => {
                db.run('INSERT INTO community_plans (author, title, description, likes, author_id, visibility) VALUES (?,?,?,?,?,?)',
                    [pl.author, pl.title, pl.desc, pl.likes, pl.author_id, 'public'], function (e2) {
                        if (e2) return;
                        const planId = this.lastID;
                        pl.items.forEach((placeId, idx) => {
                            db.run('INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo) VALUES (?,?,?,?,?,?,?,?,?,?)',
                                [planId, placeId, 120, '', 'subway', 'wheelchair', idx === 0 ? 0 : 20, idx === 0 ? 0 : 1400, 1, '']);
                        });
                    });
            });
        });
    });
}

initDB();

// API 엔드포인트
app.get('/api/search', async (req, res) => {
    try {
        const { q } = req.query;
        const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=30`);
        
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Failed to fetch from Geocoder', status: response.status, text: await response.text() });
        }
        
        const data = await response.json();
        const mapped = data.features.map(f => {
            const props = f.properties;
            const coords = f.geometry.coordinates;
            const name = props.name || '';
            const addressParts = [props.country, props.state, props.city, props.district, props.street, props.housenumber].filter(Boolean);
            const address = addressParts.join(' ') || name;

            return {
                place_id: props.osm_id,
                lat: String(coords[1]),
                lon: String(coords[0]),
                display_name: name ? `${name}, ${address}` : address,
                class: props.osm_key,
                type: props.osm_value,
                name: name
            };
        });

        // Deduplication logic
        function getDistance(lat1, lon1, lat2, lon2) {
            const R = 6371; 
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        const deduplicated = [];
        mapped.forEach(item => {
            if (!item.name) return;
            // Ignore minor infrastructure nodes
            if (['entrance', 'door', 'gate', 'ticket', 'toilet', 'parking', 'bus_stop'].includes(item.type)) return;

            let isDuplicate = false;
            for (let i = 0; i < deduplicated.length; i++) {
                const existing = deduplicated[i];
                if (existing.name === item.name) {
                    const dist = getDistance(parseFloat(existing.lat), parseFloat(existing.lon), parseFloat(item.lat), parseFloat(item.lon));
                    if (dist < 0.5) { // within 500m
                        isDuplicate = true;
                        // Replace existing if new item is more representative
                        const importantTypes = ['museum', 'attraction', 'viewpoint', 'theme_park', 'historic', 'palace'];
                        if (importantTypes.includes(item.type) && !importantTypes.includes(existing.type)) {
                            deduplicated[i] = item;
                        }
                        break;
                    }
                }
            }
            if (!isDuplicate) {
                deduplicated.push(item);
            }
        });

        res.json(deduplicated);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 지도 중심 반경(기본 500m) 안의 카테고리별 장소 — 빈 검색 + 카테고리 필터용
//   category=accommodation,attraction,restaurant (콤마 다중 가능). 실제 OSM(Overpass) 사용.
app.get('/api/nearby', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radius = Math.min(3000, Math.max(100, parseInt(req.query.radius) || 500));
    const cats = String(req.query.category || '').split(',').map(s => s.trim()).filter(Boolean);
    if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat/lng 필요' });
    try {
        const pois = await fetchNearbyPOIs(lat, lng, radius);
        const filtered = cats.length ? pois.filter(p => cats.includes(p.category)) : pois;
        // 지도 중심에서 가까운 순으로
        const distKm = (a, b, c, d) => {
            const R = 6371, dLat = (c - a) * Math.PI / 180, dLon = (d - b) * Math.PI / 180;
            const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
        };
        const out = filtered
            .map(p => ({
                place_id: p.id, id: p.id, name: p.name, address: p.address || '',
                lat: p.lat, lng: p.lng, category: p.category,
                tags: p.tags ? p.tags.split(',').filter(Boolean) : [],
                _d: distKm(lat, lng, p.lat, p.lng)
            }))
            .sort((a, b) => a._d - b._d);
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: e.message });
    }
});

// 태그(카테고리) + 지역명 → 그 지역 안의 해당 카테고리 장소 전부(중심 거리순 상위 N개)
//   예) /api/area-search?q=잠실&category=attraction  → 잠실의 관광지들
//       /api/area-search?q=서울&category=accommodation → 서울의 숙소들(중심 가까운 상위 N)
app.get('/api/area-search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const limit = Math.min(120, Math.max(10, parseInt(req.query.limit) || 60));
    if (!q) return res.status(400).json({ error: '지역명(q)이 필요합니다.' });
    if (!AREA_OVERPASS_SELECTORS[category]) {
        return res.status(400).json({ error: 'category는 attraction|accommodation|restaurant 중 하나여야 합니다.' });
    }
    try {
        const area = await geocodeArea(q, category);
        if (!area) return res.status(404).json({ error: `'${q}' 지역을 찾지 못했습니다.` });
        // extent(면적)에서 검색 반경 결정 — 최소 1.5km, 최대 7km로 캡(광역은 중심 상위 N로 처리)
        const radius = Math.min(7000, Math.max(1500, Math.round((area.extentKm || 2) * 1000)));

        // 외부(OSM Overpass) 우선, 실패하면 DB 시드 장소로 폴백 → "불러오지 못했습니다"를 막는다.
        let pois = [];
        let source = 'osm';
        try {
            pois = await fetchAreaPOIs(area.lat, area.lng, radius, category);
        } catch (e) {
            pois = [];
        }
        if (!pois || pois.length === 0) {
            source = 'db';
            const dbRows = await new Promise((resolve) => {
                db.all('SELECT id, name, type, address, tags, lat, lng FROM places WHERE type = ?', [category],
                    (err, rows) => resolve(err ? [] : (rows || [])));
            });
            const maxKm = (radius / 1000) * 1.5; // DB는 데이터가 적으므로 반경을 약간 넉넉히
            pois = dbRows
                .map(r => ({
                    id: r.id, name: r.name, category, address: r.address || '',
                    lat: r.lat, lng: r.lng,
                    tags: r.tags ? r.tags.split(',').filter(Boolean) : [],
                }))
                .filter(p => haversineKm(area.lat, area.lng, p.lat, p.lng) <= maxKm);
        }

        const ranked = pois
            .map(p => ({ ...p, _d: haversineKm(area.lat, area.lng, p.lat, p.lng) }))
            .sort((a, b) => a._d - b._d);
        let results = ranked.slice(0, limit).map(({ _d, ...p }) => p);

        // 검색어 자체가 해당 카테고리의 장소면(예: 관광+경복궁) 그 장소를 결과 맨 앞에 보장 포함.
        //   - OSM에서 면(way/relation)으로 된 주요 관광지는 node 쿼리에서 빠질 수 있어, 검색한 장소가 누락되는 걸 막는다.
        let selfAdded = false;
        if (area.selfCategory === category) {
            const nm = (area.name || '').trim();
            const inResults = results.some(p => (p.name || '').trim() === nm);
            if (!inResults) {
                const fromRanked = ranked.find(p => (p.name || '').trim() === nm);
                const selfItem = fromRanked
                    ? (({ _d, ...p }) => p)(fromRanked)
                    : { id: 'self-' + encodeURIComponent(nm), name: area.name, category, address: area.address || '', lat: area.lat, lng: area.lng, tags: [] };
                results.unshift(selfItem);
                if (results.length > limit) results = results.slice(0, limit);
                selfAdded = !fromRanked;
            }
        }

        const total = ranked.length + (selfAdded ? 1 : 0);
        res.json({
            area: { name: area.name, lat: area.lat, lng: area.lng },
            category,
            radius,
            source,
            total,
            hasMore: total > results.length,
            results,
        });
    } catch (e) {
        res.status(502).json({ error: e.message });
    }
});

// 두 좌표 사이 실제 대중교통 경로(Tmap). 실패/무키 시 204 → 프론트가 시뮬레이션 폴백.
//   /api/transit?sx=&sy=&ex=&ey=&mode=bus|subway
app.get('/api/transit', async (req, res) => {
    const sx = parseFloat(req.query.sx), sy = parseFloat(req.query.sy);
    const ex = parseFloat(req.query.ex), ey = parseFloat(req.query.ey);
    const mode = String(req.query.mode || '').trim();
    if ([sx, sy, ex, ey].some(isNaN)) return res.status(400).json({ error: 'sx,sy,ex,ey 필요' });
    try {
        const data = await fetchTmapTransit(sx, sy, ex, ey, mode);
        if (!data) return res.status(204).end();   // 키없음/경로없음/실패 → 폴백 신호
        res.json(data);
    } catch (e) {
        res.status(204).end();
    }
});

app.get('/api/places', (req, res) => {
    db.all('SELECT * FROM places', (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const places = rows.map(r => ({
            ...r,
            tags: r.tags ? r.tags.split(',') : []
        }));
        res.json(places);
    });
});

app.get('/api/my_plan', (req, res) => {
    db.all(`
        SELECT p.*, mp.id as plan_item_id, mp.stay_time, mp.memo, mp.transport_mode, mp.user_tags, mp.move_time, mp.move_cost, mp.day, mp.photo
        FROM my_plan mp JOIN places p ON mp.place_id = p.id
        ORDER BY mp.id
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const planItems = rows.map(r => {
            const d = { ...r };
            d.tags = d.tags ? d.tags.split(',') : [];
            d.userTags = d.user_tags ? d.user_tags.split(',') : [];
            delete d.user_tags;
            d.stayTime = d.stay_time;
            d.transportMode = d.transport_mode;
            d.moveTime = d.move_time;
            d.moveCost = d.move_cost;
            return d;
        });
        res.json(planItems);
    });
});

app.post('/api/my_plan', (req, res) => {
    const data = req.body;
    db.serialize(() => {
        const placeStmt = db.prepare(`
            INSERT OR IGNORE INTO places (id, name, category, address, tags, lat, lng)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        data.forEach(item => {
            const tagsStr = item.tags ? item.tags.join(',') : '';
            placeStmt.run([item.id, item.name, item.category || 'searched', item.address || '', tagsStr, item.lat, item.lng]);
        });
        placeStmt.finalize();

        db.run('DELETE FROM my_plan');
        const stmt = db.prepare(`
            INSERT INTO my_plan (place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        data.forEach(item => {
            const userTagsStr = item.userTags ? item.userTags.join(',') : '';
            stmt.run([item.id, item.stayTime || 0, item.memo || '', item.transportMode || '', userTagsStr, item.moveTime || 0, item.moveCost || 0, item.day || 1, item.photo || '']);
        });
        stmt.finalize();
        res.json({ status: 'ok' });
    });
});

// Auth API 는 보안 라우터로 이전됨: /api/auth/{login,signup,refresh,logout,me}
// (구 /api/login·/api/signup 평문 라우트는 제거 — security/routes/auth.js 사용)

app.get('/api/community', (req, res) => {
    // REQ-COM-01: 공개 범위 필터링
    //  - visibility='public'(또는 NULL=기존데이터) 은 모두 노출
    //  - visibility='group' 은 (작성자 본인) 또는 (그룹코드 일치) 인 경우에만 노출
    const userId = req.query.user_id ? parseInt(req.query.user_id) : -1;
    const groupCode = req.query.group || '';
    db.all(`
        SELECT c.*,
                IFNULL(AVG(r.rating), 0) as avg_rating,
                COUNT(r.id) as review_count
        FROM community_plans c
        LEFT JOIN plan_reviews r ON c.id = r.plan_id
        WHERE c.visibility IS NULL
           OR c.visibility = 'public'
           OR c.author_id = ?
           OR (c.visibility = 'group' AND c.group_name = ?)
        GROUP BY c.id
        ORDER BY c.id DESC
    `, [userId, groupCode], (err, plans) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let pending = plans.length;
        if (pending === 0) return res.json([]);

        plans.forEach(plan => {
            db.all(`
                SELECT p.name, cpi.day 
                FROM community_plan_items cpi JOIN places p ON cpi.place_id = p.id 
                WHERE cpi.plan_id = ? ORDER BY cpi.id
            `, [plan.id], (err, items) => {
                plan.items = items ? items.map(i => ({ name: i.name, day: i.day })) : [];
                
                // Fetch reviews for this plan
                db.all('SELECT r.*, u.username FROM plan_reviews r JOIN users u ON r.user_id = u.id WHERE r.plan_id = ?', [plan.id], (err, reviews) => {
                    plan.reviews = reviews || [];
                    // 이동 지수(감점 모델)를 모달과 동일하게 계산해 카드에서도 같은 값을 쓰게 한다
                    computeAccessBreakdown(plan.id, (bdErr, bd) => {
                        plan.access_score = bdErr || !bd ? null : bd.score;
                        pending--;
                        if (pending === 0) res.json(plans);
                    });
                });
            });
        });
    });
});

// 태그를 콤마 문자열로 정규화 — 배열/문자열/undefined 모두 허용
// (커뮤니티 일정을 포크하면 tags 가 DB의 콤마 문자열로 들어오므로 .join() 이 터지는 것을 방지)
function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.join(',');
    if (typeof tags === 'string') return tags;
    return '';
}

app.post('/api/community/share', (req, res) => {
    const data = req.body;

    // Ensure places exist
    db.serialize(() => {
        if (data.items && data.items.length > 0) {
            const placeStmt = db.prepare(`
                INSERT OR IGNORE INTO places (id, name, category, address, tags, lat, lng)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            data.items.forEach(item => {
                const tagsStr = normalizeTags(item.tags);
                placeStmt.run([item.id, item.name, item.category || 'searched', item.address || '', tagsStr, item.lat, item.lng]);
            });
            placeStmt.finalize();
        }

        // REQ-COM-01: 공개 범위. group 공개 시 group_name 필요(없으면 public 처리)
        const visibility = (data.visibility === 'group' && data.group_name) ? 'group' : 'public';
        const groupName = visibility === 'group' ? data.group_name : null;
        db.run('INSERT INTO community_plans (author, title, description, likes, author_id, visibility, group_name) VALUES (?,?,?,?,?,?,?)', [data.author || '익명', data.title || '나의 등록 일정', data.description || '', 0, data.author_id, visibility, groupName], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const planId = this.lastID;
            
            if (data.items && data.items.length > 0) {
                const stmt = db.prepare(`
                    INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                data.items.forEach(item => {
                    const userTagsStr = normalizeTags(item.userTags);
                    stmt.run([planId, item.id, item.stayTime || 0, item.memo || '', item.transportMode || '', userTagsStr, item.moveTime || 0, item.moveCost || 0, item.day || 1, item.photo || '']);
                });
                stmt.finalize();
            }
            res.json({ status: 'ok' });
        });
    });
});

app.delete('/api/community/:id', (req, res) => {
    const planId = req.params.id;
    const userId = req.body.user_id;
    const userRole = req.body.user_role;

    db.get('SELECT author_id FROM community_plans WHERE id = ?', [planId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Plan not found' });

        if (userRole === 'admin' || row.author_id === userId) {
            db.serialize(() => {
                db.run('DELETE FROM plan_reviews WHERE plan_id = ?', [planId]);
                db.run('DELETE FROM community_plan_items WHERE plan_id = ?', [planId]);
                db.run('DELETE FROM community_plans WHERE id = ?', [planId], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ status: 'ok' });
                });
            });
        } else {
            res.status(403).json({ error: 'Unauthorized' });
        }
    });
});

app.post('/api/community/review', (req, res) => {
    const { plan_id, user_id, rating, review } = req.body;
    db.run('INSERT INTO plan_reviews (plan_id, user_id, rating, review) VALUES (?, ?, ?, ?)', [plan_id, user_id, rating, review], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

app.get('/api/community/:id/details', (req, res) => {
    const planId = req.params.id;
    db.get('SELECT description FROM community_plans WHERE id = ?', [planId], (err, row) => {
        const description = row ? row.description : '';
        db.all(`
            SELECT p.*, cpi.stay_time as stayTime, cpi.memo, cpi.transport_mode as transportMode, cpi.user_tags as userTags, cpi.move_time as moveTime, cpi.move_cost as moveCost, cpi.day, cpi.photo 
            FROM community_plan_items cpi 
            JOIN places p ON cpi.place_id = p.id 
            WHERE cpi.plan_id = ? ORDER BY cpi.id
        `, [planId], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            const formattedItems = items.map(item => ({
                ...item,
                tags: item.tags ? item.tags.split(',') : [],
                userTags: item.userTags ? item.userTags.split(',') : []
            }));
            res.json({ description, items: formattedItems });
        });
    });
});

// ============================================================
// 유사 동선 추천: 공통 장소(place_id) 기반 Jaccard 유사도
//   - 커뮤니티 루트 상세에서 "비슷한 동선의 다른 루트"를 추천
// ============================================================
app.get('/api/community/:id/similar', (req, res) => {
    const planId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 5;

    db.all('SELECT place_id FROM community_plan_items WHERE plan_id = ?', [planId], (err, targetRows) => {
        if (err) return res.status(500).json({ error: err.message });
        const targetSet = new Set((targetRows || []).map(r => r.place_id));
        if (targetSet.size === 0) return res.json([]);

        db.all(`
            SELECT c.id, c.title, c.author, c.author_id, c.description,
                   IFNULL(AVG(r.rating), 0) as avg_rating, COUNT(r.id) as review_count
            FROM community_plans c
            LEFT JOIN plan_reviews r ON c.id = r.plan_id
            WHERE c.id != ? AND (c.visibility IS NULL OR c.visibility = 'public')
            GROUP BY c.id
        `, [planId], (err, plans) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!plans || plans.length === 0) return res.json([]);

            let pending = plans.length;
            const scored = [];
            plans.forEach(p => {
                db.all(`
                    SELECT cpi.place_id, pl.name FROM community_plan_items cpi
                    JOIN places pl ON cpi.place_id = pl.id
                    WHERE cpi.plan_id = ? ORDER BY cpi.id
                `, [p.id], (err2, rows) => {
                    const setB = new Set((rows || []).map(r => r.place_id));
                    let inter = 0;
                    setB.forEach(x => { if (targetSet.has(x)) inter++; });
                    const union = new Set([...targetSet, ...setB]).size;
                    const similarity = union > 0 ? inter / union : 0;
                    if (inter > 0) {
                        scored.push({
                            id: p.id, title: p.title, author: p.author, author_id: p.author_id,
                            description: p.description,
                            avg_rating: p.avg_rating, review_count: p.review_count,
                            similarity: Math.round(similarity * 100),
                            shared: inter,
                            places: (rows || []).map(r => r.name)
                        });
                    }
                    pending--;
                    if (pending === 0) {
                        scored.sort((a, b) => b.similarity - a.similarity || b.avg_rating - a.avg_rating);
                        res.json(scored.slice(0, limit));
                    }
                });
            });
        });
    });
});

// ============================================================
// 장애인 이동 지수 감점 분석 (PRD: 설명 가능한 점수)
//   score = max(0, 100 - Σ감점)
//   - 장소별: 접근성 후기 태그 부재 → 감점, 후기 없음 → no_data 감점
//   - 구간별: 직전 장소에서 도보(휠체어) 장거리 이동 → transport 감점
// ============================================================
const ACCESS_PENALTY = {
    no_data: 8,
    dims: [
        { key: 'step',     weight: 10, positive: ['no_step', 'flat'], reason: '문턱·단차가 확인되지 않음(단차 가능성)' },
        { key: 'elevator', weight: 12, positive: ['elevator'],        reason: '엘리베이터(수직 이동) 확인 안 됨' },
        { key: 'width',    weight: 8,  positive: ['wheelchair'],      reason: '휠체어 통행 폭이 확인되지 않음' },
        { key: 'ramp',     weight: 6,  positive: ['ramp', 'flat'],    reason: '경사로/평지 정보가 확인되지 않음' },
    ],
    walkThresholdKm: 0.8,
    walkPerKm: 5,
    walkMax: 8,
};

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 장소 단위 접근성 감점 산출 (장소 1곳의 후기들 → 감점 항목 배열)
//   - 턱(door_step)·경사로(ramp_angle)·통행폭(space_width)의 1~5 점수가 있으면 "우선" 사용
//     (5=양호 → 감점 0, 1=불량 → 최대 감점). 수치가 없으면 접근성 태그 유무로 폴백.
//   - 엘리베이터는 수치 항목이 없어 태그 기반만 사용.
// 이 함수로 상세 모달 점수와 추천 장소 점수가 동일한 규칙을 공유한다.
function computePlaceDeductions(reviews) {
    if (!reviews || reviews.length === 0) {
        return [{ category: 'no_data', penalty: ACCESS_PENALTY.no_data, reason: '접근성 후기가 없어 확인 불가' }];
    }
    const n = reviews.length;
    const deductions = [];

    // 태그 보유 비율(0~1)
    const tagRatio = (positives) => {
        const hit = reviews.filter(r => {
            const tags = (r.access_tags || '').split(',').filter(Boolean);
            return positives.some(t => tags.includes(t));
        }).length;
        return hit / n;
    };
    // 1~5 수치 평균(0/누락은 "미입력"으로 제외). 입력값이 하나도 없으면 null.
    const numAvg = (field) => {
        const vals = reviews.map(r => Number(r[field]) || 0).filter(v => v > 0);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    // 수치(1~5) → 감점: 5점이면 0, 1점이면 weight 만큼
    const numPenalty = (avg, weight) => Math.round(weight * (5 - avg) / 4);

    // 엘리베이터(태그 전용)
    {
        const p = Math.round(12 * (1 - tagRatio(['elevator'])));
        if (p > 0) deductions.push({ category: 'elevator', penalty: p, reason: '엘리베이터(수직 이동) 확인 안 됨' });
    }
    // 턱·단차 (door_step 수치 우선)
    {
        const avg = numAvg('door_step');
        if (avg != null) {
            const p = numPenalty(avg, 10);
            if (p > 0) deductions.push({ category: 'step', penalty: p, reason: `리뷰: 문턱·단차 ${avg.toFixed(1)}/5(낮을수록 단차 큼)` });
        } else {
            const p = Math.round(10 * (1 - tagRatio(['no_step', 'flat'])));
            if (p > 0) deductions.push({ category: 'step', penalty: p, reason: '문턱·단차가 확인되지 않음(단차 가능성)' });
        }
    }
    // 경사로 (ramp_angle 수치 우선)
    {
        const avg = numAvg('ramp_angle');
        if (avg != null) {
            const p = numPenalty(avg, 8);
            if (p > 0) deductions.push({ category: 'ramp', penalty: p, reason: `리뷰: 경사로 ${avg.toFixed(1)}/5(낮을수록 가파름)` });
        } else {
            const p = Math.round(6 * (1 - tagRatio(['ramp', 'flat'])));
            if (p > 0) deductions.push({ category: 'ramp', penalty: p, reason: '경사로/평지 정보가 확인되지 않음' });
        }
    }
    // 통행 폭 (space_width 수치 우선)
    {
        const avg = numAvg('space_width');
        if (avg != null) {
            const p = numPenalty(avg, 8);
            if (p > 0) deductions.push({ category: 'width', penalty: p, reason: `리뷰: 통행 폭 ${avg.toFixed(1)}/5(낮을수록 좁음)` });
        } else {
            const p = Math.round(8 * (1 - tagRatio(['wheelchair'])));
            if (p > 0) deductions.push({ category: 'width', penalty: p, reason: '휠체어 통행 폭이 확인되지 않음' });
        }
    }
    return deductions;
}

// 이동 지수 감점 분석을 계산하는 재사용 함수.
// 커뮤니티 목록(카드 점수)과 상세 모달(감점 분석)이 동일한 값을 쓰도록 단일화한다.
// done(err, { score, totalDeducted, segments })
function computeAccessBreakdown(planId, done) {
    db.all(`
        SELECT p.id as place_id, p.name, p.lat, p.lng, cpi.transport_mode as transportMode
        FROM community_plan_items cpi JOIN places p ON cpi.place_id = p.id
        WHERE cpi.plan_id = ? ORDER BY cpi.id
    `, [planId], (err, items) => {
        if (err) return done(err);
        if (!items || items.length === 0) return done(null, { score: 0, segments: [], totalDeducted: 0 });

        let pending = items.length;
        const placeReviews = {};
        items.forEach((it, idx) => {
            db.all('SELECT access_tags, door_step, ramp_angle, space_width FROM accessibility_reviews WHERE place_id = ?', [it.place_id], (err2, rows) => {
                placeReviews[idx] = rows || [];
                pending--;
                if (pending === 0) finish();
            });
        });

        function finish() {
            const segments = [];
            let total = 0;
            items.forEach((it, idx) => {
                const reviews = placeReviews[idx];
                // 장소 단위 감점(태그 + 리뷰 수치)
                const deductions = computePlaceDeductions(reviews);

                // 직전 장소 → 현재 장소 도보 이동 감점
                if (idx > 0) {
                    const prev = items[idx - 1];
                    const tm = (it.transportMode || '').toLowerCase();
                    if ((tm === '' || tm === 'walk' || tm === 'wheelchair') && prev.lat && prev.lng && it.lat && it.lng) {
                        const dist = haversineKm(prev.lat, prev.lng, it.lat, it.lng);
                        if (dist > ACCESS_PENALTY.walkThresholdKm) {
                            const penalty = Math.min(ACCESS_PENALTY.walkMax, Math.round((dist - ACCESS_PENALTY.walkThresholdKm) * ACCESS_PENALTY.walkPerKm));
                            if (penalty > 0) deductions.push({ category: 'transport', penalty, reason: `직전 장소에서 도보 이동 ${dist.toFixed(1)}km(경사·피로 가능성)` });
                        }
                    }
                }

                const segPenalty = deductions.reduce((s, d) => s + d.penalty, 0);
                total += segPenalty;
                segments.push({
                    index: idx + 1,
                    place_id: it.place_id,
                    name: it.name,
                    lat: it.lat, lng: it.lng,
                    penalty: segPenalty,
                    deductions
                });
            });

            const score = Math.max(0, Math.min(100, 100 - total));
            done(null, { score, totalDeducted: total, segments });
        }
    });
}

app.get('/api/community/:id/access-breakdown', (req, res) => {
    computeAccessBreakdown(parseInt(req.params.id), (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(result);
    });
});

// 장소 단위 접근성 점수 (추천 장소용). 후기가 있으면 차원 모델, 없으면 place.tags 로 보수적 추정.
function placeAccessScore(place, reviews) {
    let effective = reviews;
    let fromTags = false;
    if (!reviews || reviews.length === 0) {
        if (place.tags) { effective = [{ access_tags: place.tags }]; fromTags = true; }
    }
    const base = { id: place.id, name: place.name, category: place.category, address: place.address, lat: place.lat, lng: place.lng, tags: place.tags || '' };
    if (!effective || effective.length === 0) {
        return { ...base, score: 40, reviewCount: 0, basis: 'no_data' };
    }
    // 상세 모달과 동일한 규칙(태그 + 리뷰 수치) 사용
    const total = computePlaceDeductions(effective).reduce((s, d) => s + d.penalty, 0);
    let score = Math.max(0, Math.min(100, 100 - total));
    if (fromTags) score = Math.min(score, 85); // 후기 아닌 태그 기반은 약간 보수적으로
    return { ...base, score, reviewCount: fromTags ? 0 : effective.length, basis: fromTags ? 'tags' : 'reviews' };
}

// 외부 지도(OSM Overpass)에서 좌표 주변 실제 POI(맛집/카페/관광/숙소)를 가져온다.
// Overpass는 느리고(수~10초) 간헐적으로 실패하므로: 미러 페일오버 + 요청 타임아웃 + 메모리 캐시.
const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];
const _poiCache = new Map(); // key → { ts, data }
const POI_TTL_MS = 60 * 60 * 1000; // 1시간

async function fetchOverpass(url, body, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'TravelPlan/1.0 (accessibility travel demo)'  // UA 없으면 406
            },
            body, signal: ctrl.signal
        });
        if (!resp.ok) throw new Error('overpass ' + resp.status);
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchNearbyPOIs(lat, lng, radiusM) {
    // 반경 상한 3km — 루트가 넓게 퍼지면 radiusM이 ~8km까지 커지는데, 도심 밀집지역(예: 명동·경복궁)은
    // 5km만 돼도 Overpass 응답이 ~20초까지 늘어 abort된다. 호출부 finalize가 어차피 3km로 재필터하므로
    // 상한을 3km로 둬 밀집지역에서도 빠르게(수초) 끝나게 한다.
    const R = Math.min(3000, Math.round(radiusM));
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${R}`;
    const cached = _poiCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < POI_TTL_MS) return cached.data;

    const q = `[out:json][timeout:20];(` +
        `node["name"]["amenity"~"^(restaurant|cafe|fast_food)$"](around:${R},${lat},${lng});` +
        `node["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|theme_park|hotel|guest_house|hostel)$"](around:${R},${lat},${lng});` +
        `node["name"]["shop"~"^(mall|department_store)$"](around:${R},${lat},${lng});` +
        `);out body 100;`;
    const body = 'data=' + encodeURIComponent(q);

    let data, lastErr;
    for (const url of OVERPASS_MIRRORS) {
        // 서버 쿼리 [timeout:20]보다 살짝 길게 잡아 조기 abort 방지
        try { data = await fetchOverpass(url, body, 22000); break; }
        catch (e) { lastErr = e; }
    }
    if (!data) throw lastErr || new Error('overpass 전체 미러 실패');

    const pois = (data.elements || []).filter(e => e.tags && e.tags.name && e.lat && e.lon).map(e => {
        const t = e.tags;
        let category = 'attraction';
        if (['restaurant', 'cafe', 'fast_food'].includes(t.amenity)) category = 'restaurant';
        else if (['hotel', 'guest_house', 'hostel'].includes(t.tourism)) category = 'accommodation';
        const address = [t['addr:city'] || t['addr:province'], t['addr:district'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
        const tags = [];
        if (t.wheelchair === 'yes') tags.push('wheelchair');
        return { id: e.id, name: t.name, category, address, lat: e.lat, lng: e.lon, tags: tags.join(',') };
    });
    _poiCache.set(cacheKey, { ts: Date.now(), data: pois });
    return pois;
}

// ============================================================
// 태그(카테고리) + 지역명 검색: "잠실의 모든 관광지", "서울의 모든 숙소"
//   1) 지역명을 지오코딩해 중심좌표 + 대략적 면적(extent)을 얻고
//   2) Overpass로 그 면적 안의 해당 카테고리 POI를 모은 뒤
//   3) 지역 중심에서 가까운 순으로 정렬해 상위 N개만 돌려준다.
// ============================================================
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// photon feature(osm_key/value)를 우리 카테고리로 분류. 행정구역/기타면 null.
function classifyFeature(p) {
    const k = p.osm_key, v = p.osm_value;
    if (k === 'tourism' && /^(hotel|guest_house|hostel|motel|apartment|chalet)$/.test(v)) return 'accommodation';
    if (k === 'tourism' && /^(attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium|artwork)$/.test(v)) return 'attraction';
    if (k === 'historic') return 'attraction';
    if (k === 'leisure' && /^(park|garden)$/.test(v)) return 'attraction';
    if (k === 'amenity' && /^(restaurant|cafe|fast_food|bar|pub)$/.test(v)) return 'restaurant';
    return null; // place/boundary 등 → 지역(특정 장소 아님)
}

// 지역명 → { lat, lng, name, extentKm, selfCategory, address }.
//   행정구역/지명(place·boundary)을 우선 선택하되, 같은 점수면 요청 카테고리에 맞는 POI를 선호.
//   selfCategory: 선택된 feature가 특정 장소(관광지/숙소/맛집)면 그 카테고리, 지역이면 null.
async function geocodeArea(q, preferCategory) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q + ' 대한민국')}&limit=6`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'TravelPlan/1.0 (accessibility travel demo)' } });
    if (!resp.ok) return null;
    const data = await resp.json();
    const feats = (data.features || []).filter(f => f.geometry && Array.isArray(f.geometry.coordinates));
    if (!feats.length) return null;
    // 행정구역/지명일수록 높은 점수(지역이 있으면 지역을 중심으로). 단, 같은 점수면 요청 카테고리 POI 선호.
    const adminVals = ['city', 'town', 'suburb', 'quarter', 'neighbourhood', 'borough',
        'district', 'municipality', 'village', 'city_district', 'region', 'province'];
    const score = (f) => {
        const p = f.properties || {};
        let s = 0;
        if (p.osm_key === 'place') s += 5;
        if (p.osm_key === 'boundary') s += 4;
        if (adminVals.includes(p.osm_value)) s += 3;
        if (preferCategory && classifyFeature(p) === preferCategory) s += 2; // 경복궁 park > 경복궁 railway 등
        if (p.countrycode === 'KR') s += 1;
        return s;
    };
    feats.sort((a, b) => score(b) - score(a));
    const f = feats[0];
    const p = f.properties || {};
    const c = f.geometry.coordinates; // [lon, lat]
    let extentKm = null;
    const ext = p.extent; // photon: [minLon, maxLat, maxLon, minLat]
    if (Array.isArray(ext) && ext.length === 4) {
        const [minLon, maxLat, maxLon, minLat] = ext;
        // 대각선의 절반 ≈ 중심에서 가장자리까지의 대략적 반경
        extentKm = haversineKm(minLat, minLon, maxLat, maxLon) / 2;
    }
    const address = [p.city || p.state, p.district, p.street, p.housenumber].filter(Boolean).join(' ');
    return { lat: c[1], lng: c[0], name: p.name || q, extentKm, selfCategory: classifyFeature(p), address };
}

// 카테고리별 Overpass 셀렉터(node 기준 — 기존 fetchNearbyPOIs와 동일 정책)
const AREA_OVERPASS_SELECTORS = {
    attraction: (R, lat, lng) =>
        `node["name"]["tourism"~"^(attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium|artwork)$"](around:${R},${lat},${lng});` +
        `node["name"]["historic"](around:${R},${lat},${lng});` +
        `node["name"]["leisure"~"^(park|garden)$"](around:${R},${lat},${lng});`,
    accommodation: (R, lat, lng) =>
        `node["name"]["tourism"~"^(hotel|guest_house|hostel|motel|apartment|chalet)$"](around:${R},${lat},${lng});`,
    restaurant: (R, lat, lng) =>
        `node["name"]["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"](around:${R},${lat},${lng});`,
};

const _areaCache = new Map(); // key → { ts, data }

async function fetchAreaPOIs(lat, lng, radiusM, category) {
    const R = Math.round(radiusM);
    const cacheKey = `${category}:${lat.toFixed(3)},${lng.toFixed(3)},${R}`;
    const cached = _areaCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < POI_TTL_MS) return cached.data;

    const sel = AREA_OVERPASS_SELECTORS[category];
    if (!sel) throw new Error('지원하지 않는 카테고리: ' + category);
    const q = `[out:json][timeout:25];(${sel(R, lat, lng)});out body 250;`;
    const body = 'data=' + encodeURIComponent(q);

    let data, lastErr;
    for (const url of OVERPASS_MIRRORS) {
        try { data = await fetchOverpass(url, body, 20000); break; }
        catch (e) { lastErr = e; }
    }
    if (!data) throw lastErr || new Error('overpass 전체 미러 실패');

    const pois = (data.elements || [])
        .filter(e => e.tags && e.tags.name && e.lat && e.lon)
        .map(e => {
            const t = e.tags;
            const address = [t['addr:city'] || t['addr:province'], t['addr:district'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
            const tags = [];
            if (t.wheelchair === 'yes') tags.push('wheelchair');
            return { id: e.id, name: t.name, category, address, lat: e.lat, lng: e.lon, tags };
        });
    _areaCache.set(cacheKey, { ts: Date.now(), data: pois });
    return pois;
}

// ============================================================
// Tmap 대중교통 경로안내 API — 두 좌표 사이의 실제 버스/지하철 경로
//   https://apis.openapi.sk.com/transit/routes (POST, header appKey)
//   키가 없거나 실패하면 null을 돌려주고, 프론트는 시뮬레이션으로 폴백한다.
// ============================================================
const TMAP_APP_KEY = process.env.TMAP_APP_KEY || '';
const _transitCache = new Map(); // key → { ts, data }
const TRANSIT_TTL_MS = 10 * 60 * 1000; // 10분(경로는 자주 안 바뀜)

// Tmap leg 한 개 → 프론트가 쓰기 쉬운 단순 구조로 변환
function _mapTmapLeg(l) {
    const min = Math.max(1, Math.round((l.sectionTime || 0) / 60));
    const stops = (l.passStopList && Array.isArray(l.passStopList.stationList))
        ? Math.max(1, l.passStopList.stationList.length - 1) : null;
    const from = l.start && l.start.name, to = l.end && l.end.name;
    if (l.mode === 'SUBWAY') {
        return {
            mode: 'subway', min, stops, from, to,
            line: String(l.route || '').replace(/^수도권/, '').trim() || l.route || '지하철',
            color: l.routeColor ? '#' + l.routeColor : '#3d5bab',
        };
    }
    if (l.mode === 'BUS') {
        const parts = String(l.route || '').split(':');
        const label = parts.length > 1 ? parts[0] : '버스';
        const num = parts.length > 1 ? parts.slice(1).join(':') : (l.route || '');
        return { mode: 'bus', min, stops, from, to, label, num, color: l.routeColor ? '#' + l.routeColor : '#3d5bab' };
    }
    return { mode: 'walk', min, from, to };
}

async function fetchTmapTransit(sx, sy, ex, ey, preferMode) {
    if (!TMAP_APP_KEY) return null;
    const key = `${sx.toFixed(4)},${sy.toFixed(4)}>${ex.toFixed(4)},${ey.toFixed(4)}#${preferMode || ''}`;
    const cached = _transitCache.get(key);
    if (cached && (Date.now() - cached.ts) < TRANSIT_TTL_MS) return cached.data;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let json;
    try {
        const resp = await fetch('https://apis.openapi.sk.com/transit/routes', {
            method: 'POST',
            headers: { 'appKey': TMAP_APP_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ startX: String(sx), startY: String(sy), endX: String(ex), endY: String(ey), count: 5, lang: 0, format: 'json' }),
            signal: ctrl.signal,
        });
        if (!resp.ok) return null;            // 400/거리초과 등 → 폴백
        json = await resp.json();
    } catch (e) {
        return null;                          // 타임아웃/네트워크 → 폴백
    } finally {
        clearTimeout(timer);
    }

    const its = json && json.metaData && json.metaData.plan && json.metaData.plan.itineraries;
    if (!Array.isArray(its) || its.length === 0) return null;

    // 선호 수단(버스/지하철)이 있으면 그 수단을 포함하는 첫 경로, 없으면 최적(첫) 경로
    const wantMode = preferMode === 'bus' ? 'BUS' : preferMode === 'subway' ? 'SUBWAY' : null;
    const chosen = (wantMode && its.find(t => (t.legs || []).some(l => l.mode === wantMode))) || its[0];

    const legs = (chosen.legs || []).map(_mapTmapLeg);
    const data = {
        source: 'tmap',
        totalTime: Math.round((chosen.totalTime || 0) / 60),
        fare: (chosen.fare && chosen.fare.regular && chosen.fare.regular.totalFare) || 0,
        transfers: chosen.transferCount || 0,
        legs,
    };
    _transitCache.set(key, { ts: Date.now(), data });
    return data;
}

// 추천 장소 후보: 루트 "주변"(반경 내) 실제 장소. 외부 API 우선, 실패 시 DB 폴백.
//   - 평점 필터(3.5 이상)는 클라이언트가 실시간 리뷰를 받아 적용한다.
app.get('/api/community/:id/recommended-places', async (req, res) => {
    const planId = parseInt(req.params.id);
    const radiusKm = parseFloat(req.query.radius) || 3;     // 루트 주변 반경(km)
    const limit = parseInt(req.query.limit) || 21;
    const perCatCap = 7;                                     // 카테고리 쏠림 방지

    db.all('SELECT p.name, p.lat, p.lng FROM community_plan_items cpi JOIN places p ON cpi.place_id = p.id WHERE cpi.plan_id = ?',
        [planId], async (err, routePlaces) => {
            if (err) return res.status(500).json({ error: err.message });
            const pts = (routePlaces || []).filter(r => r.lat && r.lng);
            const routeNames = new Set((routePlaces || []).map(r => (r.name || '').trim()));
            if (pts.length === 0) return res.json([]);

            // 루트 중심 + 루트가 퍼진 정도를 반영한 검색 반경
            const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
            const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
            const spread = Math.max(...pts.map(p => haversineKm(cLat, cLng, p.lat, p.lng)), 0);

            // 루트의 어느 장소든 가장 가까운 거리 기준으로 정리/정렬/중복제거
            const finalize = (cands) => {
                const out = [];
                cands.forEach(c => {
                    if (!c.lat || !c.lng || routeNames.has((c.name || '').trim())) return;
                    let minDist = Infinity;
                    pts.forEach(rp => { const d = haversineKm(rp.lat, rp.lng, c.lat, c.lng); if (d < minDist) minDist = d; });
                    if (minDist <= radiusKm) out.push({ ...c, distanceKm: Math.round(minDist * 10) / 10 });
                });
                out.sort((a, b) => a.distanceKm - b.distanceKm);
                // 이름 중복 제거
                const seen = new Set();
                const dedup = out.filter(p => { const k = (p.name || '').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
                // 카테고리당 상한으로 쏠림 방지(가까운 순 유지)
                const catCount = {};
                const capped = dedup.filter(p => {
                    catCount[p.category] = (catCount[p.category] || 0) + 1;
                    return catCount[p.category] <= perCatCap;
                });
                return capped.slice(0, limit);
            };

            // 1) 외부 지도 API
            try {
                const pois = await fetchNearbyPOIs(cLat, cLng, (radiusKm + spread) * 1000);
                const result = finalize(pois);
                if (result.length) return res.json(result);
            } catch (e) {
                console.error('[recommend] 외부 POI 조회 실패, DB로 폴백:', e.message);
            }

            // 2) 폴백: DB 장소
            db.all('SELECT place_id FROM community_plan_items WHERE plan_id = ?', [planId], (e0, rows) => {
                const excludeIds = new Set((rows || []).map(r => r.place_id));
                db.all('SELECT * FROM places', [], (err2, places) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    const cands = (places || [])
                        .filter(p => !excludeIds.has(p.id))
                        .map(p => ({ id: p.id, name: p.name, category: p.category, address: p.address, lat: p.lat, lng: p.lng, tags: p.tags || '' }));
                    res.json(finalize(cands));
                });
            });
        });
});

// ===== REQ-COM-05: 장소 접근성 후기 + 보행 편의성 태깅 =====
// 후기 작성: { place_id, user_id, access_tags:[], rating, ramp_angle, door_step, space_width, comment, photo }
app.post('/api/accessibility/review', (req, res) => {
    const { place_id, user_id, access_tags, rating, ramp_angle, door_step, space_width, comment, photo } = req.body;
    if (!place_id || !user_id) return res.status(400).json({ error: 'place_id, user_id 필수' });
    const tagsStr = Array.isArray(access_tags) ? access_tags.join(',') : (access_tags || '');
    const r = Math.max(0, Math.min(5, parseInt(rating) || 0));   // 0=별점 미입력
    db.run(
        `INSERT INTO accessibility_reviews (place_id, user_id, access_tags, rating, ramp_angle, door_step, space_width, comment, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [place_id, user_id, tagsStr, r, ramp_angle || 0, door_step || 0, space_width || 0, comment || '', photo || ''],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok', id: this.lastID });
        }
    );
});

// 특정 장소의 접근성 후기 목록 + 태그 집계
app.get('/api/accessibility/reviews', (req, res) => {
    const placeId = req.query.place_id;
    if (!placeId) return res.status(400).json({ error: 'place_id 필수' });
    db.all(
        `SELECT ar.*, u.username
         FROM accessibility_reviews ar LEFT JOIN users u ON ar.user_id = u.id
         WHERE ar.place_id = ? ORDER BY ar.id DESC`,
        [placeId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            const reviews = (rows || []).map(r => ({
                ...r,
                access_tags: r.access_tags ? r.access_tags.split(',').filter(Boolean) : []
            }));
            // 태그 집계(어떤 편의성이 몇 번 언급됐는지)
            const tagCounts = {};
            reviews.forEach(r => r.access_tags.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
            // 별점 평균(0/미입력은 제외)
            const rated = reviews.map(r => Number(r.rating) || 0).filter(v => v > 0);
            const avgRating = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : 0;
            res.json({ reviews, tagCounts, count: reviews.length, avgRating, ratingCount: rated.length });
        }
    );
});

// ===== REQ-COM-06: 현지 정보 질의응답 + 실시간 제보 게시판 =====
// 글 목록: ?region=&category=(question|report)  - 답변 수 포함
app.get('/api/qna', (req, res) => {
    const region = req.query.region || '';
    const category = req.query.category || '';
    let where = '1=1';
    const params = [];
    if (region) { where += ' AND q.region LIKE ?'; params.push('%' + region + '%'); }
    if (category) { where += ' AND q.category = ?'; params.push(category); }
    db.all(
        `SELECT q.*, u.username,
                (SELECT COUNT(*) FROM qna_answers a WHERE a.post_id = q.id) as answer_count
         FROM qna_posts q LEFT JOIN users u ON q.user_id = u.id
         WHERE ${where}
         ORDER BY q.id DESC`,
        params,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows || []);
        }
    );
});

// 글 작성: { user_id, region, title, question, category }
app.post('/api/qna', (req, res) => {
    const { user_id, region, title, question, category } = req.body;
    if (!user_id || !question) return res.status(400).json({ error: 'user_id, question 필수' });
    const cat = category === 'report' ? 'report' : 'question';
    db.run(
        'INSERT INTO qna_posts (user_id, region, title, question, category) VALUES (?, ?, ?, ?, ?)',
        [user_id, region || '', title || '', question, cat],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok', id: this.lastID });
        }
    );
});

// 글 상세 + 답변/제보 목록
app.get('/api/qna/:id', (req, res) => {
    const postId = req.params.id;
    db.get(
        `SELECT q.*, u.username FROM qna_posts q LEFT JOIN users u ON q.user_id = u.id WHERE q.id = ?`,
        [postId],
        (err, post) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
            db.all(
                `SELECT a.*, u.username FROM qna_answers a LEFT JOIN users u ON a.user_id = u.id
                 WHERE a.post_id = ? ORDER BY a.id ASC`,
                [postId],
                (err, answers) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ post, answers: answers || [] });
                }
            );
        }
    );
});

// 답변/제보 작성: { user_id, answer }
app.post('/api/qna/:id/answer', (req, res) => {
    const postId = req.params.id;
    const { user_id, answer } = req.body;
    if (!user_id || !answer) return res.status(400).json({ error: 'user_id, answer 필수' });
    db.run(
        'INSERT INTO qna_answers (post_id, user_id, answer) VALUES (?, ?, ?)',
        [postId, user_id, answer],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ status: 'ok', id: this.lastID });
        }
    );
});

// 404 + Global Exception 핸들러 (모든 라우트 등록 뒤에 위치해야 함)
security.installErrorHandling(app);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});