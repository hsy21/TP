import http.server
import socketserver
import json
import sqlite3
import os
from urllib.parse import urlparse, parse_qs

PORT = 8000
DB_FILE = 'travel.db'
WEB_DIR = '../web'

# DB 초기화
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # 장소 테이블
    c.execute('''
        CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY,
            name TEXT,
            category TEXT,
            address TEXT,
            tags TEXT,
            lat REAL,
            lng REAL
        )
    ''')
    
    # 내 일정 테이블
    c.execute('''
        CREATE TABLE IF NOT EXISTS my_plan (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            place_id INTEGER,
            stay_time INTEGER,
            memo TEXT,
            transport_mode TEXT,
            user_tags TEXT,
            move_time INTEGER,
            move_cost INTEGER
        )
    ''')
    
    # 커뮤니티 일정 메타 테이블
    c.execute('''
        CREATE TABLE IF NOT EXISTS community_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author TEXT,
            title TEXT,
            likes INTEGER
        )
    ''')
    
    # 커뮤니티 일정 상세 테이블
    c.execute('''
        CREATE TABLE IF NOT EXISTS community_plan_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plan_id INTEGER,
            place_id INTEGER,
            stay_time INTEGER,
            memo TEXT,
            transport_mode TEXT,
            user_tags TEXT,
            move_time INTEGER,
            move_cost INTEGER,
            FOREIGN KEY(plan_id) REFERENCES community_plans(id)
        )
    ''')
    
    # 초기 목업 데이터 삽입 (장소가 없으면)
    c.execute('SELECT count(*) FROM places')
    if c.fetchone()[0] == 0:
        places_data = [
            (1, '경복궁', 'attraction', '서울 종로구 사직로 161', 'wheelchair,parking', 37.579617, 126.977041),
            (2, '남산 서울타워', 'attraction', '서울 용산구 남산공원길 105', 'elevator,wheelchair', 37.551169, 126.988226),
            (3, '명동교자', 'restaurant', '서울 중구 명동10길 29', 'wheelchair', 37.562544, 126.985612),
            (4, '신라호텔', 'accommodation', '서울 중구 동호로 249', 'wheelchair,elevator,parking', 37.556214, 127.006325),
            (5, '광장시장', 'attraction', '서울 종로구 창경궁로 88', '', 37.570221, 126.999518)
        ]
        c.executemany('INSERT INTO places VALUES (?,?,?,?,?,?,?)', places_data)
        
        # 커뮤니티 목업 추가
        c.execute('INSERT INTO community_plans (author, title, likes) VALUES (?,?,?)', ('배리어프리여행자', '휠체어로 떠나는 서울 중심부 당일치기', 24))
        plan_id = c.lastrowid
        c.execute('''INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost) 
                     VALUES (?,?,?,?,?,?,?,?)''', (plan_id, 1, 120, '', 'wheelchair', 'wheelchair', 0, 0))
        c.execute('''INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost) 
                     VALUES (?,?,?,?,?,?,?,?)''', (plan_id, 3, 60, '', 'taxi', 'wheelchair', 15, 8000))
                     
    conn.commit()
    conn.close()

class APRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed_path = urlparse(self.path)
        
        if parsed_path.path == '/api/places':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('SELECT * FROM places')
            rows = c.fetchall()
            places = []
            for r in rows:
                d = dict(r)
                d['tags'] = d['tags'].split(',') if d['tags'] else []
                places.append(d)
            conn.close()
            
            self.wfile.write(json.dumps(places, ensure_ascii=False).encode('utf-8'))
            return
            
        elif parsed_path.path == '/api/my_plan':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('''
                SELECT p.*, mp.id as plan_item_id, mp.stay_time, mp.memo, mp.transport_mode, mp.user_tags, mp.move_time, mp.move_cost 
                FROM my_plan mp JOIN places p ON mp.place_id = p.id
                ORDER BY mp.id
            ''')
            rows = c.fetchall()
            plan_items = []
            for r in rows:
                d = dict(r)
                d['tags'] = d['tags'].split(',') if d['tags'] else []
                d['userTags'] = d['user_tags'].split(',') if d['user_tags'] else []
                del d['user_tags']
                d['stayTime'] = d['stay_time']
                d['transportMode'] = d['transport_mode']
                d['moveTime'] = d['move_time']
                d['moveCost'] = d['move_cost']
                plan_items.append(d)
            conn.close()
            
            self.wfile.write(json.dumps(plan_items, ensure_ascii=False).encode('utf-8'))
            return
            
        elif parsed_path.path == '/api/community':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute('SELECT * FROM community_plans ORDER BY id DESC')
            plans = []
            for cp in c.fetchall():
                p_dict = dict(cp)
                c.execute('''
                    SELECT p.name 
                    FROM community_plan_items cpi JOIN places p ON cpi.place_id = p.id 
                    WHERE cpi.plan_id = ? ORDER BY cpi.id
                ''', (p_dict['id'],))
                items = c.fetchall()
                p_dict['items'] = [{'name': i['name']} for i in items]
                plans.append(p_dict)
            conn.close()
            
            self.wfile.write(json.dumps(plans, ensure_ascii=False).encode('utf-8'))
            return
            
        # API가 아니면 정적 파일 제공
        return super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))
        
        if parsed_path.path == '/api/my_plan':
            # 전체 플랜 업데이트 (간단하게 다 지우고 다시 넣기)
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute('DELETE FROM my_plan')
            
            for item in data:
                user_tags_str = ','.join(item.get('userTags', []))
                c.execute('''
                    INSERT INTO my_plan (place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (item['id'], item.get('stayTime', 0), item.get('memo', ''), item.get('transportMode', ''), user_tags_str, item.get('moveTime', 0), item.get('moveCost', 0)))
            
            conn.commit()
            conn.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
            return
            
        elif parsed_path.path == '/api/community/share':
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            
            c.execute('INSERT INTO community_plans (author, title, likes) VALUES (?,?,?)', (data.get('author', '익명'), data.get('title', '나의 공유 일정'), 0))
            plan_id = c.lastrowid
            
            for item in data.get('items', []):
                user_tags_str = ','.join(item.get('userTags', []))
                c.execute('''
                    INSERT INTO community_plan_items (plan_id, place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (plan_id, item['id'], item.get('stayTime', 0), item.get('memo', ''), item.get('transportMode', ''), user_tags_str, item.get('moveTime', 0), item.get('moveCost', 0)))
            
            conn.commit()
            conn.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
            return
            
        elif parsed_path.path == '/api/community/fork':
            plan_id = data.get('plan_id')
            
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            # 기존 내 일정 삭제
            c.execute('DELETE FROM my_plan')
            
            # 커뮤니티 일정 복사
            c.execute('SELECT * FROM community_plan_items WHERE plan_id = ? ORDER BY id', (plan_id,))
            items = c.fetchall()
            for item in items:
                c.execute('''
                    INSERT INTO my_plan (place_id, stay_time, memo, transport_mode, user_tags, move_time, move_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (item['place_id'], item['stay_time'], item['memo'], item['transport_mode'], item['user_tags'], item['move_time'], item['move_cost']))
            
            conn.commit()
            conn.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
            return

if __name__ == '__main__':
    init_db()
    with socketserver.TCPServer(("", PORT), APRequestHandler) as httpd:
        print(f"서버가 http://localhost:{PORT} 에서 실행 중입니다...")
        print("종료하려면 Ctrl+C 를 누르세요.")
        httpd.serve_forever()