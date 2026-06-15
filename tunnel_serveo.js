const { spawn } = require('child_process');

function startServeo() {
    console.log('[Serveo Tunnel] 터널링 시작 중 (travelplan 고정)...');
    
    // Serveo SSH 명령어 실행
    const serveo = spawn('ssh', [
        '-R', 'travelplan:80:127.0.0.1:8000', 
        '-o', 'StrictHostKeyChecking=no', 
        '-o', 'ServerAliveInterval=60', 
        'serveo.net'
    ], {
        stdio: 'inherit',
        shell: true
    });

    serveo.on('close', (code) => {
        console.log(`[Serveo Tunnel] 서버 연결이 끊어졌습니다 (코드: ${code}). 3초 뒤에 즉시 자동으로 복구합니다...`);
        setTimeout(startServeo, 3000);
    });

    serveo.on('error', (err) => {
        console.error('[Serveo Tunnel] 오류 발생:', err);
    });
}

startServeo();