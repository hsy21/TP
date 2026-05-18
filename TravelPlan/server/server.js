const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 8000;
const DB_FILE = 'travel.db';

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// DB 초기화
const db = new sqlite3.Database(DB_FILE);

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
        res.json(mapped);
    } catch (e) {
        res.status(500).json({ error: e.message });
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

// Auth API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) {
            res.json({ success: false, error: '아이디 또는 비밀번호가 잘못되었습니다.' });
        } else {
            res.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
        }
    });
});

app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (user) {
            res.json({ success: false, error: '이미 존재하는 아이디입니다.' });
        } else {
            db.run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, password, 'user'], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true, user: { id: this.lastID, username, role: 'user' } });
            });
        }
    });
});

app.get('/api/community', (req, res) => {
    db.all(`
        SELECT c.*, 
                IFNULL(AVG(r.rating), 0) as avg_rating,
                COUNT(r.id) as review_count
        FROM community_plans c
        LEFT JOIN plan_reviews r ON c.id = r.plan_id
        GROUP BY c.id
        ORDER BY c.id DESC
    `, (err, plans) => {
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
                    pending--;
                    if (pending === 0) res.json(plans);
                });
            });
        });
    });
});

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
                const tagsStr = item.tags ? item.tags.join(',') : '';
                placeStmt.run([item.id, item.name, item.category || 'searched', item.address || '', tagsStr, item.lat, item.lng]);
            });
            placeStmt.finalize();
        }

        db.run('INSERT INTO community_plans (author, title, description, likes, author_id) VALUES (?,?,?,?,?)', [data.author || '익명', data.title || '나의 등록 일정', data.description || '', 0, data.author_id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const planId = this.lastID;
            
            if (data.items && data.items.length > 0) {
                const stmt = db.prepare(`
                    INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost, day, photo)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                data.items.forEach(item => {
                    const userTagsStr = item.userTags ? item.userTags.join(',') : '';
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://0.0.0.0:${PORT}`);
});