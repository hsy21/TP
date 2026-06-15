const { spawn } = require('child_process');

function startTunnel() {
    console.log('[Tunnel] 터널링 시작 중...');
    
    // localtunnel을 사용하여 서브도메인 고정
    const tunnel = spawn('npx', ['localtunnel', '--port', '8000', '--subdomain', 'travelplan'], {
        stdio: 'inherit',
        shell: true
    });

    tunnel.on('close', (code) => {
        console.log(`[Tunnel] 터널링이 종료되었습니다 (코드: ${code}). 3초 뒤 다시 시작합니다...`);
        setTimeout(startTunnel, 3000);
    });

    tunnel.on('error', (err) => {
        console.error('[Tunnel] 오류 발생:', err);
    });
}

startTunnel();
