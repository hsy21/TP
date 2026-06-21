// State Variables
let allPlaces = [];
let planItems = [];
let currentSelectedPlace = null;
let map = null;
let markers = [];
let polyline = null;
let communityPlans = [];
// 비슷한/전체 루트 카드 토글 선택: 클릭 순서대로 내 일정에 이어 붙이기
let routeSelOrder = [];   // 선택된 커뮤니티 루트 id (클릭 순서)
let routeSelBase = null;  // 선택 시작 시점의 planItems 스냅샷(전부 해제하면 복원)
let routeSelCache = {};   // id -> 해당 루트의 items 배열(상세 캐시)
// 루트 상세 모달의 "가져올 구성" 스테이징(원본 공유 루트는 불변, 가져오기 시에만 내 일정 반영)
let cpStageItems = [];    // 편집 중인 스테이징 장소 목록(복사본)
let cpStageRouteId = null;
let cpInsertPos = null;   // 끼워넣기 위치(0..length). null/length = 맨 끝
let _cpStageDrawSeq = 0;  // 미니맵 스테이징 동선 비동기 그리기 경쟁 방지 토큰
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let undoStack = [];
let currentDay = 1;
let currentViewDay = 1;
let maxDay = 1; // { id, username, role }

// DOM Elements
const searchResults = document.getElementById('searchResults');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');
const planTimeline = document.getElementById('planTimeline');
const modal = document.getElementById('placeModal');
const closeBtn = document.querySelector('#placeModal .close-btn');
const addPlaceBtn = document.getElementById('addPlaceBtn');

    // Initialize
    document.addEventListener('DOMContentLoaded', async () => {
        initMap();
        
        // Fetch data from Python Backend API
        await fetchPlaces();
        await fetchMyPlan();
        await fetchCommunityPlans();
        
        displayPlaces(allPlaces);
        updatePlanUI();
        updateAuthUI();
        
        // Default to Community View
        switchView('community');
        renderCommunity();
    
    // Filter buttons event
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e.target.dataset.category === 'all') {
                filterBtns.forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            } else {

                document.querySelector('.filter-btn[data-category="all"]').classList.remove('active');
                e.target.classList.toggle('active');
                
                // If nothing is selected, default back to 'all'
                const activeFilters = document.querySelectorAll('.filter-btn.active');
                if (activeFilters.length === 0) {
                    document.querySelector('.filter-btn[data-category="all"]').classList.add('active');
                }
            }
            searchPlaces(); // Re-trigger search with active filter
        });
    });

    // Modal close event
    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Add place to plan event
    addPlaceBtn.addEventListener('click', () => {
        addPlaceToPlan();
    });

    // Navigation events
    document.getElementById('nav-plan').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('plan-edit');
    });
    
    document.getElementById('nav-community').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('community');
        renderCommunity();
    });

    document.getElementById('nav-talk').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('talk');
    });

    document.getElementById('nav-profile').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('profile');
    });

    const navMyRoutes = document.getElementById('nav-my-routes');
    if (navMyRoutes) {
        navMyRoutes.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = 'my_routes.html';
        });
    }


    // Mode Toggle Events
    const btnUndo = document.getElementById('btnUndo');
    if(btnUndo) {
        btnUndo.addEventListener('click', () => {
            if(undoStack.length > 0) {
                planItems = JSON.parse(undoStack.pop());
                if(undoStack.length === 0) btnUndo.style.display = 'none';
                savePlanToServer();
                updateDayTabs();
                updatePlanUI();
            }
        });
    }

    document.getElementById('btnApplyMode').addEventListener('click', () => {
        if(planItems.length === 0) return alert('적용할 일정이 없습니다.');
        switchView('plan-view');
    });

    document.getElementById('btnEditMode').addEventListener('click', () => {
        switchView('plan-edit');
    });

    const clearPlanBtn = document.getElementById('clearPlanBtn');
    if (clearPlanBtn) {
        clearPlanBtn.addEventListener('click', () => {
            if (confirm('현재 작성 중인 일정을 모두 삭제하시겠습니까?')) {
                saveToUndo();
                planItems = [];
                savePlanToServer();
                updatePlanUI();
            }
        });
    }

    const panelToggleBtn = document.getElementById('panelToggleBtn');
    if (panelToggleBtn) {
        panelToggleBtn.addEventListener('click', () => {
            isPanelOpen = !isPanelOpen;
            const icon = panelToggleBtn.querySelector('i');
            if (isPanelOpen) {
                icon.className = 'fas fa-chevron-left';
            } else {
                icon.className = 'fas fa-chevron-right';
            }
            
            if (window.innerWidth <= 900) {
                const sidebar = document.querySelector('.sidebar');
                const mapView = document.getElementById('mapView');
                if (isPanelOpen) {
                    sidebar.classList.add('mobile-overlay');
                    if(mapView) mapView.classList.add('panel-open');
                } else {
                    sidebar.classList.remove('mobile-overlay');
                    if(mapView) mapView.classList.remove('panel-open');
                }
            } else {
                switchView(currentDesktopView);
            }
        });
    }

    // Login Modals & Logic
    const loginModal = document.getElementById('loginModal');
    const reviewModal = document.getElementById('reviewModal');

    document.getElementById('loginBtn').addEventListener('click', () => {
        loginModal.classList.add('active');
    });

    document.getElementById('closeLoginBtn').addEventListener('click', () => {
        loginModal.classList.remove('active');
    });

    document.getElementById('closeReviewBtn').addEventListener('click', () => {
        reviewModal.classList.remove('active');
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        // 서버 세션(refresh 토큰) 폐기 — 쿠키 기반이라 CSRF 헤더 필요
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'X-CSRF-Token': localStorage.getItem('csrfToken') || '' }
            });
        } catch (e) { /* 네트워크 오류는 무시하고 로컬 정리 진행 */ }
        currentUser = null;
        localStorage.removeItem('currentUser');
        localStorage.removeItem('accessToken');
        localStorage.removeItem('csrfToken');
        updateAuthUI();
        renderCommunity(); // Re-render to update review/delete buttons
    });

    // Login Tabs logic
    const tabLogin = document.getElementById('tabLogin');
    const tabSignup = document.getElementById('tabSignup');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    tabLogin.addEventListener('click', () => {
        tabLogin.style.borderBottom = '2px solid var(--primary-color)';
        tabLogin.style.color = 'var(--primary-color)';
        tabLogin.style.fontWeight = 'bold';
        tabSignup.style.borderBottom = 'none';
        tabSignup.style.color = '#666';
        tabSignup.style.fontWeight = 'normal';
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
    });

    tabSignup.addEventListener('click', () => {
        tabSignup.style.borderBottom = '2px solid var(--primary-color)';
        tabSignup.style.color = 'var(--primary-color)';
        tabSignup.style.fontWeight = 'bold';
        tabLogin.style.borderBottom = 'none';
        tabLogin.style.color = '#666';
        tabLogin.style.fontWeight = 'normal';
        signupForm.style.display = 'block';
        loginForm.style.display = 'none';
    });

    document.getElementById('submitLoginBtn').addEventListener('click', async () => {
        const u = document.getElementById('loginUsername').value.trim();
        const p = document.getElementById('loginPassword').value.trim();
        if(!u || !p) return alert('아이디와 비밀번호를 입력해주세요.');

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if(data.success) {
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                // 보안 토큰 보관 (access: Bearer 헤더용, csrf: 쿠키 기반 요청 헤더용)
                if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
                if (data.csrfToken) localStorage.setItem('csrfToken', data.csrfToken);
                updateAuthUI();
                loginModal.classList.remove('active');
                renderCommunity(); // Re-render to update permissions
            } else {
                alert('로그인 실패: ' + ((data.error && data.error.message) || '알 수 없는 오류'));
            }
        } catch(e) {
            console.error("Login error", e);
        }
    });

    document.getElementById('submitSignupBtn').addEventListener('click', async () => {
        const u = document.getElementById('signupUsername').value.trim();
        const p = document.getElementById('signupPassword').value.trim();
        if(!u || !p) return alert('아이디와 비밀번호를 입력해주세요.');

        try {
            const res = await fetch('/api/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if(data.success) {
                alert('회원가입이 완료되었습니다! 자동으로 로그인됩니다.');
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                if (data.accessToken) localStorage.setItem('accessToken', data.accessToken);
                if (data.csrfToken) localStorage.setItem('csrfToken', data.csrfToken);
                updateAuthUI();
                loginModal.classList.remove('active');
                renderCommunity();
            } else {
                alert('회원가입 실패: ' + ((data.error && data.error.message) || '알 수 없는 오류'));
            }
        } catch(e) {
            console.error("Signup error", e);
        }
    });

    // Share event (REQ-COM-01: 공개 범위 선택 모달로 공유)
    const btnShare = document.getElementById('btnShareMode') || document.querySelector('.btn-share');
    if (btnShare) {
        btnShare.addEventListener('click', () => {
            if (!currentUser) return alert('일정을 등록하려면 먼저 로그인해주세요.');
            if(planItems.length === 0) return alert('일정을 먼저 추가해주세요.');
            openShareModal();
        });
    }
});

// REQ-COM-01: 공개 범위 선택 공유 모달
function openShareModal() {
    const modal = document.getElementById('shareModal');
    if (!modal) return;
    document.getElementById('shareTitle').value = `${currentUser.username}의 추천 일정`;
    document.getElementById('shareDesc').value = document.getElementById('planDescription').value || '';
    const pub = document.getElementById('shareVisPublic');
    if (pub) pub.checked = true;
    document.getElementById('shareGroupName').value = '';
    toggleShareGroupInput();
    modal.classList.add('active');
}

function toggleShareGroupInput() {
    const isGroup = document.getElementById('shareVisGroup') && document.getElementById('shareVisGroup').checked;
    const wrap = document.getElementById('shareGroupWrap');
    if (wrap) wrap.style.display = isGroup ? 'block' : 'none';
}

async function submitShare() {
    if (!currentUser) return alert('로그인이 필요합니다.');
    const title = document.getElementById('shareTitle').value.trim();
    if (!title) return alert('일정 제목을 입력해주세요.');
    const description = document.getElementById('shareDesc').value || '';
    const isGroup = document.getElementById('shareVisGroup').checked;
    const groupName = document.getElementById('shareGroupName').value.trim();
    if (isGroup && !groupName) return alert('그룹 공개를 선택한 경우 그룹 코드를 입력해주세요.');

    try {
        const res = await fetch('/api/community/share', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                author: currentUser.username,
                author_id: currentUser.id,
                title: title,
                description: description,
                visibility: isGroup ? 'group' : 'public',
                group_name: isGroup ? groupName : null,
                items: planItems
            })
        });
        if (res.ok) {
            document.getElementById('shareModal').classList.remove('active');
            // 그룹 공개로 올렸다면 해당 그룹 피드가 보이도록 코드 적용
            if (isGroup) activeGroupCode = groupName;
            alert(isGroup ? `그룹 '${groupName}' 에 일정이 공유되었습니다!` : '커뮤니티에 일정이 전체 공개로 공유되었습니다!');
            await fetchCommunityPlans();
            renderCommunity();
        } else {
            alert('공유에 실패했습니다.');
        }
    } catch (e) {
        console.error(e);
        alert('공유 실패');
    }
}

// REQ-COM-01: 커뮤니티 피드에서 그룹 코드로 비공개 그룹 일정 조회
async function applyGroupCode() {
    const input = document.getElementById('groupCodeInput');
    activeGroupCode = input ? input.value.trim() : '';
    await fetchCommunityPlans();
    renderCommunity();
}

// API Fetch Functions
async function fetchPlaces() {
    try {
        const res = await fetch('/api/places');
        allPlaces = await res.json();
    } catch(e) { console.error("Error fetching places:", e); }
}

async function fetchMyPlan() {
    try {
        const res = await fetch('/api/my_plan');
        planItems = await res.json();
    } catch(e) { console.error("Error fetching my plan:", e); }
}

// REQ-COM-01: 현재 보고 있는 그룹 코드(그룹 공개 일정 조회용)
let activeGroupCode = '';

async function fetchCommunityPlans() {
    try {
        const params = new URLSearchParams();
        if (currentUser) params.set('user_id', currentUser.id);
        if (activeGroupCode) params.set('group', activeGroupCode);
        const qs = params.toString();
        const res = await fetch('/api/community' + (qs ? ('?' + qs) : ''));
        communityPlans = await res.json();
    } catch(e) { console.error("Error fetching community plans:", e); }
}

function switchMobileTab(tabId) {
    // Only applies on mobile (when mobile tabs are visible)
    document.querySelectorAll('.m-tab').forEach(btn => btn.classList.remove('active'));
    const mTabs = document.querySelectorAll('.m-tab');
    if (tabId === 'sidebar' && mTabs.length > 0) mTabs[0].classList.add('active');
    else if (tabId === 'planView' && mTabs.length > 1) mTabs[1].classList.add('active');
    else if (tabId === 'mapView' && mTabs.length > 2) mTabs[2].classList.add('active');

    const sidebar = document.getElementById('mobileSidebar');
    const planView = document.getElementById('planView');
    const viewBoard = document.getElementById('viewBoard');
    const mapView = document.getElementById('mapView');

    sidebar.classList.remove('m-active');
    sidebar.classList.remove('mobile-overlay');
    planView.classList.remove('m-active');
    viewBoard.classList.remove('m-active');
    mapView.classList.remove('m-active');
    mapView.classList.remove('panel-open');
    
    isPanelOpen = false;
    const icon = document.querySelector('#panelToggleBtn i');
    if(icon) icon.className = 'fas fa-chevron-right';

    if (tabId === 'sidebar') {
        sidebar.classList.add('m-active');
    } else if (tabId === 'planView') {
        if (currentDesktopView === 'plan-view') {
            viewBoard.classList.add('m-active');
        } else {
            planView.classList.add('m-active');
        }
    } else if (tabId === 'mapView') {
        mapView.classList.add('m-active');
        if(map) { setTimeout(() => map.invalidateSize(), 300); }
    }
}

// Store current desktop view state globally to sync with mobile tabs
let currentDesktopView = 'community';
let isPanelOpen = true;

function switchView(view) {
    currentDesktopView = view;
    const navPlan = document.getElementById('nav-plan');
    const navComm = document.getElementById('nav-community');
    const planView = document.getElementById('planView');
    const viewBoard = document.getElementById('viewBoard');
    const mapView = document.getElementById('mapView');
    const commView = document.getElementById('communityView');
    const myRoutesView = document.getElementById('myRoutesView');
    const navMyRoutes = document.getElementById('nav-my-routes');
    const navTalk = document.getElementById('nav-talk');
    const navProfile = document.getElementById('nav-profile');
    const talkView = document.getElementById('talkView');
    const profileView = document.getElementById('profileView');
    const sidebar = document.querySelector('.sidebar');

    // 모든 상단 네비 활성 해제 + 단독 뷰 기본 숨김(각 분기에서 필요 시 표시)
    [navPlan, navComm, navTalk, navProfile, navMyRoutes].forEach(n => n && n.classList.remove('active'));
    if (talkView) talkView.style.display = 'none';
    if (profileView) profileView.style.display = 'none';

    // 여행 톡 / 내 정보: 전체 폭 단독 뷰
    if (view === 'talk' || view === 'profile') {
        planView.style.display = 'none';
        if (viewBoard) viewBoard.style.display = 'none';
        mapView.style.display = 'none';
        sidebar.style.display = 'none';
        commView.style.display = 'none';
        if (myRoutesView) myRoutesView.style.display = 'none';
        const mobileTabs0 = document.querySelector('.mobile-tabs');
        if (mobileTabs0) mobileTabs0.style.display = 'none';
        if (view === 'talk') {
            if (navTalk) navTalk.classList.add('active');
            if (talkView) talkView.style.display = 'block';
            backToTalkList();
            renderTalk();
        } else {
            if (navProfile) navProfile.classList.add('active');
            if (profileView) profileView.style.display = 'block';
            renderProfile();
        }
        return;
    }

    if (view === 'plan-edit') {
        navPlan.classList.add('active');
        navComm.classList.remove('active');
        planView.style.display = isPanelOpen ? 'flex' : 'none';
        if(viewBoard) viewBoard.style.display = 'none';
        mapView.style.display = 'flex';
        sidebar.style.display = isPanelOpen ? 'flex' : 'none';
        commView.style.display = 'none';
        if(myRoutesView) myRoutesView.style.display = 'none';
        
        // Sync mobile active class
        document.querySelectorAll('.m-tab').forEach(btn => btn.classList.remove('active'));
        const mTabs = document.querySelectorAll('.m-tab');
        if(mTabs.length > 1) mTabs[1].classList.add('active');
        sidebar.classList.remove('m-active');
        mapView.classList.remove('m-active');
        planView.classList.add('m-active');
        if(viewBoard) viewBoard.classList.remove('m-active');
        
        const mobileTabs = document.querySelector('.mobile-tabs');
        if(mobileTabs) mobileTabs.style.display = '';

        if(map) { setTimeout(() => map.invalidateSize(), 300); }
    } else if (view === 'plan-view') {
        navPlan.classList.add('active');
        navComm.classList.remove('active');
        planView.style.display = 'none';
        if(viewBoard) viewBoard.style.display = isPanelOpen ? 'flex' : 'none';
        mapView.style.display = 'flex';
        sidebar.style.display = isPanelOpen ? 'flex' : 'none';
        commView.style.display = 'none';
        if(myRoutesView) myRoutesView.style.display = 'none';
        
        // Sync mobile active class
        document.querySelectorAll('.m-tab').forEach(btn => btn.classList.remove('active'));
        const mTabs = document.querySelectorAll('.m-tab');
        if(mTabs.length > 1) mTabs[1].classList.add('active');
        sidebar.classList.remove('m-active');
        mapView.classList.remove('m-active');
        planView.classList.remove('m-active');
        if(viewBoard) viewBoard.classList.add('m-active');
        
        const mobileTabs = document.querySelector('.mobile-tabs');
        if(mobileTabs) mobileTabs.style.display = '';

        // Populate view board summary
        const desc = document.getElementById('planDescription').value;
        document.getElementById('viewPlanDescription').textContent = desc || '등록된 설명이 없습니다.';
        
        document.getElementById('viewTotalMoveTime').textContent = document.getElementById('totalMoveTime').textContent;
        document.getElementById('viewTotalStayTime').textContent = document.getElementById('totalStayTime').textContent;
        document.getElementById('viewTotalTime').textContent = document.getElementById('totalTime').textContent;
        document.getElementById('viewTotalCost').textContent = document.getElementById('totalCost').textContent;

        // Populate nearby routes
        const nearbyList = document.getElementById('nearbyRoutesList');
        if(nearbyList && communityPlans.length > 0) {
            nearbyList.innerHTML = '';
            communityPlans.slice(0, 3).forEach(p => {
                const safeTitle = p.title.replace(/'/g, "\\'").replace(/"/g, '"');
                const safeAuthor = p.author.replace(/'/g, "\\'").replace(/"/g, '"');
                const safeDesc = (p.description || '').replace(/'/g, "\\'").replace(/"/g, '"').replace(/\n/g, '<br>');
                const safePlaces = p.items ? p.items.map(i => i.name).join(' ➔ ').replace(/'/g, "\\'").replace(/"/g, '"') : '';
                nearbyList.innerHTML += `
                    <div style="padding:10px; border:1px solid #dadce0; border-radius:4px; cursor:pointer; background:#fff;" onclick="openCommunityPlanModal(${p.id}, '${safeTitle}', '${safeAuthor}', ${p.avg_rating}, '${safeDesc}', '${safePlaces}')">
                        <strong>${p.title}</strong><br>
                        <span style="font-size:0.8rem; color:#666;">평점 <i class="fas fa-star" style="color: gold;"></i> ${p.avg_rating.toFixed(1)} | 작성자: ${p.author}</span>
                    </div>
                `;
            });
        }
        
        // Render view timeline
        renderViewTimeline();
        updateViewDayTabs();
    } else {
        // 커뮤니티 피드
        navPlan.classList.remove('active');
        planView.style.display = 'none';
        if(viewBoard) viewBoard.style.display = 'none';
        mapView.style.display = 'none';
        sidebar.style.display = 'none';
        if(myRoutesView) myRoutesView.style.display = 'none';

        navComm.classList.add('active');
        commView.style.display = 'block';
        
        // 여행 홈: 카테고리 탭 기반 탐색(추천/인기/검색) 렌더링
        enterHome();

        sidebar.classList.remove('m-active');
        mapView.classList.remove('m-active');
        planView.classList.remove('m-active');
        if(viewBoard) viewBoard.classList.remove('m-active');

        const mobileTabs = document.querySelector('.mobile-tabs');
        if(mobileTabs) mobileTabs.style.display = 'none';
    }
}

// Leaflet Map Initialization
function initMap() {
    // 만약 이미 초기화된 지도가 있다면 제거
    const container = L.DomUtil.get('map');
    if(container != null){
        container._leaflet_id = null;
    }

    map = L.map('map').setView([37.566826, 126.978656], 13); // Seoul City Hall
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // CSS 렌더링 이후 크기 업데이트 보장
    setTimeout(() => {
        map.invalidateSize();
    }, 500);
}

// Update markers on map
async function updateMapMarkers() {
    if(!map) return;
    
    // Clear existing
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if(polyline) map.removeLayer(polyline);

    if(planItems.length === 0) return;

    const bounds = L.latLngBounds();

    planItems.forEach((item, idx) => {
        const position = [item.lat, item.lng];
        bounds.extend(position);

        const numberIcon = L.divIcon({
            className: 'custom-number-marker',
            html: `<div style="background-color: #1a73e8; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3); font-size: 14px;">${idx + 1}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14]
        });

        const marker = L.marker(position, { icon: numberIcon }).addTo(map)
            .bindPopup(`<b>${idx + 1}. ${item.name}</b>`);
        
        markers.push(marker);
    });

    if (planItems.length > 1) {
        const coords = planItems.map(item => `${item.lng},${item.lat}`).join(';');
        let pathCoords = [];
        try {
            const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
            const data = await res.json();
            if (data.routes && data.routes.length > 0) {
                pathCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            }
        } catch(e) {
            console.error("Routing error:", e);
        }

        if (pathCoords.length === 0) {
            pathCoords = planItems.map(item => [item.lat, item.lng]);
        }

        polyline = L.polyline(pathCoords, {
            color: '#4A90E2',
            weight: 4,
            opacity: 0.8
        }).addTo(map);

        // Add simple direction indicators (arrows) along the path
        for (let i = 0; i < pathCoords.length - 1; i += Math.max(1, Math.floor(pathCoords.length / 10))) {
            const p1 = pathCoords[i];
            const p2 = pathCoords[Math.min(i + 1, pathCoords.length - 1)];
            if (p1[0] !== p2[0] || p1[1] !== p2[1]) {
                const angle = -(Math.atan2(p2[0] - p1[0], p2[1] - p1[1]) * 180 / Math.PI);
                const arrowIcon = L.divIcon({
                    className: 'path-arrow',
                    html: `<div style="transform: rotate(${angle}deg); font-size: 16px; color: #1a73e8; text-shadow: 1px 1px 2px white; text-align: center; line-height: 20px;">➤</div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                const arrowMarker = L.marker(p1, { icon: arrowIcon, interactive: false }).addTo(map);
                markers.push(arrowMarker); // Store in markers array to clear them later
            }
        }
    }

    map.fitBounds(bounds, { padding: [50, 50] });
}

// AI Tagging Simulation
function generateAITags(place) {
    const tags = new Set(place.tags || []);
    const name = (place.name || '').toLowerCase();
    const cat = place.category || '';
    
    if(['공항', '역', '병원', '호텔', '마트', '백화점', '쇼핑몰', '터미널', '타워', '빌딩', '시장', '몰', '센터'].some(k => name.includes(k))) {
        tags.add('wheelchair');
        tags.add('elevator');
        tags.add('parking');
    }
    if(['식당', '교자', '레스토랑', '카페', '맛집', '음식', '제과', '버거', '피자'].some(k => name.includes(k)) || cat === 'restaurant') {
        tags.add('wheelchair');
    }
    if(['공원', '유원지', '랜드', '궁', '전', '관', '산', '해수욕장', '수목원', '명소', '관광지', '뮤지엄', '박물관', '미술관'].some(k => name.includes(k)) || cat === 'attraction') {
        tags.add('stroller');
        tags.add('wheelchair');
        tags.add('parking');
    }
    // 기본적으로 랜덤한 확률로 엘리베이터나 휠체어 태그 추가 (AI 추론 시뮬레이션)
    if(Math.random() > 0.6) tags.add('wheelchair');
    if(Math.random() > 0.7) tags.add('elevator');
    
    return Array.from(tags);
}

// Search function
async function searchPlaces() {
    let query = searchInput.value.trim();
    
    // Get active categories
    const activeFilters = Array.from(document.querySelectorAll('.filter-btn.active')).map(btn => btn.dataset.category);
    
    searchResults.innerHTML = '<div class="place-item skeleton">검색 중...</div>';
    
    if (!query) {
        // 빈 검색 + 카테고리(맛집/관광/숙소) → 현재 보는 지도 중심 500m 안의 모든 해당 장소를 OSM에서
        const geoCats = activeFilters.filter(c => ['restaurant', 'attraction', 'accommodation'].includes(c));
        if (geoCats.length > 0 && map) {
            const c = map.getCenter();
            searchResults.innerHTML = '<div class="place-item skeleton">지도 중심 500m 내 장소 찾는 중...</div>';
            try {
                const res = await fetch(`/api/nearby?lat=${c.lat}&lng=${c.lng}&radius=500&category=${geoCats.join(',')}`);
                let results = await res.json();
                if (!Array.isArray(results)) results = [];
                // 휠체어 필터가 함께 켜져 있으면 휠체어 태그만
                if (activeFilters.includes('wheelchair')) results = results.filter(p => (p.tags || []).includes('wheelchair'));
                displayPlaces(results);
            } catch (e) {
                searchResults.innerHTML = '<div class="place-item skeleton">주변 장소를 불러오지 못했습니다.</div>';
            }
            return;
        }

        let filtered = allPlaces;
        if (!activeFilters.includes('all') && activeFilters.length > 0) {
            filtered = allPlaces.filter(p => {
                let match = false;
                if(activeFilters.includes('restaurant') && p.category === 'restaurant') match = true;
                if(activeFilters.includes('attraction') && p.category === 'attraction') match = true;
                if(activeFilters.includes('accommodation') && p.category === 'accommodation') match = true;
                if(activeFilters.includes('wheelchair') && p.tags && p.tags.includes('wheelchair')) match = true;
                return match;
            });
        }
        displayPlaces(filtered);
        return;
    }

    // 태그(관광/숙소/맛집)를 켠 채로 지역명을 검색하면 → 그 지역에 있는 해당 카테고리 장소 전부
    //   예) [관광] + "잠실"  → 잠실의 관광지들 / [숙소] + "서울" → 서울의 숙소들(중심 가까운 상위 N)
    const geoCats = activeFilters.filter(c => ['restaurant', 'attraction', 'accommodation'].includes(c));
    if (geoCats.length > 0) {
        await areaTagSearch(query, geoCats, activeFilters.includes('wheelchair'));
        return;
    }

    let searchQuery = query + ' 대한민국';

    // API Call
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        
        let rawPlaces = data.map(item => {
            let cat = 'searched';
            let itemType = (item.type || '').toLowerCase();
            let itemClass = (item.class || '').toLowerCase();
            let dispName = (item.display_name || '').toLowerCase();

            if (['restaurant', 'cafe', 'fast_food', 'food_court', 'bar'].includes(itemType) || dispName.includes('식당') || dispName.includes('맛집') || dispName.includes('카페')) cat = 'restaurant';
            else if (['hotel', 'guest_house', 'motel', 'hostel'].includes(itemType) || dispName.includes('호텔') || dispName.includes('숙소') || dispName.includes('모텔') || dispName.includes('펜션')) cat = 'accommodation';
            else if (['attraction', 'museum', 'theme_park', 'zoo', 'park', 'viewpoint', 'historic', 'palace', 'gate'].includes(itemType) || dispName.includes('관광지') || dispName.includes('공원') || dispName.includes('명소') || dispName.includes('궁') || dispName.includes('문')) cat = 'attraction';

            return {
                id: item.place_id,
                name: item.name || item.display_name.split(',')[0],
                address: item.display_name,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                category: cat,
                type: itemType,
                tags: []
            };
        });

        // ===== Aggressive Deduplication on Frontend (FR-301) =====
        // 목표: '경복궁', '광화문' 등 검색 시 부속 노드(매표소/출입구/주차장 등)와
        //       이름이 유사하고 1km 이내에 몰려있는 중복 노드를 모두 제거하고
        //       가장 대표적인 1개(attraction/historic/museum/palace 우선)만 남긴다.
        const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
        // 부속/시설성 노드는 검색 결과에서 완전히 제외
        const minorTypes = ['entrance', 'door', 'ticket', 'toilet', 'parking',
            'bus_stop', 'subway_entrance', 'platform', 'tree', 'bench',
            'waste_basket', 'information', 'vending_machine', 'bicycle_parking', 'fountain'];
        const minorNameHints = ['매표소', '출입구', '입구', '주차장', '화장실', '정류장',
            '안내소', '안내도', '출구', '쪽문', '후문', '주차'];
        // 핵심 검색어 토큰 (2글자 이상)
        const queryTokens = query.split(/\s+/).map(norm).filter(w => w.length >= 2);
        // 대표성 점수: 높을수록 대표 노드로 유지
        const repScore = (p) => {
            const repTypes = ['attraction', 'historic', 'museum', 'palace', 'tourism', 'park', 'theme_park', 'viewpoint'];
            let s = 0;
            if (p.category === 'attraction') s += 10;
            if (repTypes.includes(p.type)) s += 8;
            // 이름이 핵심 검색어와 정확히(또는 짧게) 일치할수록 대표일 확률이 높음
            const pn = norm(p.name);
            if (queryTokens.some(t => pn === t)) s += 6;
            // 이름이 짧을수록(부속어가 안 붙을수록) 대표일 확률이 높음
            s += Math.max(0, 25 - pn.length) * 0.2;
            return s;
        };

        let places = [];
        rawPlaces.forEach(p => {
            if (!p.name) return;
            const pNorm = norm(p.name);
            // 1차 필터: 부속 시설 타입/이름 제거
            if (minorTypes.includes(p.type)) return;
            if (minorNameHints.some(h => p.name.includes(h))) return;

            // 이 장소가 속한 핵심 검색어 토큰
            const pToken = queryTokens.find(t => pNorm.includes(t));

            let mergedIndex = -1;
            for (let i = 0; i < places.length; i++) {
                const ex = places[i];
                const exNorm = norm(ex.name);
                const dist = getDistanceFromLatLonInKm(ex.lat, ex.lng, p.lat, p.lng);
                if (dist >= 1.0) continue; // 반경 1km 밖이면 다른 장소로 취급

                // 그룹 조건 A: 두 이름이 동일한 핵심 검색어 토큰을 공유
                const shareQueryToken = pToken && exNorm.includes(pToken);
                // 그룹 조건 B: 한 쪽 이름이 다른 쪽 이름을 포함 (공백/대소문자 무시)
                const nameContains = exNorm.includes(pNorm) || pNorm.includes(exNorm);

                if (shareQueryToken || nameContains) {
                    mergedIndex = i;
                    break;
                }
            }

            if (mergedIndex === -1) {
                p.tags = [...new Set([...(p.tags || []), ...generateAITags(p)])];
                places.push(p);
            } else {
                // 중복 그룹: 더 대표적인 노드만 유지
                if (repScore(p) > repScore(places[mergedIndex])) {
                    p.tags = [...new Set([...(p.tags || []), ...generateAITags(p)])];
                    places[mergedIndex] = p;
                }
                // 그 외(덜 대표적) 노드는 완전히 Drop
            }
        });

        // If external API returns no results, fallback to local search
        if (places.length === 0) {
            let localFallback = allPlaces.filter(p => p.name.includes(query) || p.address.includes(query) || (query === '관광' && p.category === 'attraction') || (query === '맛집' && p.category === 'restaurant') || (query === '숙소' && p.category === 'accommodation'));
            places = localFallback;
        }

        // Filter based on selected categories
        if (!activeFilters.includes('all') && activeFilters.length > 0) {
            places = places.filter(p => {
                let match = false;
                if(activeFilters.includes('restaurant') && p.category === 'restaurant') match = true;
                if(activeFilters.includes('attraction') && p.category === 'attraction') match = true;
                if(activeFilters.includes('accommodation') && p.category === 'accommodation') match = true;
                if(activeFilters.includes('wheelchair') && p.tags && p.tags.includes('wheelchair')) match = true;
                return match;
            });
        }
        
        displayPlaces(places);
    } catch(e) {
        console.error("Search error:", e);
        searchResults.innerHTML = '<div class="place-item skeleton">검색 오류가 발생했습니다.</div>';
    }
}

// Display places in sidebar
function displayPlaces(places) {
    searchResults.innerHTML = '';
    
    if (places.length === 0) {
        searchResults.innerHTML = '<div class="place-item skeleton">검색 결과가 없습니다.</div>';
        return;
    }

    places.forEach(place => {
        const item = document.createElement('div');
        item.className = 'place-item';
        
        let tagsHtml = '';
        if(place.tags.includes('wheelchair')) tagsHtml += '<span class="badge">휠체어</span>';
        if(place.tags.includes('elevator')) tagsHtml += '<span class="badge">엘리베이터</span>';
        if(place.tags.includes('parking')) tagsHtml += '<span class="badge">장애인주차</span>';

        // Add a hidden details container
        item.innerHTML = `
            <div class="place-header" style="cursor:pointer;">
                <h4>${place.name}</h4>
                <p>${place.address}</p>
                <div class="tags">${tagsHtml}</div>
            </div>
            <div class="place-details" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid #eee; font-size:0.9rem;">
                <div class="rating-info" style="font-weight:bold; margin-bottom:5px;">불러오는 중...</div>
                <div class="similar-info" style="color:#1a73e8; margin-bottom:10px;"></div>
                <button class="btn-primary btn-add-plan" style="width:100%; padding:5px;">일정에 추가</button>
            </div>
        `;
        
        const header = item.querySelector('.place-header');
        const details = item.querySelector('.place-details');
        const addBtn = item.querySelector('.btn-add-plan');

        header.addEventListener('click', () => {
            // Toggle details
            const isExpanded = details.style.display === 'block';
            
            // Close all other details
            document.querySelectorAll('.place-details').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.place-item').forEach(el => el.style.borderLeft = 'none');
            
            if (!isExpanded) {
                details.style.display = 'block';
                item.style.borderLeft = '4px solid #1a73e8';
                
                // Show on Map
                if(map) {
                    map.setView([place.lat, place.lng], 15);
                    // Add temporary search marker
                    if(window.searchMarker) {
                        map.removeLayer(window.searchMarker);
                    }
                    window.searchMarker = L.marker([place.lat, place.lng]).addTo(map)
                        .bindPopup(`<b>${place.name}</b><br>검색된 장소`).openPopup();
                }

                // Fetch Details
                fetchMockPlaceDetailsForSidebar(place, details);
            }
        });

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPlaceModal(place);
        });

        searchResults.appendChild(item);
    });
}

// 카테고리(태그) 한글 라벨
const AREA_CAT_LABEL = { attraction: '관광지', accommodation: '숙소', restaurant: '맛집' };

// 태그 + 지역명 검색: 그 지역(시/구/동)에 있는 해당 카테고리 장소를 중심 거리순 상위 N개로 보여준다.
async function areaTagSearch(query, cats, wheelchairOnly, limit = 60) {
    searchResults.innerHTML = `<div class="place-item skeleton">'${query}' 지역의 장소를 찾는 중...</div>`;
    try {
        const responses = await Promise.all(cats.map(cat =>
            fetch(`/api/area-search?q=${encodeURIComponent(query)}&category=${cat}&limit=${limit}`)
                .then(r => r.ok ? r.json() : null)
                .catch(() => null)
        ));
        const valid = responses.filter(Boolean);
        if (valid.length === 0) {
            searchResults.innerHTML = `<div class="place-item skeleton">'${query}' 지역의 장소를 불러오지 못했습니다.</div>`;
            return;
        }

        const areaName = (valid.find(v => v.area && v.area.name) || {}).area?.name || query;
        const seen = new Set();
        let merged = [];
        let hasMore = false;
        valid.forEach(v => {
            hasMore = hasMore || !!v.hasMore;
            (v.results || []).forEach(p => {
                if (seen.has(p.id)) return;
                seen.add(p.id);
                merged.push({ ...p, type: p.category, tags: Array.isArray(p.tags) ? p.tags : [] });
            });
        });
        if (wheelchairOnly) merged = merged.filter(p => p.tags.includes('wheelchair'));

        // 지역 중심으로 지도 이동(첫 결과 기준)
        if (map && merged.length > 0) {
            const v0 = valid.find(v => v.area);
            if (v0 && v0.area) map.setView([v0.area.lat, v0.area.lng], 14);
        }

        displayPlaces(merged);

        const labels = cats.map(c => AREA_CAT_LABEL[c] || c).join('·');
        const moreNote = hasMore ? ` <span style="color:#80868b; font-weight:normal;">· 중심에서 가까운 ${merged.length}곳</span>` : '';
        searchResults.insertAdjacentHTML('afterbegin',
            `<div style="padding:8px 6px; font-size:0.92rem; color:#202124; font-weight:600; border-bottom:1px solid #eee; margin-bottom:6px;">📍 ${areaName}의 ${labels} ${merged.length}곳${moreNote}</div>`);
    } catch (e) {
        searchResults.innerHTML = `<div class="place-item skeleton">지역 검색 실패: ${e.message}</div>`;
    }
}

async function fetchMockPlaceDetailsForSidebar(place, detailsContainer) {
    const ratingInfo = detailsContainer.querySelector('.rating-info');
    ratingInfo.innerHTML = '리뷰 데이터 불러오는 중...';

    try {
        const randomSkip = Math.floor(Math.random() * 300);
        const res = await fetch(`https://dummyjson.com/comments?limit=2&skip=${randomSkip}`);
        const data = await res.json();
        
        let reviewHtml = '';
        let totalRating = 0;
        
        data.comments.forEach(comment => {
            const rating = (comment.likes % 5) + 1; // 1~5
            totalRating += rating;
            reviewHtml += `<div style="padding: 2px 0; color:#555;">- <strong>${comment.user.fullName}</strong>: "${comment.body}"</div>`;
        });
        
        const avgRating = (totalRating / data.comments.length).toFixed(1);
        
        ratingInfo.innerHTML = `
            <div style="margin-bottom:5px;">평점: <span style="color:gold;">★</span> ${avgRating} (${data.comments.length}개 리뷰)</div>
            <div style="font-weight:normal; margin-bottom:10px;">${reviewHtml}</div>
        `;
    } catch (e) {
        console.error(e);
        ratingInfo.innerHTML = '리뷰 데이터를 불러올 수 없습니다.';
    }

    // Recommend Similar Nearby Places
    const similarPlaces = allPlaces.filter(p => p.id !== place.id && p.category === place.category);
    similarPlaces.forEach(p => {
        p.dist = getDistanceFromLatLonInKm(place.lat, place.lng, p.lat, p.lng);
    });
    similarPlaces.sort((a, b) => a.dist - b.dist);
    
    const topSimilar = similarPlaces.slice(0, 2);
    let similarHtml = '<div style="font-weight:bold; margin-bottom:3px; color:#333;">주변 유사 장소:</div>';
    
    if (topSimilar.length > 0) {
        topSimilar.forEach(p => {
            similarHtml += `<div>- ${p.name} (${p.dist.toFixed(1)}km)</div>`;
        });
    } else {
        similarHtml += '<div>- 근처에 비슷한 장소가 없습니다.</div>';
    }
    detailsContainer.querySelector('.similar-info').innerHTML = similarHtml;
}

// ============================================================
// 트리플 스타일: 카테고리/지역 분리 표기 + 장소 상세 사이드 패널
// ============================================================

// 카테고리 → 한글 라벨/아이콘/색상 (이름 휴리스틱 보강)
function categoryMeta(place) {
    const cat = (place.category || '').toLowerCase();
    const name = (place.name || '');
    const has = (re) => re.test(name);

    if (cat === 'accommodation' || has(/호텔|모텔|게스트|호스텔|리조트|펜션|숙소/)) return { label: '숙소', icon: 'fa-hotel', color: '#00897b' };
    if (has(/카페|커피|coffee|cafe|베이커리|디저트|스타벅스|스벅|투썸|이디야|메가커피|빽다방|폴바셋/i)) return { label: '카페', icon: 'fa-mug-hot', color: '#a0522d' };
    if (cat === 'restaurant' || has(/식당|맛집|레스토랑|음식|국밥|면|고기|횟집|분식/)) return { label: '맛집', icon: 'fa-utensils', color: '#e8710a' };
    if (has(/쇼핑|마트|시장|백화점|몰|아울렛|상가|면세|이마트|롯데|현대|신세계|코스트코|올리브영/)) return { label: '쇼핑', icon: 'fa-bag-shopping', color: '#d81b60' };
    if (cat === 'attraction' || has(/공원|궁|박물관|미술관|전망|타워|사찰|해변|섬|산/)) return { label: '관광명소', icon: 'fa-landmark', color: '#1a73e8' };
    return { label: '장소', icon: 'fa-location-dot', color: '#5f6368' };
}

// 주소(display_name)에서 지역명 추출: 구/시/군 우선
// 콤마 구분(Nominatim) 또는 공백 구분(한국 도로명 주소) 모두 처리
function deriveRegion(address) {
    if (!address) return '';
    const commaTokens = address.split(',').map(t => t.trim()).filter(Boolean);
    const spaceTokens = address.split(/\s+/).map(t => t.trim()).filter(Boolean);
    const tokens = [...commaTokens, ...spaceTokens];
    const bySuffix = (suffixes) => tokens.find(t => suffixes.some(s => t.endsWith(s) && t.length <= 10));
    return bySuffix(['구', '군']) || bySuffix(['시']) || bySuffix(['도']) || (commaTokens[1] || commaTokens[0] || '');
}

// 일정 아이템용: 카테고리 칩 + 지역명 HTML
function categoryRegionChips(item) {
    const m = categoryMeta(item);
    const region = deriveRegion(item.address);
    const chip = `<span style="display:inline-flex; align-items:center; gap:4px; background:${m.color}1a; color:${m.color}; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:10px;"><i class="fas ${m.icon}"></i> ${m.label}</span>`;
    const reg = region ? `<span style="color:#5f6368; font-size:0.78rem;"><i class="fas fa-map-marker-alt"></i> ${region}</span>` : '';
    return `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:4px 0 2px;">${chip}${reg}</div>`;
}

let pdMap = null;

function closePlaceDetail() {
    const panel = document.getElementById('placeDetailPanel');
    const backdrop = document.getElementById('placeDetailBackdrop');
    if (panel) { panel.style.transform = 'translateX(100%)'; panel.setAttribute('aria-hidden', 'true'); }
    if (backdrop) backdrop.style.display = 'none';
}

// 일정 내 장소 클릭 시 우측 상세 패널 열기
async function openPlaceDetail(item, index) {
    const panel = document.getElementById('placeDetailPanel');
    const backdrop = document.getElementById('placeDetailBackdrop');
    const content = document.getElementById('pdContent');
    if (!panel || !content) return;

    const m = categoryMeta(item);
    const region = deriveRegion(item.address);
    const photo = item.photo || '';

    // 골격 렌더(섹션은 비동기로 채움)
    content.innerHTML = `
        <div style="margin:0 -18px 14px;">
            ${photo
                ? `<img src="${photo}" style="width:100%; height:200px; object-fit:cover;">`
                : `<div style="width:100%; height:160px; background:linear-gradient(135deg, ${m.color}22, ${m.color}44); display:flex; align-items:center; justify-content:center; color:${m.color}; font-size:2.4rem;"><i class="fas ${m.icon}"></i></div>`}
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:6px;">
            <span style="display:inline-flex; align-items:center; gap:5px; background:${m.color}1a; color:${m.color}; font-size:0.78rem; font-weight:700; padding:3px 10px; border-radius:12px;"><i class="fas ${m.icon}"></i> ${m.label}</span>
            ${region ? `<span style="color:#5f6368; font-size:0.85rem;"><i class="fas fa-map-marker-alt"></i> ${region}</span>` : ''}
        </div>
        <h2 style="font-size:1.5rem; color:#202124; margin-bottom:6px; word-break:keep-all;">${item.name}</h2>
        <div id="pdRating" style="color:#5f6368; font-size:0.9rem; margin-bottom:16px;">평점 불러오는 중...</div>

        <div style="background:#f1f8f4; border:1px solid #cfe8d8; border-radius:12px; padding:14px; margin-bottom:18px;">
            <div style="font-weight:700; color:#137333; margin-bottom:8px;"><i class="fas fa-wheelchair"></i> 장애인 접근성 정보</div>
            <div id="pdAccess" style="font-size:0.9rem; color:#444;">불러오는 중...</div>
            <button onclick="openAccessReviewModal(${item.id}, '${(item.name||'').replace(/'/g, "\\'")}')" style="margin-top:10px; width:100%; padding:9px; border:1px solid #137333; background:#fff; color:#137333; border-radius:8px; font-weight:600; cursor:pointer;">접근성 후기 보기 / 남기기</button>
        </div>

        <h4 style="margin-bottom:8px;">기본 정보</h4>
        <div style="font-size:0.9rem; color:#444; margin-bottom:8px;"><i class="fas fa-location-dot" style="color:#1a73e8; width:18px;"></i> ${item.address || '주소 정보 없음'}</div>
        <div id="pdMiniMap" style="height:180px; border-radius:10px; overflow:hidden; background:#eceff1; margin-bottom:8px;"></div>
        <a href="https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}" target="_blank" rel="noopener" style="display:inline-block; font-size:0.85rem; color:#1a73e8; margin-bottom:18px;"><i class="fas fa-diamond-turn-right"></i> 길찾기 / 큰 지도에서 보기</a>

        ${item.memo ? `<h4 style="margin-bottom:8px;">메모</h4><p style="font-size:0.9rem; background:#f8f9fa; padding:10px; border-radius:8px; margin-bottom:18px;">${item.memo}</p>` : ''}

        <h4 style="margin-bottom:8px;">리뷰</h4>
        <div id="pdReviews" style="font-size:0.9rem; color:#444; margin-bottom:18px;">불러오는 중...</div>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button onclick="(function(){ closePlaceDetail(); if(map){ map.setView([${item.lat},${item.lng}],16); } })()" style="flex:1; min-width:120px; padding:11px; border:none; background:#1a73e8; color:#fff; border-radius:8px; font-weight:600; cursor:pointer;"><i class="fas fa-map"></i> 지도에서 보기</button>
            ${typeof index === 'number' ? `<button onclick="closePlaceDetail(); editPlace(${index})" style="flex:1; min-width:90px; padding:11px; border:1px solid #dadce0; background:#fff; color:#202124; border-radius:8px; font-weight:600; cursor:pointer;">수정</button>
            <button onclick="closePlaceDetail(); removePlace(${index})" style="flex:1; min-width:90px; padding:11px; border:1px solid #d93025; background:#fff; color:#d93025; border-radius:8px; font-weight:600; cursor:pointer;">삭제</button>` : ''}
        </div>
    `;

    // 패널 열기
    if (backdrop) backdrop.style.display = 'block';
    panel.style.transform = 'translateX(0)';
    panel.setAttribute('aria-hidden', 'false');
    panel.scrollTop = 0;

    // 미니 지도
    const mapDiv = document.getElementById('pdMiniMap');
    if (mapDiv && item.lat && item.lng) {
        if (pdMap) { pdMap.remove(); pdMap = null; }
        mapDiv._leaflet_id = null;
        pdMap = L.map(mapDiv, { zoomControl: false, attributionControl: false }).setView([item.lat, item.lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(pdMap);
        L.marker([item.lat, item.lng]).addTo(pdMap);
        setTimeout(() => pdMap.invalidateSize(), 300);
    }

    // 접근성 정보(우리 앱의 강점)
    loadPlaceDetailAccess(item.id);
    // 평점 + 리뷰(mock)
    loadPlaceDetailReviews(item);
}

async function loadPlaceDetailAccess(placeId) {
    const el = document.getElementById('pdAccess');
    if (!el) return;
    try {
        const data = await (await fetch(`/api/accessibility/reviews?place_id=${placeId}`)).json();
        const labelMap = {};
        (ACCESS_TAG_OPTIONS || []).forEach(o => labelMap[o.key] = o.label);
        const chips = Object.entries(data.tagCounts || {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, c]) => `<span style="background:#e6f4ea; color:#137333; padding:3px 9px; border-radius:12px; font-size:0.78rem; font-weight:600; display:inline-block; margin:2px;">${labelMap[k] || k} ${c}</span>`)
            .join('');
        if (data.count === 0) {
            el.innerHTML = '아직 접근성 후기가 없습니다. 첫 후기를 남겨 다른 이용자를 도와주세요.';
        } else {
            const first = data.reviews[0];
            el.innerHTML = `<div style="margin-bottom:6px;">접근성 후기 <strong>${data.count}건</strong></div>
                <div style="margin-bottom:6px;">${chips || '<span style="color:#888;">등록된 편의 태그 없음</span>'}</div>
                ${first && first.comment ? `<div style="color:#555; font-size:0.85rem;">"${first.comment}" — ${first.username || '익명'}</div>` : ''}`;
        }
    } catch (e) {
        el.innerHTML = '<span style="color:#888;">접근성 정보를 불러오지 못했습니다.</span>';
    }
}

async function loadPlaceDetailReviews(item) {
    const ratingEl = document.getElementById('pdRating');
    const reviewsEl = document.getElementById('pdReviews');
    try {
        const skip = Math.abs((item.id || 1)) % 300;
        const data = await (await fetch(`https://dummyjson.com/comments?limit=3&skip=${skip}`)).json();
        let total = 0;
        const rows = (data.comments || []).map(c => {
            const r = (c.likes % 5) + 1; total += r;
            return `<div style="padding:8px 0; border-bottom:1px solid #f0f0f0;"><strong>${c.user.fullName}</strong> <span style="color:#fbbc04;">${'★'.repeat(r)}</span><br><span style="color:#555;">${c.body}</span></div>`;
        }).join('');
        const avg = data.comments && data.comments.length ? (total / data.comments.length).toFixed(1) : '0.0';
        if (ratingEl) ratingEl.innerHTML = `<span style="color:#fbbc04; font-weight:700;">★ ${avg}</span> <span style="color:#888;">(${(data.comments || []).length}개 리뷰)</span>`;
        if (reviewsEl) reviewsEl.innerHTML = rows || '<span style="color:#888;">등록된 리뷰가 없습니다.</span>';
    } catch (e) {
        if (ratingEl) ratingEl.innerHTML = '<span style="color:#888;">평점 정보 없음</span>';
        if (reviewsEl) reviewsEl.innerHTML = '<span style="color:#888;">리뷰를 불러오지 못했습니다.</span>';
    }
}

// Open Modal for adding a place
function openPlaceModal(place) {
    if (document.getElementById('viewBoard').style.display === 'flex') {
        if(confirm('새로운 장소를 추가하려면 루트 짜기 모드로 전환해야 합니다. 전환하시겠습니까?')) {
            switchView('plan-edit');
        } else {
            return;
        }
    }

    currentSelectedPlace = place;
    document.getElementById('modalPlaceName').textContent = place.name;
    
    // Open API Mock: Fetch Reviews and Ratings
    fetchMockPlaceDetails(place);

    // Apply AI Tags
    place.tags = generateAITags(place);

    // Reset form
    editingIndex = -1;
    document.getElementById('addPlaceBtn').textContent = '장소 등록';
    document.getElementById('stayTime').value = 60;
    document.getElementById('placeMemo').value = '';
    document.getElementById('transportMode').value = 'walk';
    document.getElementById('placePhoto').value = '';
    document.getElementById('placePhotoPreview').style.display = 'none';
    document.getElementById('placePhotoPreview').src = '';
    currentPlacePhotoData = '';
    document.querySelectorAll('.tag-checkbox input').forEach(cb => {
        cb.checked = place.tags.includes(cb.value);
    });

    modal.classList.add('active');
}

// Distance calculation
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2-lat1) * (Math.PI/180);
    const dLon = (lon2-lon1) * (Math.PI/180); 
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}

// Open API Mock fetching function
async function fetchMockPlaceDetails(place) {
    document.getElementById('placeAvgRating').textContent = '...';
    document.getElementById('placeReviewCount').textContent = '...';
    document.getElementById('placeReviewsList').innerHTML = '리뷰 불러오는 중...';

    try {
        // 실시간 리뷰(DummyJSON) — 동작하는 list 엔드포인트 사용(comments/random/3 은 404)
        const skip = Math.floor(Math.random() * 300);
        const res = await fetch(`https://dummyjson.com/comments?limit=3&skip=${skip}`);
        const data = await res.json();
        const comments = data.comments || [];

        let reviewHtml = '';
        let totalRating = 0;
        comments.forEach(comment => {
            const rating = (comment.likes % 5) + 1; // 1~5
            totalRating += rating;
            const who = (comment.user && comment.user.fullName) ? comment.user.fullName : (comment.user && comment.user.username) || '익명';
            reviewHtml += `<div style="padding: 3px 0; border-bottom: 1px dashed #ddd; font-size: 0.85rem;"><strong>${who}</strong>: <span style="color:gold;">${'★'.repeat(rating)}</span> "${comment.body}"</div>`;
        });

        const avgRating = comments.length ? (totalRating / comments.length).toFixed(1) : '-';
        document.getElementById('placeAvgRating').textContent = avgRating;
        document.getElementById('placeReviewCount').textContent = comments.length;
        document.getElementById('placeReviewsList').innerHTML = comments.length ? reviewHtml : '표시할 리뷰가 없습니다.';
    } catch (e) {
        document.getElementById('placeReviewsList').innerHTML = '리뷰를 불러올 수 없습니다.';
    }

    // 2. Recommend Similar Nearby Places
    const similarPlaces = allPlaces.filter(p => p.id !== place.id && p.category === place.category);
    
    // Calculate distance and sort
    similarPlaces.forEach(p => {
        p.dist = getDistanceFromLatLonInKm(place.lat, place.lng, p.lat, p.lng);
    });
    similarPlaces.sort((a, b) => a.dist - b.dist);
    
    const topSimilar = similarPlaces.slice(0, 2);
    let similarHtml = '';
    
    if (topSimilar.length > 0) {
        topSimilar.forEach(p => {
            similarHtml += `<div>- [${p.category === 'restaurant' ? '맛집' : p.category === 'attraction' ? '관광' : '숙소'}] ${p.name} (${p.dist.toFixed(1)}km)</div>`;
        });
    } else {
        similarHtml = '<div>- 근처에 비슷한 장소가 없습니다.</div>';
    }
    document.getElementById('placeSimilarList').innerHTML = similarHtml;
}

// Photo Input Event
let currentPlacePhotoData = '';
document.addEventListener('DOMContentLoaded', () => {
    const photoInput = document.getElementById('placePhoto');
    if (photoInput) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentPlacePhotoData = e.target.result;
                    const preview = document.getElementById('placePhotoPreview');
                    preview.src = currentPlacePhotoData;
                    preview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        });
    }
});

// Add place to plan array and update UI
function addPlaceToPlan() {
    const stayTime = parseInt(document.getElementById('stayTime').value);
    const memo = document.getElementById('placeMemo').value;
    const transportMode = document.getElementById('transportMode').value;
    
    // Get checked tags from modal
    const selectedTags = [];
    document.querySelectorAll('.tag-checkbox input:checked').forEach(cb => {
        selectedTags.push(cb.value);
    });

    if (editingIndex >= 0) {
        // Update existing item
        planItems[editingIndex].stayTime = stayTime;
        planItems[editingIndex].memo = memo;
        planItems[editingIndex].transportMode = transportMode;
        planItems[editingIndex].userTags = selectedTags;
        if (currentPlacePhotoData) {
            planItems[editingIndex].photo = currentPlacePhotoData;
        }
        
        // Update moveTime and moveCost based on distance and transport mode
        if (editingIndex > 0) {
            const prev = planItems[editingIndex - 1];
            const dist = getDistanceFromLatLonInKm(prev.lat, prev.lng, planItems[editingIndex].lat, planItems[editingIndex].lng);
            let time = 0;
            let cost = 0;
            
            if (transportMode === 'walk' || transportMode === 'wheelchair') time = Math.ceil(dist * 15);
            else if (transportMode === 'taxi') { time = Math.ceil(dist * 2) + 5; cost = 4800 + Math.ceil(dist * 1000); }
            else if (transportMode === 'bus') { time = Math.ceil(dist * 4) + 10; cost = 1500; }
            else if (transportMode === 'subway') { time = Math.ceil(dist * 1.5) + 10; cost = 1400; }
            
            planItems[editingIndex].moveTime = time;
            planItems[editingIndex].moveCost = cost;
        }
        
        editingIndex = -1;
    } else {
        // Add new item
        let time = 0;
        let cost = 0;
        const dayItemsBeforeAdd = planItems.filter(i => (i.day || 1) === currentDay);
        if (dayItemsBeforeAdd.length > 0) {
            const prev = dayItemsBeforeAdd[dayItemsBeforeAdd.length - 1];
            const dist = getDistanceFromLatLonInKm(prev.lat, prev.lng, currentSelectedPlace.lat, currentSelectedPlace.lng);
            
            if (transportMode === 'walk' || transportMode === 'wheelchair') time = Math.ceil(dist * 15);
            else if (transportMode === 'taxi') { time = Math.ceil(dist * 2) + 5; cost = 4800 + Math.ceil(dist * 1000); }
            else if (transportMode === 'bus') { time = Math.ceil(dist * 4) + 10; cost = 1500; }
            else if (transportMode === 'subway') { time = Math.ceil(dist * 1.5) + 10; cost = 1400; }
        }

        const newItem = {
            ...currentSelectedPlace,
            stayTime,
            memo,
            transportMode,
            userTags: selectedTags,
            moveTime: time, 
            moveCost: cost,
            photo: currentPlacePhotoData,
            day: currentDay
        };
        planItems.push(newItem);
    }

    savePlanToServer();
    updatePlanUI();
    modal.classList.remove('active');
}

async function savePlanToServer() {
    try {
        await fetch('/api/my_plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(planItems)
        });
    } catch(e) { console.error("Error saving plan:", e); }
}

// Update Plan Board UI
function updatePlanUI() {
    if (planItems.length === 0) {
        planTimeline.innerHTML = `
            <div class="empty-state">
                <p>장소를 추가하여 일정을 만들어보세요.</p>
            </div>
        `;
        // 일정이 비면 지도의 핀/동선도 비워야 한다(토글로 전부 제거한 경우 포함)
        updateMapMarkers();
        updateDayTabs();
        return;
    }

    planTimeline.innerHTML = '';
    let totalStayTime = 0;
    let totalMoveTime = 0;
    let totalCost = 0;

    const dayItems = planItems.filter(i => (i.day || 1) === currentDay);

    dayItems.forEach((item, index) => {

        // Dynamically recalculate moveTime and cost if not the first item
        if (index > 0) {
            const prev = dayItems[index - 1];
            const dist = getDistanceFromLatLonInKm(prev.lat, prev.lng, item.lat, item.lng);
            let time = 0;
            let cost = 0;
            
            if (item.transportMode === 'walk' || item.transportMode === 'wheelchair') time = Math.ceil(dist * 15);
            else if (item.transportMode === 'taxi') { time = Math.ceil(dist * 2) + 5; cost = 4800 + Math.ceil(dist * 1000); }
            else if (item.transportMode === 'bus') { time = Math.ceil(dist * 4) + 10; cost = 1500; }
            else if (item.transportMode === 'subway') { time = Math.ceil(dist * 1.5) + 10; cost = 1400; }
            
            item.moveTime = time;
            item.moveCost = cost;
        } else {
            item.moveTime = 0;
            item.moveCost = 0;
        }

        totalStayTime += item.stayTime;
        totalMoveTime += item.moveTime;
        totalCost += item.moveCost;

        // Transport Info (from previous to current)
        if (index > 0) {
            const transportDiv = document.createElement('div');
            transportDiv.className = 'transport-info';
            
            let modeName = '도보';
            if(item.transportMode === 'bus') modeName = '버스';
            if(item.transportMode === 'subway') modeName = '지하철';
            if(item.transportMode === 'taxi') modeName = '택시';
            if(item.transportMode === 'wheelchair') modeName = '휠체어';

            let moveTimeStr = `${item.moveTime}분`;
            if (item.moveTime >= 60) {
                const hours = Math.floor(item.moveTime / 60);
                const mins = item.moveTime % 60;
                moveTimeStr = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
            }

            transportDiv.innerHTML = `<span>[${modeName}] ${moveTimeStr} 소요 ${item.moveCost > 0 ? '(' + item.moveCost.toLocaleString() + '원)' : ''}</span>`;
            planTimeline.appendChild(transportDiv);
        }

        // Place Info
        const placeDiv = document.createElement('div');
        placeDiv.className = 'timeline-item';
        
        let tagsHtml = '';
        item.userTags.forEach(tag => {
            let tagName = tag;
            if(tag === 'wheelchair') tagName = '휠체어';
            if(tag === 'elevator') tagName = '엘리베이터';
            if(tag === 'parking') tagName = '주차장';
            if(tag === 'stroller') tagName = '유모차';
            tagsHtml += `<span class="badge">${tagName}</span>`;
        });

        placeDiv.innerHTML = `
            <h4>${index + 1}. ${item.name}</h4>
            ${categoryRegionChips(item)}
            <p style="font-size:0.85rem; color:#666; margin: 3px 0;">체류: ${item.stayTime}분</p>
            <div class="tags" style="margin-bottom: 5px;">${tagsHtml}</div>
            ${item.photo ? `<img src="${item.photo}" style="max-width: 100%; border-radius: 8px; margin-top: 5px;">` : ''}
            ${item.memo ? `<p style="font-size:0.85rem; background:#f8f9fa; padding:5px; border-radius:4px; margin-top:5px;">${item.memo}</p>` : ''}
            <div style="position:absolute; top:10px; right:10px; display:flex; gap:5px;">
                <button onclick="event.stopPropagation(); editPlace(${index})" style="background:none; border:none; color:#1a73e8; cursor:pointer; font-size:0.9rem;">수정</button>
                <button onclick="event.stopPropagation(); removePlace(${index})" style="background:none; border:none; color:#d93025; cursor:pointer; font-size:0.9rem;">삭제</button>
            </div>
        `;
        
        // Add click event: 우측 상세 패널 열기 + 지도 강조
        placeDiv.style.cursor = 'pointer';
        placeDiv.addEventListener('click', () => {
            const idx = planItems.indexOf(item);
            if (map && markers[idx]) {
                map.setView([item.lat, item.lng], 16);
                markers[idx].openPopup();
            }
            document.querySelectorAll('.timeline-item').forEach(el => el.style.borderLeft = 'none');
            placeDiv.style.borderLeft = '4px solid #1a73e8';
            openPlaceDetail(item, idx);
        });

        planTimeline.appendChild(placeDiv);
    });

    // Update Summary
    const totalTime = totalStayTime + totalMoveTime;
    let totalTimeStr = `${totalTime}분`;
    if (totalTime >= 60) {
        const h = Math.floor(totalTime / 60);
        const m = totalTime % 60;
        totalTimeStr = m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }

    document.getElementById('totalStayTime').textContent = totalStayTime;
    document.getElementById('totalMoveTime').textContent = totalMoveTime;
    document.getElementById('totalTime').textContent = totalTimeStr;
    document.getElementById('totalCost').textContent = totalCost.toLocaleString();

    updateMapMarkers();
    updateDayTabs();
}

function removePlace(index) {
    planItems.splice(index, 1);
    savePlanToServer();
    updatePlanUI();
}

// Edit Place
let editingIndex = -1;

function editPlace(index) {
    const item = planItems[index];
    editingIndex = index;
    currentSelectedPlace = item;
    
    document.getElementById('modalPlaceName').textContent = item.name + ' (수정)';
    document.getElementById('stayTime').value = item.stayTime;
    document.getElementById('placeMemo').value = item.memo || '';
    document.getElementById('transportMode').value = item.transportMode || 'walk';
    
    document.getElementById('placePhoto').value = '';
    currentPlacePhotoData = item.photo || '';
    if (currentPlacePhotoData) {
        document.getElementById('placePhotoPreview').src = currentPlacePhotoData;
        document.getElementById('placePhotoPreview').style.display = 'block';
    } else {
        document.getElementById('placePhotoPreview').style.display = 'none';
        document.getElementById('placePhotoPreview').src = '';
    }

    document.querySelectorAll('.tag-checkbox input').forEach(cb => {
        cb.checked = item.userTags.includes(cb.value);
    });

    document.getElementById('addPlaceBtn').textContent = '수정 완료';
    modal.classList.add('active');
}

// Community Rendering
function updateAuthUI() {
    const uiInfo = document.getElementById('userInfo');
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    if(currentUser) {
        uiInfo.textContent = `${currentUser.username} (${currentUser.role === 'admin' ? '관리자' : '일반'})`;
        uiInfo.style.display = 'inline';
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline';
        const myLi = document.getElementById('nav-my-routes-li');
        if(myLi) myLi.style.display = 'inline';
    } else {
        uiInfo.style.display = 'none';
        loginBtn.style.display = 'inline';
        logoutBtn.style.display = 'none';
        const myLi = document.getElementById('nav-my-routes-li');
        if(myLi) myLi.style.display = 'none';
    }
}

// Accessibility Score calculation
function calculateAccessScore(plan) {
    // 서버가 감점 모델(100 − Σ감점)로 계산한 점수가 있으면 그것을 사용 —
    // 상세 모달의 access-breakdown 점수와 카드 점수를 동일하게 맞춘다.
    if (typeof plan.access_score === 'number') return plan.access_score;
    // (폴백) 서버 점수가 없을 때만 옛 추정식 사용
    if(!plan.items || plan.items.length === 0) return 0;
    let score = 50 + (plan.avg_rating * 5); // Base score plus rating bonus
    if(plan.description && plan.description.includes('휠체어')) score += 10;
    if(plan.title && plan.title.includes('배리어프리')) score += 15;
    return Math.min(100, Math.floor(score));
}

// 커뮤니티 피드 / 전체 루트 그리드 공용 루트 카드 마크업
function feedCardHTML(plan) {
    const places = (plan.items || []).map(i => i.name).join(' ➔ ');
    const accessScore = (plan.accessScore != null) ? plan.accessScore : calculateAccessScore(plan);
    const scoreColor = accessScore >= 80 ? '#1a73e8' : accessScore >= 60 ? '#f29900' : '#d93025';

    let deleteBtn = '';
    if (currentUser && (currentUser.role === 'admin' || currentUser.id === plan.author_id)) {
        deleteBtn = `<button onclick="event.stopPropagation(); deletePlan(${plan.id})" class="btn-google btn-google-danger" style="padding: 6px 12px; font-size: 0.85rem;">삭제</button>`;
    }
    let reviewBtn = '';
    if (!currentUser || (currentUser && currentUser.id !== plan.author_id)) {
        const t = plan.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        reviewBtn = `<button onclick="event.stopPropagation(); openReviewModal(${plan.id}, '${t}')" class="btn-google btn-google-secondary" style="padding: 6px 12px; font-size: 0.85rem;">평가 남기기</button>`;
    }

    const safeTitle = plan.title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeAuthor = plan.author.replace(/'/g, "\\'").replace(/"/g, '&quot;');
    const safeDesc = (plan.description || '').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '<br>');
    const safePlaces = places.replace(/'/g, "\\'").replace(/"/g, '&quot;');

    return `
                <div class="community-card feed-card" style="cursor: pointer; position: relative; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 16px; overflow: hidden; background: #fff; transition: transform 0.2s;" onclick="openCommunityPlanModal(${plan.id}, '${safeTitle}', '${safeAuthor}', ${plan.avg_rating}, '${safeDesc}', '${safePlaces}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                    <div style="position: absolute; top: 15px; right: 15px; background: ${accessScore >= 80 ? '#e8f0fe' : accessScore >= 60 ? '#fef7e0' : '#fce8e6'}; color: ${scoreColor}; font-weight: bold; padding: 8px 16px; border-radius: 30px; border: 2px solid ${scoreColor}; display: flex; align-items: center; gap: 8px; z-index: 10; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <i class="fas fa-wheelchair"></i> 지수 ${accessScore}점
                    </div>
                    <div class="community-header" style="padding: 20px 20px 10px 20px;">
                        <div style="flex: 1; padding-right: 15px;">
                            <h3 class="community-title" style="font-size: 1.4rem; margin-bottom: 12px; color: #202124; word-break: keep-all;">${plan.title}</h3>
                            <div class="community-info" style="color: #5f6368; display: flex; align-items: center; font-size: 0.95rem; white-space: nowrap;">
                                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(plan.author)}&background=random&color=fff&rounded=true" style="width: 28px; height: 28px; vertical-align: middle; margin-right: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); flex-shrink: 0;">
                                <strong style="overflow: hidden; text-overflow: ellipsis;">${plan.author}</strong>
                            </div>
                        </div>
                        <div class="access-score-bar" style="margin-top: 40px; width: 90px; flex-shrink: 0;">
                            <div style="width:100%; height:8px; background:#eceff1; border-radius:6px; overflow:hidden;">
                                <div style="width:${accessScore}%; height:100%; background:linear-gradient(90deg, ${scoreColor}99, ${scoreColor}); border-radius:6px; transition:width 0.4s ease;"></div>
                            </div>
                        </div>
                    </div>
                    <div class="community-course" style="padding: 0 20px 15px 20px;">
                        <p style="margin-bottom: 15px; color: #444; line-height: 1.6; font-size: 0.95rem;">${(plan.description || '등록된 설명이 없습니다.').substring(0, 100)}${plan.description && plan.description.length > 100 ? '...' : ''}</p>
                        <div style="background: #f8f9fa; padding: 12px 15px; border-radius: 8px; color: #202124; font-weight: 500; font-size: 0.95rem; border: 1px solid #eee;">
                            <i class="fas fa-map-marker-alt" style="color: #1a73e8; margin-right: 5px;"></i> ${places}
                        </div>
                    </div>
                    <div style="padding: 12px 20px; background: #fafafa; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center;">
                        <span class="community-rating" style="font-weight: 600; color: #555; font-size: 0.95rem;">
                            <i class="fas fa-star" style="color: #fbbc04; margin-right: 3px;"></i> ${plan.avg_rating.toFixed(1)} <span style="font-weight: normal; color: #888;">(${plan.review_count}명)</span>
                        </span>
                        <div style="display:flex; gap: 8px;">
                            ${reviewBtn}
                            ${deleteBtn}
                        </div>
                    </div>
                </div>
            `;
}

// 전체 루트 보기: 팝업이 아니라 커뮤니티 피드 안에서 블로그형 그리드로 모든 루트를 펼쳐 보기
async function openAllRoutesView() {
    if (!communityPlans || communityPlans.length === 0) await fetchCommunityPlans();
    const grid = document.getElementById('allRoutesGrid');
    const view = document.getElementById('allRoutesView');
    const feed = document.getElementById('communityContainer');
    if (!grid || !view) return;
    const plans = [...communityPlans].sort((a, b) => b.id - a.id);
    plans.forEach(p => p.accessScore = calculateAccessScore(p));
    const countEl = document.getElementById('allRoutesViewCount');
    if (countEl) countEl.textContent = `(${plans.length})`;
    grid.innerHTML = plans.length ? plans.map(feedCardHTML).join('') : '<div style="color:#888;">등록된 루트가 없습니다.</div>';
    if (feed) feed.style.display = 'none';
    view.style.display = 'block';
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeAllRoutesView() {
    const view = document.getElementById('allRoutesView');
    const feed = document.getElementById('communityContainer');
    if (view) view.style.display = 'none';
    if (feed) feed.style.display = 'flex';
}

// Community Rendering
function renderCommunity() {
    const list = document.getElementById('communityContainer');
    if(!list) return;
    list.innerHTML = '';
    
    let filteredPlans = communityPlans;
    if(currentUser) {
        filteredPlans = communityPlans.filter(p => p.author_id !== currentUser.id);
    }

    // Filters
    const fw = document.getElementById('filterWheelchair') ? document.getElementById('filterWheelchair').checked : false;
    const fe = document.getElementById('filterElevator') ? document.getElementById('filterElevator').checked : false;
    const fp = document.getElementById('filterParking') ? document.getElementById('filterParking').checked : false;
    const fa = document.getElementById('filterAttraction') ? document.getElementById('filterAttraction').checked : false;
    const fr = document.getElementById('filterRestaurant') ? document.getElementById('filterRestaurant').checked : false;
    const fac = document.getElementById('filterAccommodation') ? document.getElementById('filterAccommodation').checked : false;

    if(fw || fe || fp || fa || fr || fac) {
        filteredPlans = filteredPlans.filter(p => {
            const text = (p.title + (p.description||'')).toLowerCase();
            const placesText = p.items ? p.items.map(i => (i.category||'') + ' ' + (i.name||'')).join(' ').toLowerCase() : '';
            let match = true;
            
            if(fw && !text.includes('휠체어')) match = false;
            if(fe && !text.includes('엘리베이터')) match = false;
            if(fp && !text.includes('주차장') && !text.includes('주차')) match = false;
            
            if(fa && !placesText.includes('attraction') && !placesText.includes('관광') && !placesText.includes('공원')) match = false;
            if(fr && !placesText.includes('restaurant') && !placesText.includes('맛집') && !placesText.includes('식당') && !placesText.includes('카페')) match = false;
            if(fac && !placesText.includes('accommodation') && !placesText.includes('숙소') && !placesText.includes('호텔')) match = false;
            
            return match;
        });
    }

    filteredPlans.forEach(p => p.accessScore = calculateAccessScore(p));

    // 추천 루트: 접근성 점수 높은 순, 같으면 평점 높은 순
    const recommendedPlans = [...filteredPlans]
        .sort((a, b) => b.accessScore - a.accessScore || b.avg_rating - a.avg_rating || b.id - a.id)
        .slice(0, 3);
        
    // 최근 등록 루트 (전체)
    const recentPlans = [...filteredPlans].sort((a, b) => b.id - a.id);

    const renderCards = (plansArray, title) => {
        if (plansArray.length === 0) return '';
        return `<h3 style="margin: 2rem 0 1rem 0; color: #202124;">${title}</h3>`
            + `<div class="community-list">`
            + plansArray.map(feedCardHTML).join('')
            + `</div>`;
    };

    list.innerHTML = renderCards(recommendedPlans, '추천 루트') + renderCards(recentPlans, '최근 등록 루트');
}

let currentReviewPlanId = null;

function openReviewModal(planId, planTitle) {
    if(!currentUser) {
        alert('로그인이 필요한 기능입니다.');
        return;
    }
    currentReviewPlanId = planId;
    document.getElementById('reviewPlanTitle').textContent = `[${planTitle}] 평가하기`;
    document.getElementById('reviewRating').value = '5';
    document.getElementById('reviewText').value = '';
    document.getElementById('reviewModal').classList.add('active');
}

document.getElementById('submitReviewBtn').addEventListener('click', async () => {
    if(!currentUser) return;
    const rating = document.getElementById('reviewRating').value;
    const review = document.getElementById('reviewText').value;

    try {
        const res = await fetch('/api/community/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plan_id: currentReviewPlanId,
                user_id: currentUser.id,
                rating: parseInt(rating),
                review: review
            })
        });
        if(res.ok) {
            alert('평가가 등록되었습니다!');
            document.getElementById('reviewModal').classList.remove('active');
            await fetchCommunityPlans();
            renderCommunity();
        }
    } catch(e) {
        console.error("Review error:", e);
    }
});

async function deletePlan(id) {
    if(!confirm('정말 이 일정을 삭제하시겠습니까?')) return;
    
    try {
        const res = await fetch(`/api/community/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                user_role: currentUser.role
            })
        });
        
        if(res.ok) {
            alert('삭제되었습니다.');
            await fetchCommunityPlans();
            renderCommunity();
        } else {
            alert('삭제 권한이 없거나 오류가 발생했습니다.');
        }
    } catch(e) {
        console.error("Delete error:", e);
    }
}

function saveToUndo() {
    undoStack.push(JSON.stringify(planItems));
    const btnUndo = document.getElementById('btnUndo');
    if(btnUndo) btnUndo.style.display = 'inline-block';
}

async function forkPlan(id, mode = 'append') {
    if (mode === 'overwrite') {
        if (!confirm('현재 작성 중인 내 일정이 모두 삭제되고 선택한 일정으로 덮어씌워집니다. 계속하시겠습니까?')) {
            return;
        }
    }

    try {
        const res = await fetch(`/api/community/${id}/details`);
        if(res.ok) {
            const data = await res.json();
            
            // Save current state to undo stack
            saveToUndo();
            
            if (mode === 'overwrite') {
                planItems = []; // Clear existing items
                currentDay = 1;
                maxDay = 1;
            }

            // Append items to currentDay
            for (let item of data.items) {
                // If appending and there are already items, calculate distance and time
                let moveTime = 0;
                let moveCost = 0;
                const dayItems = planItems.filter(i => (i.day || 1) === currentDay);
                if (dayItems.length > 0) {
                    const prev = dayItems[dayItems.length - 1];
                    const dist = getDistanceFromLatLonInKm(prev.lat, prev.lng, item.lat, item.lng);
                    const tm = item.transportMode || 'walk';
                    if (tm === 'walk' || tm === 'wheelchair') moveTime = Math.ceil(dist * 15);
                    else if (tm === 'taxi') { moveTime = Math.ceil(dist * 2) + 5; moveCost = 4800 + Math.ceil(dist * 1000); }
                    else if (tm === 'bus') { moveTime = Math.ceil(dist * 4) + 10; moveCost = 1500; }
                    else if (tm === 'subway') { moveTime = Math.ceil(dist * 1.5) + 10; moveCost = 1400; }
                }

                planItems.push({
                    ...item,
                    day: currentDay,
                    moveTime: moveTime,
                    moveCost: moveCost
                });
            }

            // (설명은 가져오지 않음 — 장소/동선만 복사)

            const cpModal = document.getElementById('communityPlanModal');
            if(cpModal) cpModal.classList.remove('active');
            
            await savePlanToServer();
            updateDayTabs();
            updatePlanUI();
            switchView('plan-edit');
            if (mode === 'overwrite') {
                alert(`새로운 일정으로 덮어씌워졌습니다!`);
            } else {
                alert(`${currentDay}일차에 루트가 이어서 추가되었습니다!`);
            }
        }
    } catch(e) {
        console.error("Fork error:", e);
    }
}

// ============================================================
// 루트 상세 "가져올 구성" 스테이징: 장소 검색/추천장소를 스톱 사이에 끼워넣기
//   - 모든 편집은 로컬 복사본(cpStageItems)에만 적용 → 공유된 원본 루트 불변
//   - "가져오기" 버튼을 눌러야 내 일정(planItems)에 반영
// ============================================================

// 삽입 위치 마커 한 줄(클릭하면 그 자리가 끼워넣기 지점이 됨)
function cpGapHTML(pos) {
    const active = (cpInsertPos === pos);
    return `<div onclick="setCpInsertPos(${pos})" title="여기에 끼워넣기" style="display:flex; align-items:center; gap:6px; padding:2px 4px; margin:1px 0; cursor:pointer; color:${active ? '#1a73e8' : '#bdc1c6'}; font-size:0.72rem; font-weight:${active ? '700' : '400'};">
        <span style="flex-shrink:0;">${active ? '▼ 여기에 끼워넣기' : '＋'}</span>
        <span style="flex:1; height:${active ? '2px' : '1px'}; background:${active ? '#1a73e8' : '#e8eaed'};"></span>
    </div>`;
}

// 스테이징 장소 목록 렌더(삽입 위치 마커 + 스톱 + 삭제/후기 버튼)
function renderCpStage() {
    const box = document.getElementById('cpModalPlaces');
    if (!box) return;
    if (cpInsertPos == null || cpInsertPos > cpStageItems.length) cpInsertPos = cpStageItems.length;
    renderCpTransit();      // 구간이 바뀌면 대중교통 안내도 갱신
    drawCpStageRoute();     // 미니맵 동선도 추가/삭제에 맞춰 갱신(도로 따라감)
    if (cpStageItems.length === 0) {
        box.innerHTML = cpGapHTML(0) + '<div style="color:#888; font-size:0.85rem; padding:6px 4px;">아직 장소가 없습니다. 위에서 검색하거나 추천 장소를 끼워넣어 보세요.</div>';
        return;
    }
    let html = '';
    cpStageItems.forEach((item, idx) => {
        html += cpGapHTML(idx);
        const photoHtml = item.photo ? `<div style="margin-top:5px;"><img src="${item.photo}" style="max-width: 100%; border-radius:4px;"></div>` : '';
        const safeName = (item.name || '').replace(/'/g, "\\'");
        const reviewBtn = item.id != null
            ? `<button onclick="openAccessReviewModal(${item.id}, '${safeName}')" style="flex-shrink:0; padding:5px 10px; border:1px solid #1a73e8; background:#fff; color:#1a73e8; border-radius:14px; font-size:0.76rem; font-weight:600; cursor:pointer;" aria-label="${item.name} 후기 보기">후기</button>`
            : '';
        html += `<div style="padding:9px 10px; background:#f1f3f4; border-radius:6px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
                <span style="flex:1; min-width:0;"><strong>${idx + 1}.</strong> ${item.name}${item._added ? ' <span style="font-size:0.68rem; background:#e6f4ea; color:#137333; padding:1px 6px; border-radius:8px;">추가됨</span>' : ''}${photoHtml}</span>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    ${reviewBtn}
                    <button onclick="cpRemoveStage(${idx})" title="빼기" style="padding:5px 9px; border:1px solid #d93025; background:#fff; color:#d93025; border-radius:14px; font-size:0.76rem; font-weight:600; cursor:pointer;">✕</button>
                </div>
            </div>`;
    });
    html += cpGapHTML(cpStageItems.length);
    box.innerHTML = html;
}

function setCpInsertPos(pos) {
    cpInsertPos = pos;
    renderCpStage();
}

function cpRemoveStage(idx) {
    cpStageItems.splice(idx, 1);
    if (cpInsertPos > cpStageItems.length) cpInsertPos = cpStageItems.length;
    renderCpStage();
}

// 이동 수단 선택 팝업: 도보/버스/지하철/택시 중 하나를 고르면 cb(mode) 호출
function askTransitMode(placeName, cb) {
    const prev = document.getElementById('transitModePicker');
    if (prev) prev.remove();
    const modes = [
        { key: 'walk', label: '도보', icon: 'fa-walking', color: '#5f6368' },
        { key: 'bus', label: '버스', icon: 'fa-bus', color: '#3d5bab' },
        { key: 'subway', label: '지하철', icon: 'fa-subway', color: '#00a2d1' },
        { key: 'taxi', label: '택시', icon: 'fa-taxi', color: '#f9ab00' }
    ];
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const overlay = document.createElement('div');
    overlay.id = 'transitModePicker';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:3000; display:flex; align-items:center; justify-content:center;';
    overlay.innerHTML = `<div style="background:#fff; border-radius:14px; padding:22px; width:340px; max-width:92vw; box-shadow:0 8px 30px rgba(0,0,0,.3);">
            <h3 style="margin:0 0 6px; font-size:1.1rem; color:#202124;"><i class="fas fa-route"></i> 이동 수단 선택</h3>
            <p style="margin:0 0 16px; font-size:0.88rem; color:#5f6368; line-height:1.4;"><strong>${esc(placeName)}</strong> 까지 어떻게 이동하나요?</p>
            <div id="tmpBtns" style="display:grid; grid-template-columns:1fr 1fr; gap:10px;"></div>
            <button id="tmpCancel" style="margin-top:14px; width:100%; padding:8px; border:none; background:#f1f3f4; color:#5f6368; border-radius:8px; font-size:0.85rem; cursor:pointer;">취소</button>
        </div>`;
    document.body.appendChild(overlay);
    const wrap = overlay.querySelector('#tmpBtns');
    modes.forEach(m => {
        const b = document.createElement('button');
        b.type = 'button';
        b.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:6px; padding:14px 8px; border:1.5px solid #dadce0; background:#fff; border-radius:10px; cursor:pointer; font-size:0.9rem; font-weight:600; color:#202124; transition:border-color .12s, background .12s;';
        b.onmouseover = () => { b.style.borderColor = m.color; b.style.background = '#f8f9ff'; };
        b.onmouseout = () => { b.style.borderColor = '#dadce0'; b.style.background = '#fff'; };
        b.innerHTML = `<i class="fas ${m.icon}" style="font-size:1.4rem; color:${m.color};"></i> ${m.label}`;
        b.onclick = () => { overlay.remove(); cb(m.key); };
        wrap.appendChild(b);
    });
    overlay.querySelector('#tmpCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// 검색/추천 결과의 장소를 현재 삽입 위치에 끼워넣기(스테이징에만 반영)
function cpInsertPlace(place) {
    if (!place) return;
    const pos = (cpInsertPos == null) ? cpStageItems.length : cpInsertPos;
    cpStageItems.splice(pos, 0, { ...place, _added: true });
    cpInsertPos = pos + 1;   // 다음 삽입은 방금 넣은 장소 뒤로
    renderCpStage();   // 스테이징 목록 + 대중교통 안내 + 미니맵 동선 갱신
}

// ============================================================
// 대중교통 안내: 이동 구간별 이동 수단(버스/지하철)에 맞춘 노선·도착 정보
//   - 실시간 교통 API가 없으므로 출발/도착지 이름 기반으로 '결정론적'으로 생성
//     (같은 루트를 열면 항상 같은 값 — 리렌더 때 흔들리지 않음)
// ============================================================
function _routeHash(s) {
    let h = 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
}

// 서울 지하철 호선 색상
const SUBWAY_LINE_COLORS = { 1: '#0d3692', 2: '#33a23d', 3: '#fe5d10', 4: '#00a2d1', 5: '#8b50a4', 6: '#c55c1d', 7: '#54640d', 8: '#e51c70', 9: '#aa9872' };

function _simBusInfo(a, b) {
    const h = _routeHash((a.name || '') + '→bus→' + (b.name || ''));
    const kinds = [
        { label: '간선', color: '#3d5bab', num: 100 + (h % 700) },        // 파란 간선(3자리)
        { label: '지선', color: '#5bb025', num: 1100 + (h % 8800) },       // 초록 지선(4자리)
        { label: '광역', color: '#c8102e', num: 'M' + (4100 + (h % 1800)) } // 빨간 광역(M버스)
    ];
    const t = kinds[h % 3];
    const arrive = 1 + (h % 12);                 // 1~12분 뒤
    const arrive2 = arrive + 5 + ((h >> 4) % 10);
    const stops = 2 + ((h >> 8) % 7);            // 2~8 정거장
    const left = 1 + ((h >> 12) % 8);            // 남은 좌석/혼잡 대용
    return { ...t, arrive, arrive2, stops, left };
}

function _simSubwayInfo(a, b) {
    const h = _routeHash((a.name || '') + '#sub#' + (b.name || ''));
    const line = 1 + (h % 9);                     // 1~9호선
    const arrive = 1 + (h % 9);                    // 1~9분 뒤
    const arrive2 = arrive + 3 + ((h >> 4) % 7);
    const stops = 2 + ((h >> 8) % 8);             // 2~9 정거장
    const dir = (h & 1) ? '상행' : '하행';
    const transfer = ((h >> 5) % 4 === 0);        // 가끔 환승 안내
    return { line, color: SUBWAY_LINE_COLORS[line], arrive, arrive2, stops, dir, transfer };
}

// ─────────────────────────────────────────────────────────────
// 교통 데이터 소스 어댑터(단일 교체 지점)
//   현재는 위의 시뮬레이션(_simBusInfo/_simSubwayInfo)을 그대로 사용한다.
//   추후 실시간 대중교통 API(ODsay/서울 TOPIS/TMap 등)로 바꿀 때는
//   이 객체의 bus()/subway()만 백엔드(/api/transit) 호출로 교체하면 되고,
//   반환 형태(bus: {num,label,color,arrive,arrive2,stops},
//             subway: {line,color,arrive,arrive2,stops,dir,transfer})만 맞추면
//   transitLegHTML 등 호출부는 손대지 않아도 된다.
// ─────────────────────────────────────────────────────────────
const TransitProvider = {
    bus(a, b) { return _simBusInfo(a, b); },
    subway(a, b) { return _simSubwayInfo(a, b); },
};

// 한 구간(a→b)의 이동 수단별 안내 카드 HTML
function transitLegHTML(a, b, mode) {
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = `<div style="font-size:0.74rem; color:#5f6368; margin-bottom:5px;">${esc(a.name)} <i class="fas fa-arrow-right" style="font-size:0.66rem;"></i> ${esc(b.name)}</div>`;
    let body = '';

    if (mode === 'bus') {
        const i = TransitProvider.bus(a, b);
        body = `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="display:inline-flex; align-items:center; gap:5px; background:${i.color}; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.82rem;"><i class="fas fa-bus"></i> ${i.num}번</span>
                <span style="font-size:0.74rem; color:#5f6368;">${i.label} · ${i.stops}정거장</span>
            </div>
            <div style="margin-top:6px; font-size:0.82rem; color:#202124;"><i class="far fa-clock" style="color:${i.color};"></i> <strong>${i.arrive}분 뒤</strong> 도착 <span style="color:#80868b;">· 다음 ${i.arrive2}분</span></div>`;
    } else if (mode === 'subway') {
        const i = TransitProvider.subway(a, b);
        body = `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span style="display:inline-flex; align-items:center; gap:5px; background:${i.color}; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.82rem;"><i class="fas fa-subway"></i> ${i.line}호선</span>
                <span style="font-size:0.74rem; color:#5f6368;">${i.dir} · ${i.stops}정거장${i.transfer ? ' · 환승 1회' : ''}</span>
            </div>
            <div style="margin-top:6px; font-size:0.82rem; color:#202124;"><i class="far fa-clock" style="color:${i.color};"></i> <strong>${i.arrive}분 뒤</strong> 도착 <span style="color:#80868b;">· 다음 ${i.arrive2}분</span></div>`;
    } else {
        const dist = (a.lat != null && b.lat != null) ? getDistanceFromLatLonInKm(a.lat, a.lng, b.lat, b.lng) : 0;
        if (mode === 'taxi') {
            const min = Math.max(3, Math.ceil(dist * 2) + 5);
            const cost = 4800 + Math.ceil(dist * 1000);
            body = `<div style="font-size:0.82rem; color:#202124;"><span style="display:inline-flex; align-items:center; gap:5px; background:#f9ab00; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.82rem;"><i class="fas fa-taxi"></i> 택시</span> <span style="margin-left:6px;">약 ${min}분 · ${cost.toLocaleString()}원</span></div>`;
        } else {
            const min = Math.max(1, Math.ceil(dist * 15));
            const label = (mode === 'wheelchair') ? '휠체어 이동' : '도보';
            const icon = (mode === 'wheelchair') ? 'fa-wheelchair' : 'fa-walking';
            body = `<div style="font-size:0.82rem; color:#202124;"><span style="display:inline-flex; align-items:center; gap:5px; background:#5f6368; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.82rem;"><i class="fas ${icon}"></i> ${label}</span> <span style="margin-left:6px;">약 ${min}분</span></div>`;
        }
    }
    return `<div style="border:1px solid #e8eaed; border-radius:10px; padding:10px 12px; background:#fff;">${head}${body}</div>`;
}

// ─────────────────────────────────────────────────────────────
// 실시간 대중교통(Tmap) — 백엔드 /api/transit 호출.
//   카드는 먼저 시뮬레이션(transitLegHTML)으로 즉시 그린 뒤,
//   실데이터가 도착하면 hydrateTransitCard가 같은 자리에 덮어쓴다(실패 시 그대로 유지=폴백).
// ─────────────────────────────────────────────────────────────
async function fetchRealTransit(a, b, mode) {
    if (a.lat == null || b.lat == null) return null;
    try {
        const url = `/api/transit?sx=${a.lng}&sy=${a.lat}&ex=${b.lng}&ey=${b.lat}&mode=${encodeURIComponent(mode || '')}`;
        const res = await fetch(url);
        if (res.status !== 200) return null;     // 204(무키/경로없음/실패) → 폴백
        const data = await res.json();
        if (!data || !Array.isArray(data.legs)) return null;
        // 버스/지하철 구간이 하나도 없으면(전부 도보) 실데이터 카드는 의미가 약함 → 폴백
        if (!data.legs.some(l => l.mode === 'bus' || l.mode === 'subway')) return null;
        return data;
    } catch (e) { return null; }
}

// Tmap 경로 데이터 → 구간 카드(전체 여정: 도보→버스/지하철→도보, 총 도착시간/환승/요금)
function realTransitCardHTML(a, b, data) {
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = `<div style="font-size:0.74rem; color:#5f6368; margin-bottom:6px; display:flex; align-items:center; gap:6px;">
            ${esc(a.name)} <i class="fas fa-arrow-right" style="font-size:0.66rem;"></i> ${esc(b.name)}
            <span style="margin-left:auto; font-size:0.62rem; background:#e8f0fe; color:#1a73e8; padding:1px 6px; border-radius:8px; font-weight:700;">실시간 Tmap</span>
        </div>`;
    const segs = data.legs.map(l => {
        if (l.mode === 'subway') {
            return `<span style="display:inline-flex; align-items:center; gap:5px; background:${l.color}; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.8rem;"><i class="fas fa-subway"></i> ${esc(l.line)}</span>${l.stops ? `<span style="font-size:0.72rem; color:#5f6368;">${l.stops}정거장</span>` : ''}`;
        }
        if (l.mode === 'bus') {
            return `<span style="display:inline-flex; align-items:center; gap:5px; background:${l.color}; color:#fff; font-weight:700; padding:3px 10px; border-radius:14px; font-size:0.8rem;"><i class="fas fa-bus"></i> ${esc(l.num)}번</span><span style="font-size:0.72rem; color:#5f6368;">${esc(l.label)}${l.stops ? ' · ' + l.stops + '정거장' : ''}</span>`;
        }
        return `<span style="font-size:0.72rem; color:#80868b; display:inline-flex; align-items:center; gap:3px;"><i class="fas fa-walking"></i> 도보 ${l.min}분</span>`;
    });
    const path = segs.join('<i class="fas fa-angle-right" style="color:#bdc1c6; font-size:0.7rem; margin:0 1px;"></i> ');
    const transferStr = data.transfers ? ` · 환승 ${data.transfers}회` : '';
    const fareStr = data.fare ? ` · ${data.fare.toLocaleString()}원` : '';
    const summary = `<div style="margin-top:7px; font-size:0.82rem; color:#202124;"><i class="far fa-clock" style="color:#1a73e8;"></i> <strong>약 ${data.totalTime}분 후</strong> 도착${transferStr}${fareStr}</div>`;
    return `<div style="border:1px solid #d2e3fc; border-radius:10px; padding:10px 12px; background:#fff;">${head}<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">${path}</div>${summary}</div>`;
}

// 시뮬레이션 카드(el 내용)를 실데이터로 업그레이드. 버스/지하철 구간에만 시도.
async function hydrateTransitCard(el, a, b, mode) {
    if (mode !== 'bus' && mode !== 'subway') return;
    const data = await fetchRealTransit(a, b, mode);
    if (data && el && el.isConnected) {
        el.innerHTML = realTransitCardHTML(a, b, data);
    }
}

// 스테이징 구성의 이동 구간별 대중교통 안내 렌더(미니맵 위)
function renderCpTransit() {
    const box = document.getElementById('cpTransitInfo');
    if (!box) return;
    if (!cpStageItems || cpStageItems.length < 2) {
        box.innerHTML = '<div style="color:#888; font-size:0.85rem;">장소가 2곳 이상일 때 구간별 대중교통을 안내합니다.</div>';
        return;
    }
    box.innerHTML = '';
    for (let i = 1; i < cpStageItems.length; i++) {
        const a = cpStageItems[i - 1], b = cpStageItems[i];
        const mode = b.transportMode || 'walk';
        const wrap = document.createElement('div');
        wrap.style.marginBottom = '8px';
        wrap.innerHTML = transitLegHTML(a, b, mode);   // 즉시 시뮬레이션
        box.appendChild(wrap);
        hydrateTransitCard(wrap, a, b, mode);          // 가능하면 실데이터로 교체
    }
}

// 스테이징 구성을 내 일정으로 가져오기(공유 루트는 변경하지 않음)
function importStagedToPlan(mode) {
    if (!currentUser) { alert('로그인이 필요합니다.'); return; }
    if (!cpStageItems || cpStageItems.length === 0) { alert('가져올 장소가 없습니다.'); return; }
    if (mode === 'overwrite' && !confirm('현재 작성 중인 내 일정이 모두 삭제되고 이 구성으로 덮어씌워집니다. 계속하시겠습니까?')) return;

    saveToUndo();
    if (mode === 'overwrite') { planItems = []; currentDay = 1; maxDay = 1; }
    cpStageItems.forEach(it => {
        const { _added, _routeSrc, ...clean } = it;
        // updatePlanUI 는 userTags/tags 가 배열이라고 가정 → 끼워넣은 장소엔 기본값 채움
        planItems.push({
            ...clean,
            tags: Array.isArray(clean.tags) ? clean.tags : [],
            userTags: Array.isArray(clean.userTags) ? clean.userTags : [],
            stayTime: clean.stayTime || 60,
            transportMode: clean.transportMode || 'walk',
            memo: clean.memo || '',
            day: currentDay, moveTime: 0, moveCost: 0
        });
    });
    updatePlanUI();
    updateDayTabs();
    savePlanToServer();
    document.getElementById('communityPlanModal').classList.remove('active');
    alert(mode === 'overwrite' ? '내 일정을 이 구성으로 덮어썼습니다!' : '내 일정에 이어 붙였습니다!');
    switchView('plan-edit');
}

function openCommunityPlanModal(id, title, author, rating, desc, places) {
    const plan = communityPlans.find(p => p.id === id);
    if (!plan) return;

    // 새 루트 카드 토글 세션 시작(이전에 이어 붙인 루트는 그대로 일정에 확정)
    resetRouteSelection();
    resetAccordions();
    // 끼워넣기 결과 안내 영역 초기화
    const cpSr = document.getElementById('cpSearchResults');
    if (cpSr) cpSr.innerHTML = '';

    document.getElementById('cpModalTitle').textContent = title;
    document.getElementById('cpModalAuthor').textContent = author;
    document.getElementById('cpModalRating').innerHTML = `평점 <i class="fas fa-star" style="color: gold;"></i> ${rating.toFixed(1)} (${plan.review_count}명)`;
    document.getElementById('cpModalDescription').innerHTML = desc || '등록된 설명이 없습니다.';

    // 루트 정보 = 가져올 구성(스테이징 복사본). 원본 공유 루트는 절대 바뀌지 않는다.
    cpStageRouteId = id;
    cpStageItems = [];
    cpInsertPos = null;
    const placesDiv = document.getElementById('cpModalPlaces');
    placesDiv.innerHTML = '<div style="color:#888; font-size:0.9rem;">불러오는 중...</div>';
    fetch(`/api/community/${id}/details`).then(r => r.json()).then(detail => {
        const items = (detail && detail.items) ? detail.items : [];
        cpStageItems = items.map(it => ({ ...it }));   // 로컬 편집용 복사본
        cpInsertPos = cpStageItems.length;             // 기본 삽입 위치 = 맨 끝
        renderCpStage();
    }).catch(() => {
        cpStageItems = (plan.items || []).map(it => ({ ...it }));
        cpInsertPos = cpStageItems.length;
        renderCpStage();
    });

    // Reviews list
    const reviewsDiv = document.getElementById('cpModalReviews');
    reviewsDiv.innerHTML = '';
    if(plan.reviews && plan.reviews.length > 0) {
        plan.reviews.forEach(r => {
            const stars = Array(r.rating).fill('★').join('');
            reviewsDiv.innerHTML += `<div style="font-size:0.9rem; padding:8px; border-bottom:1px solid #eee;"><strong>${r.username}</strong>: <span style="color:#f5a623;">${stars}</span> ${r.review}</div>`;
        });
    } else {
        reviewsDiv.innerHTML = '<div style="font-size:0.9rem; color:#666;">등록된 리뷰가 없습니다.</div>';
    }

    // Actions
    const actionsDiv = document.getElementById('cpModalActions');
    actionsDiv.innerHTML = '';
    actionsDiv.style.display = 'flex';
    actionsDiv.style.flexDirection = 'column';
    actionsDiv.style.gap = '12px';

    const actionButtonsContainer = document.createElement('div');
    actionButtonsContainer.style.display = 'flex';
    actionButtonsContainer.style.gap = '10px';
    actionButtonsContainer.style.width = '100%';

    const applyAppendBtn = document.createElement('button');
    applyAppendBtn.className = 'btn-google btn-google-primary';
    applyAppendBtn.style.flex = '1';
    applyAppendBtn.style.padding = '14px';
    applyAppendBtn.style.fontSize = '1rem';
    applyAppendBtn.textContent = '가져오기 (이어 붙이기)';
    applyAppendBtn.onclick = () => importStagedToPlan('append');
    actionButtonsContainer.appendChild(applyAppendBtn);

    const applyOverwriteBtn = document.createElement('button');
    applyOverwriteBtn.className = 'btn-google btn-google-danger';
    applyOverwriteBtn.style.flex = '1';
    applyOverwriteBtn.style.padding = '14px';
    applyOverwriteBtn.style.fontSize = '1rem';
    applyOverwriteBtn.textContent = '가져오기 (덮어쓰기)';
    applyOverwriteBtn.onclick = () => importStagedToPlan('overwrite');
    actionButtonsContainer.appendChild(applyOverwriteBtn);

    actionsDiv.appendChild(actionButtonsContainer);

    const utilButtonsContainer = document.createElement('div');
    utilButtonsContainer.style.display = 'flex';
    utilButtonsContainer.style.gap = '10px';
    utilButtonsContainer.style.justifyContent = 'flex-end';

    // 루트 평점은 상세 모달 안에서 바로 작성(별도 팝업 제거)
    renderRouteRatingForm(id, title, plan);

    if(currentUser && (currentUser.role === 'admin' || currentUser.id === plan.author_id)) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn-google btn-google-danger';
        delBtn.textContent = '삭제';
        delBtn.onclick = () => {
            document.getElementById('communityPlanModal').classList.remove('active');
            deletePlan(id);
        };
        actionsDiv.appendChild(delBtn);
    }

    document.getElementById('communityPlanModal').classList.add('active');

    // 이동 지수 감점 분석(미니 지도 포함) + 비슷한 동선 추천 + 추천 장소
    renderAccessBreakdown(id);
    renderSimilarRoutes(id);
    renderRecommendedRoutes(id);
    renderRecommendedPlaces(id);
}

// 상세 모달 안의 리뷰 목록 다시 그리기
function refreshCpReviews(plan) {
    const reviewsDiv = document.getElementById('cpModalReviews');
    if (!reviewsDiv) return;
    reviewsDiv.innerHTML = '';
    if (plan.reviews && plan.reviews.length > 0) {
        plan.reviews.forEach(r => {
            const stars = Array(r.rating).fill('★').join('');
            reviewsDiv.innerHTML += `<div style="font-size:0.9rem; padding:8px; border-bottom:1px solid #eee;"><strong>${r.username}</strong>: <span style="color:#f5a623;">${stars}</span> ${r.review}</div>`;
        });
    } else {
        reviewsDiv.innerHTML = '<div style="font-size:0.9rem; color:#666;">등록된 리뷰가 없습니다.</div>';
    }
}

// 루트 평점을 상세 모달 안에서 바로 작성하는 인라인 폼
let selectedRouteRating = 5;
function renderRouteRatingForm(planId, planTitle, plan) {
    const box = document.getElementById('cpModalRateForm');
    if (!box) return;
    // 작성자 본인은 자기 루트에 평가 불가
    if (currentUser && plan && currentUser.id === plan.author_id) { box.innerHTML = ''; return; }
    if (!currentUser) {
        box.innerHTML = '<div style="font-size:0.9rem; color:#888; background:#f8f9fa; padding:10px; border-radius:8px;">로그인 후 이 루트에 평점을 남길 수 있어요.</div>';
        return;
    }
    selectedRouteRating = 5;
    box.innerHTML = `
        <div style="border:1px solid #e0e0e0; border-radius:8px; padding:12px; background:#f8f9fa;">
            <div style="font-weight:700; margin-bottom:8px;">이 루트 평가하기</div>
            <div id="cpRateStars" style="display:flex; gap:4px; font-size:1.6rem; margin-bottom:8px;"></div>
            <textarea id="cpRateText" rows="2" placeholder="이 루트에 대한 평가를 남겨주세요." style="width:100%; padding:8px; border:1px solid #dadce0; border-radius:6px; resize:vertical; margin-bottom:8px; box-sizing:border-box;"></textarea>
            <button id="cpRateSubmit" class="btn-google btn-google-primary" style="width:100%; padding:10px;">평가 등록</button>
        </div>`;
    renderStarSelector(document.getElementById('cpRateStars'), () => selectedRouteRating, v => selectedRouteRating = v);
    document.getElementById('cpRateSubmit').onclick = async () => {
        const text = document.getElementById('cpRateText').value.trim();
        try {
            const res = await fetch('/api/community/review', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_id: planId, user_id: currentUser.id, rating: selectedRouteRating, review: text })
            });
            if (res.ok) {
                await fetchCommunityPlans();
                const updated = communityPlans.find(p => p.id === planId);
                if (updated) {
                    document.getElementById('cpModalRating').innerHTML =
                        `평점 <i class="fas fa-star" style="color: gold;"></i> ${(Number(updated.avg_rating) || 0).toFixed(1)} (${updated.review_count}명)`;
                    refreshCpReviews(updated);
                }
                renderCommunity();
                box.innerHTML = '<div style="font-size:0.92rem; color:#137333; background:#e6f4ea; padding:10px; border-radius:8px; font-weight:600;">평가가 등록되었습니다. 감사합니다!</div>';
            }
        } catch (e) { console.error('route review error', e); }
    };
}

// 비슷한 동선의 루트 패널 아래에 표시되는 "추천 장소"
// 현재 루트에 없는 장소 중 접근성이 좋은 곳을 서버에서 받아 카드로 렌더한다.
// 장소 평점/리뷰를 실시간으로 가져온다(앱의 기존 리뷰 소스인 dummyjson 활용).
async function fetchPlaceRating() {
    const skip = Math.floor(Math.random() * 280);
    const res = await fetch(`https://dummyjson.com/comments?limit=5&skip=${skip}`);
    const data = await res.json();
    let total = 0;
    const reviews = (data.comments || []).map(c => {
        const rating = (c.likes % 5) + 1; // 1~5
        total += rating;
        return { name: c.user.fullName, body: c.body, rating };
    });
    return { avg: reviews.length ? total / reviews.length : 0, reviews };
}

const RECOMMEND_MIN_RATING = 3.5;

// 동시 실행 개수를 제한해 순서대로 처리(외부 API throttle 방지)
async function mapLimit(items, limit, fn) {
    const ret = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) { const idx = i++; ret[idx] = await fn(items[idx], idx); }
    });
    await Promise.all(workers);
    return ret;
}

// 장소별 안정적 평점(2.8~5.0) — 장소 id/이름 기반이라 열 때마다 동일.
// (외부 리뷰 목업의 평점 분포가 너무 낮아 필터가 거의 다 걸러내므로, 필터/표시는 이 값으로)
function pseudoRating(p) {
    const s = String(p.id || p.name || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return Math.round((2.8 + (h % 221) / 100) * 10) / 10;
}

// 장소의 접근성 태그 추론(결정론적): 실제 tags + 이름/카테고리 휴리스틱
function inferAccessTags(p) {
    const set = new Set((p.tags || '').split(',').filter(Boolean));
    const name = p.name || '';
    const cat = p.category || '';
    if (/역|공항|병원|호텔|모텔|백화점|몰|마트|타워|센터|플라자|박물관|미술관|DDP|마트|아울렛/.test(name) || cat === 'accommodation') {
        set.add('wheelchair'); set.add('elevator'); set.add('parking');
    }
    if (/공원|궁|광장|시장|거리|마을|성당|길|천/.test(name) || cat === 'attraction') {
        set.add('wheelchair'); set.add('parking');
    }
    if (cat === 'restaurant' || /식당|맛집|카페|교자|삼계탕/.test(name)) {
        set.add('wheelchair');
    }
    return set;
}

async function renderRecommendedPlaces(planId) {
    const box = document.getElementById('cpModalRecommend');
    if (!box) return;
    box.innerHTML = '<div style="color:#888; font-size:0.9rem;">루트 주변 장소 찾는 중...</div>';

    // 1) 루트 주변(반경 내) 후보를 가까운 순으로 받는다
    let candidates;
    try {
        const res = await fetch(`/api/community/${planId}/recommended-places?radius=3&limit=21`);
        candidates = await res.json();
    } catch (e) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">추천 장소를 불러오지 못했습니다.</div>';
        return;
    }
    if (!Array.isArray(candidates) || candidates.length === 0) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">루트 주변에 등록된 장소가 없습니다.</div>';
        return;
    }

    // 2) 장소별 평점으로 3.5 이상만 선별(상세를 열면 실제 리뷰를 실시간으로 보여줌)
    const list = candidates
        .map(p => ({ ...p, rating: pseudoRating(p) }))
        .filter(p => p.rating >= RECOMMEND_MIN_RATING)
        .sort((a, b) => a.distanceKm - b.distanceKm);

    if (list.length === 0) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">루트 주변에 평점 3.5 이상인 장소가 없습니다.</div>';
        return;
    }

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const catLabel = c => c === 'restaurant' ? '맛집' : c === 'accommodation' ? '숙소' : c === 'attraction' ? '관광' : (c || '장소');

    const TAG_LABELS = { wheelchair: '♿ 휠체어 접근', elevator: '🛗 엘리베이터', parking: '🅿️ 장애인 주차장' };

    box.innerHTML = '';
    list.forEach(p => {
        const accessTags = inferAccessTags(p);  // 실제 태그 + 이름/카테고리 기반 추론(결정론적)
        const tagsHtml = ['wheelchair', 'elevator', 'parking'].filter(t => accessTags.has(t))
            .map(t => `<span class="badge" style="display:inline-block; background:#e6f4ea; color:#137333; font-size:0.68rem; padding:1px 7px; border-radius:8px; margin:0 4px 4px 0;">${TAG_LABELS[t]}</span>`).join('');

        const card = document.createElement('div');
        card.style.cssText = 'border:1px solid #e0e0e0; border-radius:10px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.06); overflow:hidden;';
        card.innerHTML = `
            <div class="rec-header" style="padding:10px 12px; cursor:pointer;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
                    <strong style="font-size:0.92rem; color:#202124; word-break:keep-all;">${esc(p.name)}</strong>
                    <span style="flex-shrink:0; background:#fef7e0; color:#f29900; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:10px; white-space:nowrap;">★ ${p.rating.toFixed(1)}</span>
                </div>
                <div style="font-size:0.76rem; color:#5f6368; margin-bottom:3px;">[${catLabel(p.category)}] · <i class="fas fa-location-arrow" style="font-size:0.7rem;"></i> 루트에서 ${p.distanceKm}km</div>
                <div style="font-size:0.76rem; color:#80868b; line-height:1.35; margin-bottom:4px;">${esc(p.address)}</div>
                <div>${tagsHtml}</div>
            </div>
            <div class="rec-details" style="display:none; padding:0 12px 12px; border-top:1px solid #eee; font-size:0.85rem;">
                <div class="rating-info" style="font-weight:bold; margin:10px 0 6px;"></div>
                <div class="similar-info" style="color:#1a73e8; margin-bottom:10px;"></div>
                <button class="btn-rec-add" style="width:100%; padding:8px; border:none; background:#1a73e8; color:#fff; border-radius:6px; font-weight:600; cursor:pointer;"><i class="fas fa-plus-circle"></i> 일정에 추가</button>
            </div>`;

        const header = card.querySelector('.rec-header');
        const details = card.querySelector('.rec-details');
        header.addEventListener('click', () => {
            const isOpen = details.style.display === 'block';
            box.querySelectorAll('.rec-details').forEach(el => el.style.display = 'none');
            if (!isOpen) {
                details.style.display = 'block';
                renderRecDetails(p, details);   // 실시간으로 가져온 평점/리뷰 + 주변 유사 장소
                dropRecommendPin(p);            // 모달 미니 지도에 핀 표시
            }
        });
        card.querySelector('.btn-rec-add').addEventListener('click', (e) => {
            e.stopPropagation();
            // 먼저 이동 수단(도보/버스/지하철/택시)을 물어본 뒤, 고른 위치에 끼워넣는다
            askTransitMode(p.name, (mode) => {
                cpInsertPlace({
                    id: p.id, name: p.name, category: p.category, address: p.address,
                    lat: p.lat, lng: p.lng,
                    tags: (p.tags || '').split(',').filter(Boolean),
                    transportMode: mode
                });
            });
        });
        box.appendChild(card);
    });
}

// 추천 카드 상세: 실제 리뷰를 실시간으로 가져와 보여주고 주변 유사 장소를 계산
async function renderRecDetails(p, container) {
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ratingEl = container.querySelector('.rating-info');
    ratingEl.innerHTML = `<div style="margin-bottom:5px;">평점: <span style="color:gold;">★</span> ${p.rating.toFixed(1)}</div><div style="color:#888; font-weight:normal;">리뷰 불러오는 중...</div>`;
    let reviews = [];
    try { const r = await fetchPlaceRating(); reviews = r.reviews || []; } catch { /* 무시 */ }
    const reviewHtml = reviews.length
        ? reviews.map(r => `<div style="padding:2px 0; color:#555; font-weight:normal;">- <strong>${esc(r.name)}</strong>: "${esc(r.body)}"</div>`).join('')
        : '<div style="color:#888; font-weight:normal;">표시할 리뷰가 없습니다.</div>';
    ratingEl.innerHTML =
        `<div style="margin-bottom:5px;">평점: <span style="color:gold;">★</span> ${p.rating.toFixed(1)}</div><div>${reviewHtml}</div>`;

    // 주변 유사 장소: 같은 카테고리, 가까운 순(이름 중복 제거)
    let similar = (allPlaces || []).filter(q => q.id !== p.id && q.name !== p.name && q.category === p.category && q.lat && q.lng);
    similar.forEach(q => q._d = getDistanceFromLatLonInKm(p.lat, p.lng, q.lat, q.lng));
    const byName = new Map();
    similar.sort((a, b) => a._d - b._d).forEach(q => { if (!byName.has(q.name)) byName.set(q.name, q); });
    const top = [...byName.values()].slice(0, 3);
    container.querySelector('.similar-info').innerHTML =
        '<div style="font-weight:bold; margin-bottom:3px; color:#333;">주변 유사 장소:</div>' +
        (top.length ? top.map(q => `<div>- ${esc(q.name)} (${q._d.toFixed(1)}km)</div>`).join('') : '<div>- 근처에 비슷한 장소가 없습니다.</div>');
}

// 추천 장소를 모달 미니 지도(cpMap)에 별 모양 핀으로 표시하고 그쪽으로 이동
function dropRecommendPin(place) {
    if (!cpMap || place.lat == null || place.lng == null) return;
    if (window._cpRecMarker) { cpMap.removeLayer(window._cpRecMarker); window._cpRecMarker = null; }
    window._cpRecMarker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
            className: 'cp-rec-marker',
            html: `<div style="background:#1a73e8; color:#fff; width:28px; height:28px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,.45);"><i class="fas fa-star" style="transform:rotate(45deg); font-size:12px;"></i></div>`,
            iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26]
        })
    }).addTo(cpMap).bindPopup(`<b>${place.name}</b><br>추천 장소`).openPopup();
    cpMap.invalidateSize();
    cpMap.panTo([place.lat, place.lng]);
}

// ============================================================
// 장애인 이동 지수 감점 분석 + 미니 지도 (PRD)
// ============================================================
let cpMap = null;

function iconForCategory(cat) {
    const m = {
        step: '<i class="fas fa-door-closed" style="color:#d93025;"></i>',
        elevator: '<i class="fas fa-arrows-alt-v" style="color:#d93025;"></i>',
        width: '<i class="fas fa-arrows-alt-h" style="color:#d93025;"></i>',
        ramp: '<i class="fas fa-mountain" style="color:#d93025;"></i>',
        transport: '<i class="fas fa-walking" style="color:#d93025;"></i>',
        no_data: '<i class="fas fa-question-circle" style="color:#888;"></i>',
    };
    return m[cat] || '<i class="fas fa-exclamation-circle"></i>';
}

function segColorFor(penalty) {
    return penalty === 0 ? '#137333' : penalty < 10 ? '#f29900' : '#d93025';
}

async function renderAccessBreakdown(planId) {
    const mapDiv = document.getElementById('cpModalMap');
    const bd = document.getElementById('cpModalBreakdown');
    if (bd) bd.innerHTML = '<div style="color:#888; font-size:0.9rem;">이동 지수 분석 중...</div>';

    let data;
    try {
        const res = await fetch(`/api/community/${planId}/access-breakdown`);
        data = await res.json();
    } catch (e) {
        if (bd) bd.innerHTML = '<div style="color:#888; font-size:0.9rem;">분석 정보를 불러오지 못했습니다.</div>';
        if (mapDiv) mapDiv.style.display = 'none';
        return;
    }

    const segs = data.segments || [];
    const scoreColor = data.score >= 80 ? '#1a73e8' : data.score >= 60 ? '#f29900' : '#d93025';

    let html = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
        <div style="font-size:1.5rem; font-weight:bold; color:${scoreColor};"><i class="fas fa-wheelchair"></i> ${data.score}점</div>
        <div style="color:#5f6368; font-size:0.9rem;">총 ${data.totalDeducted}점 감점</div>
    </div>`;

    segs.forEach(seg => {
        const segColor = segColorFor(seg.penalty);
        if (!seg.deductions || seg.deductions.length === 0) {
            html += `<div style="padding:8px 10px; border-left:3px solid ${segColor}; background:#f8f9fa; border-radius:4px; margin-bottom:6px; font-size:0.9rem;">
                <strong>${seg.index}. ${seg.name}</strong></div>`;
        } else {
            const rows = seg.deductions.map(d => {
                const isNoData = d.category === 'no_data';
                return `<div style="display:flex; justify-content:space-between; gap:8px; font-size:0.85rem; color:${isNoData ? '#888' : '#444'}; padding:2px 0;">
                    <span>${iconForCategory(d.category)} ${d.reason}</span>
                    <span style="font-weight:600; color:${isNoData ? '#888' : '#d93025'}; flex-shrink:0;">−${d.penalty}</span></div>`;
            }).join('');
            html += `<div style="padding:8px 10px; border-left:3px solid ${segColor}; background:#fff; border:1px solid #eee; border-radius:4px; margin-bottom:6px;">
                <div style="font-weight:600; font-size:0.9rem; margin-bottom:4px;">${seg.index}. ${seg.name} <span style="color:${segColor}; font-size:0.8rem;">(−${seg.penalty})</span></div>
                ${rows}</div>`;
        }
    });
    if (bd) bd.innerHTML = html;

    renderCpMap(segs);
}

function renderCpMap(segs) {
    const mapDiv = document.getElementById('cpModalMap');
    if (!mapDiv) return;
    const pts = (segs || []).filter(s => s.lat && s.lng);
    if (pts.length === 0) { mapDiv.style.display = 'none'; return; }
    mapDiv.style.display = 'block';

    // 기존 인스턴스 정리(모달 재오픈 대비)
    if (cpMap) { cpMap.remove(); cpMap = null; }
    window._cpRecMarker = null;    // 추천 핀 참조도 초기화(지도가 새로 생성됨)
    window._cpPreviewLayer = null; // 비슷한 루트 미리보기 레이어도 초기화
    window._cpStageLayer = null;   // 스테이징 동선 레이어 초기화
    mapDiv._leaflet_id = null;

    cpMap = L.map(mapDiv, { zoomControl: false, attributionControl: false }).setView([pts[0].lat, pts[0].lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(cpMap);

    // 실제 동선은 스테이징(cpStageItems) 기준으로 그린다(추가/삭제 시 갱신, 도로를 따라감)
    setTimeout(() => {
        if (cpMap) cpMap.invalidateSize();
        drawCpStageRoute();
    }, 300);
}

// 이동 수단별 동선 색상
function transitColor(mode) {
    return mode === 'bus' ? '#3d5bab' : mode === 'subway' ? '#00a2d1' : mode === 'taxi' ? '#f9ab00' : '#1a73e8';
}

// 두 지점 사이 도로 경로(OSRM). 실패 시 직선으로 폴백.
async function fetchRoadPath(a, b) {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data.routes && data.routes[0]) return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    } catch (e) { /* 무시 → 직선 폴백 */ }
    return [[a.lat, a.lng], [b.lat, b.lng]];
}

// 미니맵에 스테이징 동선을 그린다: 번호 마커 + 구간별 도로 경로(이동수단 색상)
// 끼워넣기/삭제로 cpStageItems 가 바뀔 때마다 다시 호출된다.
async function drawCpStageRoute() {
    if (!cpMap) return;
    const seq = ++_cpStageDrawSeq;
    const pts = (cpStageItems || []).filter(i => i.lat != null && i.lng != null);

    // 이전 동선 레이어 제거
    if (window._cpStageLayer) { cpMap.removeLayer(window._cpStageLayer); window._cpStageLayer = null; }
    if (pts.length === 0) return;

    const group = L.layerGroup().addTo(cpMap);
    window._cpStageLayer = group;
    const bounds = L.latLngBounds();

    // 번호 마커는 즉시 표시(도로 경로는 비동기로 채움)
    pts.forEach((s, idx) => {
        bounds.extend([s.lat, s.lng]);
        L.marker([s.lat, s.lng], {
            icon: L.divIcon({
                className: 'cp-num-marker',
                html: `<div style="background:#1a73e8; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.4); font-size:12px;">${idx + 1}</div>`,
                iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
            })
        }).addTo(group).bindPopup(`<b>${idx + 1}. ${s.name}</b>`);
    });
    if (seq === _cpStageDrawSeq && bounds.isValid()) cpMap.fitBounds(bounds, { padding: [30, 30] });

    // 구간별 도로 경로(직선이 건물을 가로지르지 않도록 OSRM 사용)
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const coords = await fetchRoadPath(a, b);
        if (seq !== _cpStageDrawSeq) return;   // 그 사이 또 바뀌었으면 이 그리기는 폐기
        const mode = b.transportMode || 'walk';
        L.polyline(coords, {
            color: transitColor(mode), weight: 5, opacity: 0.85,
            ...(mode === 'subway' ? { dashArray: '1,9' } : {})
        }).addTo(group);
        coords.forEach(c => bounds.extend(c));
    }
    if (seq === _cpStageDrawSeq && bounds.isValid()) cpMap.fitBounds(bounds, { padding: [30, 30] });
}

// ============================================================
// 루트 카드 토글 선택: 클릭 순서대로 내 일정에 이어 붙이기
//   - 카드를 누르면(abc) 해당 루트가 통째로 내 일정 뒤에 붙고 ①②③ 번호가 매겨짐
//   - 같은 카드를 다시 누르면 그 루트가 빠지고 남은 선택이 재정렬(ac → ①②)
//   - updatePlanUI() 가 day별 이동시간/비용을 자동 재계산하므로 순서만 관리하면 됨
// ============================================================

// 새 루트 카드 세션 시작(이전 선택은 그대로 일정에 확정). 모달 열 때 호출.
function resetRouteSelection() {
    routeSelOrder = [];
    routeSelBase = null;
    routeSelCache = {};
}

// HTML 이스케이프
function _escRoute(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 공통 루트 카드 마크업(비슷한 동선 패널 / 전체 루트 목록 공용)
function buildRouteCard({ id, title, author, rating, placesText, rightChip }) {
    const chipHtml = rightChip
        ? `<span style="flex-shrink:0; margin-left:6px; background:#e8f0fe; color:#1a73e8; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:10px;">${_escRoute(rightChip)}</span>`
        : '';
    return `<div data-route-card="${id}" onclick="toggleRouteSelection(${id})" title="클릭하면 이 루트가 내 일정에 이어 붙습니다 (다시 누르면 빼기)" style="position:relative; border:1px solid #e0e0e0; border-radius:10px; padding:12px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.06); cursor:pointer; transition:border-color .15s, box-shadow .15s;">
            <div class="route-sel-badge" style="display:none; position:absolute; top:-9px; left:-9px; width:24px; height:24px; border-radius:50%; background:#1a73e8; color:#fff; font-size:0.8rem; font-weight:700; align-items:center; justify-content:center; box-shadow:0 1px 4px rgba(0,0,0,.35);"></div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <strong style="font-size:0.95rem; color:#202124; word-break:keep-all;">${_escRoute(title)}</strong>
                ${chipHtml}
            </div>
            <div style="font-size:0.78rem; color:#5f6368; margin-bottom:6px;">${_escRoute(author)} · 평점 ${(Number(rating) || 0).toFixed(1)}</div>
            <div style="font-size:0.8rem; color:#444; background:#f8f9fa; border-radius:6px; padding:6px 8px; margin-bottom:6px; line-height:1.4;">${_escRoute(placesText)}</div>
            <button onclick="event.stopPropagation(); openCommunityPlanModalById(${id})" style="width:100%; padding:6px; border:none; background:transparent; color:#1a73e8; font-size:0.78rem; cursor:pointer; text-decoration:underline;">상세 보기</button>
        </div>`;
}

// 선택된 루트들을 클릭 순서대로 base 일정 뒤에 이어 붙여 planItems 재구성
function rebuildPlanFromRouteSel() {
    if (routeSelBase == null) return;
    const merged = routeSelBase.map(i => ({ ...i }));
    routeSelOrder.forEach(id => {
        (routeSelCache[id] || []).forEach(it => {
            merged.push({ ...it, day: currentDay, moveTime: 0, moveCost: 0, _routeSrc: id });
        });
    });
    planItems = merged;
    updatePlanUI();
    updateDayTabs();
    savePlanToServer();
}

// 화면에 보이는 모든 루트 카드의 선택 번호 배지/하이라이트 갱신
function refreshRouteSelBadges() {
    document.querySelectorAll('[data-route-card]').forEach(card => {
        const id = parseInt(card.getAttribute('data-route-card'), 10);
        const pos = routeSelOrder.indexOf(id);
        const badge = card.querySelector('.route-sel-badge');
        if (pos >= 0) {
            card.style.borderColor = '#1a73e8';
            card.style.boxShadow = '0 2px 8px rgba(26,115,232,.22)';
            if (badge) { badge.style.display = 'flex'; badge.textContent = String(pos + 1); }
        } else {
            card.style.borderColor = '#e0e0e0';
            card.style.boxShadow = '0 1px 4px rgba(0,0,0,.06)';
            if (badge) badge.style.display = 'none';
        }
    });
}

// 루트 카드 클릭 → 선택 토글(이어 붙이기/빼기) + 클릭 순서대로 번호 부여
async function toggleRouteSelection(id) {
    if (!currentUser) { alert('로그인이 필요합니다.'); return; }
    if (routeSelBase == null) { routeSelBase = planItems.map(i => ({ ...i })); saveToUndo(); }

    const idx = routeSelOrder.indexOf(id);
    if (idx >= 0) {
        routeSelOrder.splice(idx, 1);          // 다시 누름 → 선택 해제
        // 미니맵 미리보기: 남은 선택의 마지막 루트로 갱신, 없으면 제거
        if (routeSelOrder.length > 0) previewSimilarRoute(routeSelOrder[routeSelOrder.length - 1]);
        else if (cpMap && window._cpPreviewLayer) { cpMap.removeLayer(window._cpPreviewLayer); window._cpPreviewLayer = null; }
    } else {
        if (!routeSelCache[id]) {               // 루트 장소 목록을 1회만 불러와 캐시
            try {
                const detail = await (await fetch(`/api/community/${id}/details`)).json();
                routeSelCache[id] = (detail && detail.items) ? detail.items : [];
            } catch (e) { alert('루트를 불러오지 못했습니다.'); return; }
        }
        routeSelOrder.push(id);
        previewSimilarRoute(id);                // 미니 지도 미리보기(열려 있을 때만 동작)
    }

    rebuildPlanFromRouteSel();
    refreshRouteSelBadges();
    if (routeSelOrder.length === 0) routeSelBase = null;  // 전부 해제 시 기준 초기화
}

// 루트 id로 커뮤니티 상세 모달 열기(카드 "상세 보기"용 편의 함수)
function openCommunityPlanModalById(id) {
    const p = communityPlans.find(x => x.id === id);
    if (!p) return;
    const places = (p.items || []).map(i => i.name).join(' ➔ ');
    openCommunityPlanModal(p.id, p.title, p.author, Number(p.avg_rating) || 0, (p.description || '').replace(/\n/g, '<br>'), places);
}

// ============================================================
// 전체 루트 보기: 모든 커뮤니티 루트를 목록 모달로(같은 토글 동작)
// ============================================================
// 아코디언 펼침/접힘: ▼(접힘) 누르면 펼쳐지고 ▲로, ▲(펼침) 누르면 접히고 ▼로
function toggleAccordion(btn, contentId) {
    const c = document.getElementById(contentId);
    if (!c) return;
    const willOpen = (c.style.display === 'none' || !c.style.display);
    c.style.display = willOpen ? 'block' : 'none';
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    const caret = btn.querySelector('.acc-caret');
    if (caret) caret.textContent = willOpen ? '▲' : '▼';
}

// 모달을 열 때 아코디언을 접힌 기본 상태로 초기화
function resetAccordions() {
    [['cpModalSimilarWrap'], ['cpModalTopRatedWrap'], ['cpModalRecommendWrap']].forEach(([id]) => {
        const c = document.getElementById(id);
        if (c) c.style.display = 'none';
    });
    document.querySelectorAll('#communityPlanModal .acc-toggle').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
        const caret = btn.querySelector('.acc-caret');
        if (caret) caret.textContent = '▼';
    });
}

// ============================================================
// 비슷한 동선의 루트 추천 (옆 패널) — 카드 클릭으로 내 일정에 토글 추가
// ============================================================
async function renderSimilarRoutes(planId) {
    const box = document.getElementById('cpModalSimilar');
    if (!box) return;
    box.innerHTML = '<div style="color:#888; font-size:0.9rem;">비슷한 루트 찾는 중...</div>';

    let list;
    try {
        const res = await fetch(`/api/community/${planId}/similar?limit=5`);
        list = await res.json();
    } catch (e) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">추천을 불러오지 못했습니다.</div>';
        return;
    }
    if (!Array.isArray(list) || list.length === 0) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">비슷한 동선의 루트가 아직 없습니다.</div>';
        return;
    }

    box.innerHTML = list.map(p => buildRouteCard({
        id: p.id, title: p.title, author: p.author, rating: p.avg_rating,
        placesText: (p.places || []).join(' ➔ '),
        rightChip: `유사 ${p.similarity}%`
    })).join('');
    refreshRouteSelBadges();
}

// 추천 루트(평점 높은 순) — 현재 보고 있는 루트를 빼고, 커뮤니티 루트를 평점순으로.
//   이미 받아둔 communityPlans를 쓰므로 별도 서버 호출이 없다(동선 유사도와 무관).
function renderRecommendedRoutes(planId) {
    const box = document.getElementById('cpModalTopRated');
    if (!box) return;
    const list = (communityPlans || [])
        .filter(p => p.id !== planId)
        .map(p => ({ ...p, _r: Number(p.avg_rating) || 0 }))
        .sort((a, b) => (b._r - a._r) || ((b.review_count || 0) - (a.review_count || 0)))
        .slice(0, 5);
    if (list.length === 0) {
        box.innerHTML = '<div style="color:#888; font-size:0.9rem;">추천할 루트가 아직 없습니다.</div>';
        return;
    }
    box.innerHTML = list.map(p => buildRouteCard({
        id: p.id, title: p.title, author: p.author, rating: p._r,
        placesText: (p.items ? p.items.map(i => i.name) : (p.places || [])).join(' ➔ '),
        rightChip: `★ ${p._r.toFixed(1)}`
    })).join('');
    refreshRouteSelBadges();
}

// 비슷한 동선 루트를 미니 지도(cpMap)에 미리보기(점선 보라색 동선 + 번호 마커)
async function previewSimilarRoute(planId) {
    if (!cpMap) return;
    let items;
    try {
        const detail = await (await fetch(`/api/community/${planId}/details`)).json();
        items = (detail && detail.items ? detail.items : []).filter(i => i.lat && i.lng);
    } catch (e) { return; }
    if (!items.length) return;

    // 이전 미리보기 제거
    if (window._cpPreviewLayer) { cpMap.removeLayer(window._cpPreviewLayer); window._cpPreviewLayer = null; }
    const group = L.layerGroup();
    const latlngs = items.map(i => [i.lat, i.lng]);
    L.polyline(latlngs, { color: '#8e24aa', weight: 4, opacity: 0.9, dashArray: '6,6' }).addTo(group);
    items.forEach((it, idx) => {
        L.marker([it.lat, it.lng], {
            icon: L.divIcon({
                className: 'cp-preview-marker',
                html: `<div style="background:#8e24aa; color:#fff; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:2px solid #fff; box-shadow:0 1px 3px rgba(0,0,0,.4); font-size:11px;">${idx + 1}</div>`,
                iconSize: [22, 22], iconAnchor: [11, 11], popupAnchor: [0, -11]
            })
        }).bindPopup(`<b>${idx + 1}. ${it.name}</b><br><span style="color:#8e24aa;">미리보기 동선</span>`).addTo(group);
    });
    group.addTo(cpMap);
    window._cpPreviewLayer = group;
    cpMap.invalidateSize();
    cpMap.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
}

// ============================================================
// REQ-COM-05: 장소 접근성 후기 + 보행 편의성 태깅
// ============================================================
const ACCESS_TAG_OPTIONS = [
    { key: 'wheelchair', label: '휠체어 접근 가능' },
    { key: 'elevator', label: '엘리베이터 있음' },
    { key: 'ramp', label: '경사로 있음' },
    { key: 'flat', label: '경사 완만/평지' },
    { key: 'no_step', label: '문턱 없음' },
    { key: 'accessible_toilet', label: '장애인 화장실' },
    { key: 'parking', label: '장애인 주차장' },
    { key: 'braille', label: '점자 안내' },
];
let currentAccessPlaceId = null;
let selectedAccessTags = new Set();
let selectedAccessRating = 0;

// 공용 별점 선택기: container에 ★5개를 그리고 클릭 시 setVal 호출
function renderStarSelector(container, getVal, setVal) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.textContent = '★';
        star.setAttribute('role', 'radio');
        star.setAttribute('aria-label', `${i}점`);
        star.style.cssText = 'cursor:pointer; transition:color .1s; color:' + (i <= getVal() ? '#fbbc04' : '#dadce0') + ';';
        star.onclick = () => { setVal(i); renderStarSelector(container, getVal, setVal); };
        container.appendChild(star);
    }
}

function openAccessReviewModal(placeId, placeName) {
    currentAccessPlaceId = placeId;
    selectedAccessTags = new Set();
    selectedAccessRating = 0;
    document.getElementById('arPlaceName').textContent = placeName || '';
    document.getElementById('arComment').value = '';
    renderStarSelector(document.getElementById('arStars'), () => selectedAccessRating, v => selectedAccessRating = v);

    // 태그 칩 렌더링(토글 가능)
    const chipsDiv = document.getElementById('arTagChips');
    chipsDiv.innerHTML = '';
    ACCESS_TAG_OPTIONS.forEach(opt => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = opt.label;
        chip.setAttribute('aria-pressed', 'false');
        chip.dataset.key = opt.key;
        chip.style.cssText = 'padding:8px 14px; border:1.5px solid #dadce0; background:#fff; border-radius:20px; cursor:pointer; font-size:0.85rem; font-weight:600;';
        chip.onclick = () => {
            if (selectedAccessTags.has(opt.key)) {
                selectedAccessTags.delete(opt.key);
                chip.style.background = '#fff'; chip.style.borderColor = '#dadce0'; chip.style.color = '#000';
                chip.setAttribute('aria-pressed', 'false');
            } else {
                selectedAccessTags.add(opt.key);
                chip.style.background = '#e8f0fe'; chip.style.borderColor = '#1a73e8'; chip.style.color = '#1a73e8';
                chip.setAttribute('aria-pressed', 'true');
            }
        };
        chipsDiv.appendChild(chip);
    });

    loadAccessReviews(placeId);
    document.getElementById('accessReviewModal').classList.add('active');
}

async function loadAccessReviews(placeId) {
    const listDiv = document.getElementById('arReviewList');
    const summaryDiv = document.getElementById('arTagSummary');
    const countSpan = document.getElementById('arReviewCount');
    listDiv.innerHTML = '<div style="color:#888; font-size:0.9rem;">불러오는 중...</div>';
    summaryDiv.innerHTML = '';
    try {
        const res = await fetch(`/api/accessibility/reviews?place_id=${placeId}`);
        const data = await res.json();
        countSpan.textContent = `(${data.count}건)`;

        // 별점 평균 요약
        const labelMap = {};
        ACCESS_TAG_OPTIONS.forEach(o => labelMap[o.key] = o.label);
        const avgHtml = data.avgRating > 0
            ? `<div style="font-weight:700; margin-bottom:8px;"><span style="color:#fbbc04;">★</span> ${data.avgRating.toFixed(1)} <span style="font-weight:400; color:#888; font-size:0.85rem;">(${data.ratingCount}명 평가)</span></div>`
            : '';
        summaryDiv.innerHTML = avgHtml + Object.entries(data.tagCounts || {})
            .sort((a, b) => b[1] - a[1])
            .map(([k, c]) => `<span style="background:#e6f4ea; color:#137333; padding:4px 10px; border-radius:14px; font-size:0.8rem; font-weight:600;">${labelMap[k] || k} ${c}</span>`)
            .join('');

        if (!data.reviews || data.reviews.length === 0) {
            listDiv.innerHTML = '<div style="color:#888; font-size:0.9rem;">아직 등록된 접근성 후기가 없습니다. 첫 후기를 남겨주세요!</div>';
            return;
        }
        listDiv.innerHTML = data.reviews.map(r => {
            const tags = (r.access_tags || []).map(k => `<span style="background:#f1f3f4; padding:2px 8px; border-radius:10px; font-size:0.75rem; margin-right:4px;">${labelMap[k] || k}</span>`).join('');
            const stars = r.rating > 0 ? `<span style="color:#fbbc04; margin-left:6px;">${'★'.repeat(r.rating)}<span style="color:#dadce0;">${'★'.repeat(5 - r.rating)}</span></span>` : '';
            return `<div style="border:1px solid #eee; border-radius:8px; padding:10px;">
                <div style="font-size:0.85rem; color:#5f6368; margin-bottom:4px;"><strong>${r.username || '익명'}</strong>${stars}</div>
                <div style="margin-bottom:6px;">${tags}</div>
                <div style="font-size:0.92rem; color:#333;">${r.comment ? r.comment.replace(/</g, '&lt;') : ''}</div>
            </div>`;
        }).join('');
    } catch (e) {
        console.error('접근성 후기 로드 오류:', e);
        listDiv.innerHTML = '<div style="color:#d93025;">후기를 불러오지 못했습니다.</div>';
    }
}

async function submitAccessReview() {
    if (!currentUser) return alert('로그인이 필요한 기능입니다.');
    if (!currentAccessPlaceId) return;
    const comment = document.getElementById('arComment').value.trim();
    if (selectedAccessRating === 0 && selectedAccessTags.size === 0 && !comment) {
        return alert('별점을 주거나 태그 선택/후기 작성을 해주세요.');
    }
    try {
        const res = await fetch('/api/accessibility/review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                place_id: currentAccessPlaceId,
                user_id: currentUser.id,
                access_tags: Array.from(selectedAccessTags),
                rating: selectedAccessRating,
                comment: comment
            })
        });
        if (res.ok) {
            document.getElementById('arComment').value = '';
            selectedAccessTags = new Set();
            selectedAccessRating = 0;
            renderStarSelector(document.getElementById('arStars'), () => selectedAccessRating, v => selectedAccessRating = v);
            // 칩 초기화
            document.querySelectorAll('#arTagChips button').forEach(c => {
                c.style.background = '#fff'; c.style.borderColor = '#dadce0'; c.style.color = '#000';
                c.setAttribute('aria-pressed', 'false');
            });
            await loadAccessReviews(currentAccessPlaceId);
        } else {
            alert('후기 등록에 실패했습니다.');
        }
    } catch (e) {
        console.error('접근성 후기 등록 오류:', e);
    }
}

// ============================================================
// 여행 톡 (커뮤니티 게시판): 지역 카드 + 글 피드 + 상세/댓글 + 작성 + 반응
// ============================================================
let talkPosts = [];
let talkRegionFilterVal = '';
let currentTalkPostId = null;
let talkWritePhotos = [];
let talkCommentPhoto = '';

function tEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function talkFileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}
function talkDateShort(s) {
    const d = new Date((s || '').replace(' ', 'T') + 'Z');
    if (isNaN(d)) return '';
    const yy = String(d.getFullYear()).slice(2), mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${yy}.${mm}.${dd}`;
}
function talkTimeAgo(s) {
    const d = new Date((s || '').replace(' ', 'T') + 'Z');
    if (isNaN(d)) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '방금';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
    if (diff < 172800) return '어제';
    if (diff < 259200) return '그저께';
    if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
    return talkDateShort(s);
}

// 톡 진입: 지역 카드 + 필터 + 피드 모두 렌더
async function renderTalk() {
    try {
        const rres = await fetch('/api/talk/regions');
        const regions = await rres.json();
        renderTalkRegionCards(regions);
        populateTalkRegionFilter(regions);
    } catch (e) { console.error('여행 톡 지역 카드 오류:', e); }
    await renderTalkFeedOnly();
}

// 피드만 갱신(반응 토글/필터 변경 시)
async function renderTalkFeedOnly() {
    const feed = document.getElementById('talkFeed');
    if (!feed) return;
    feed.innerHTML = '<div style="color:#888; padding:20px; text-align:center;">불러오는 중...</div>';
    try {
        const params = new URLSearchParams();
        if (currentUser) params.set('user_id', currentUser.id);
        if (talkRegionFilterVal) params.set('region', talkRegionFilterVal);
        const res = await fetch('/api/talk' + (params.toString() ? '?' + params.toString() : ''));
        talkPosts = await res.json();
        if (!talkPosts || talkPosts.length === 0) {
            feed.innerHTML = '<div style="color:#888; padding:40px; text-align:center;">아직 등록된 글이 없어요. 첫 글을 남겨보세요!</div>';
            return;
        }
        feed.innerHTML = talkPosts.map(talkFeedCardHTML).join('');
    } catch (e) {
        console.error('여행 톡 로드 오류:', e);
        feed.innerHTML = '<div style="color:#d93025;">글을 불러오지 못했습니다.</div>';
    }
}

function talkFeedCardHTML(p) {
    const region = p.region
        ? `<span style="display:inline-block; border:1px solid #202124; border-radius:16px; padding:3px 14px; font-size:0.82rem; font-weight:600; margin:6px 0 10px;">${tEsc(p.region)}</span><br>`
        : '';
    const likeOn = p.my_like ? 'color:#1a73e8;' : 'color:#5f6368;';
    const heartOn = p.my_heart ? 'color:#e0245e;' : 'color:#5f6368;';
    return `
    <div onclick="openTalkDetail(${p.id})" style="cursor:pointer; border-bottom:1px solid #e8eaed; padding:20px 4px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
            <i class="fas fa-user-circle" style="font-size:2.2rem; color:#bdc1c6;"></i>
            <div>
                <div style="font-weight:700; color:#202124;">${tEsc(p.username || '익명')}</div>
                <div style="font-size:0.75rem; color:#9aa0a6;">${talkDateShort(p.created_at)}</div>
            </div>
        </div>
        <div style="font-weight:700; font-size:1.05rem; color:#202124; margin-bottom:6px;">${tEsc(p.title || '(제목 없음)')}</div>
        <div style="color:#5f6368; font-size:0.9rem; line-height:1.5; margin-bottom:8px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${tEsc(p.content || '')}</div>
        ${region}
        <div style="display:flex; align-items:center; gap:18px; margin-top:4px;">
            <span onclick="event.stopPropagation(); toggleTalkReaction(${p.id},'like')" style="cursor:pointer; ${likeOn} font-weight:600;"><i class="fas fa-thumbs-up"></i> ${p.like_count}</span>
            <span onclick="event.stopPropagation(); toggleTalkReaction(${p.id},'heart')" style="cursor:pointer; ${heartOn} font-weight:600;"><i class="fas fa-heart"></i> ${p.heart_count}</span>
            <span style="color:#5f6368; font-weight:600;"><i class="fas fa-comment-dots"></i> ${p.comment_count}</span>
            <span style="margin-left:auto; font-size:0.8rem; color:#9aa0a6;">${talkTimeAgo(p.created_at)}</span>
        </div>
    </div>`;
}

function renderTalkRegionCards(regions) {
    const wrap = document.getElementById('talkRegionCards');
    if (!wrap) return;
    if (!regions || regions.length === 0) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = regions.map(r => `
        <div onclick="filterTalkByRegion('${encodeURIComponent(r.region)}')" style="cursor:pointer; flex:0 0 auto; width:230px; border:1px solid #dadce0; border-radius:16px; padding:16px 18px; background:#fff;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
                <i class="fas fa-comment-dots" style="color:#9aa0a6; font-size:1.4rem;"></i>
                <span style="font-weight:700; color:#202124;">${tEsc(r.region)}</span>
            </div>
            <div style="color:#5f6368; font-size:0.85rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${tEsc(r.latest || '')}</div>
        </div>`).join('');
}

function populateTalkRegionFilter(regions) {
    const sel = document.getElementById('talkRegionFilter');
    if (!sel) return;
    const cur = talkRegionFilterVal;
    sel.innerHTML = '<option value="">도시 전체 ▾</option>' +
        (regions || []).map(r => `<option value="${tEsc(r.region)}">${tEsc(r.region)} (${r.cnt})</option>`).join('');
    sel.value = cur || '';
}

function onTalkRegionFilter() {
    const sel = document.getElementById('talkRegionFilter');
    talkRegionFilterVal = sel ? sel.value : '';
    renderTalkFeedOnly();
}

function filterTalkByRegion(encRegion) {
    talkRegionFilterVal = decodeURIComponent(encRegion);
    const sel = document.getElementById('talkRegionFilter');
    if (sel) sel.value = talkRegionFilterVal;
    renderTalkFeedOnly();
}

async function openTalkDetail(id) {
    currentTalkPostId = id;
    document.getElementById('talkListMode').style.display = 'none';
    document.getElementById('talkWriteMode').style.display = 'none';
    document.getElementById('talkDetailMode').style.display = 'block';
    const content = document.getElementById('talkDetailContent');
    content.innerHTML = '<div style="color:#888;">불러오는 중...</div>';
    try {
        const params = new URLSearchParams();
        if (currentUser) params.set('user_id', currentUser.id);
        const res = await fetch(`/api/talk/${id}` + (params.toString() ? '?' + params.toString() : ''));
        const data = await res.json();
        renderTalkDetail(data);
    } catch (e) {
        console.error('여행 톡 상세 오류:', e);
        content.innerHTML = '<div style="color:#d93025;">불러오지 못했습니다.</div>';
    }
}

function renderTalkDetail(data) {
    const p = data.post;
    const comments = data.comments || [];
    const content = document.getElementById('talkDetailContent');
    const likeOn = p.my_like ? 'color:#1a73e8;' : 'color:#5f6368;';
    const heartOn = p.my_heart ? 'color:#e0245e;' : 'color:#5f6368;';
    const region = (p.region || p.place)
        ? `<span style="display:inline-block; border:1px solid #202124; border-radius:16px; padding:3px 14px; font-size:0.82rem; font-weight:600; margin:8px 0;">${tEsc(p.region || '')}${p.place ? ' · ' + tEsc(p.place) : ''}</span>`
        : '';
    const photos = (p.photos || []).map(src => `<img src="${src}" style="width:100%; border-radius:10px; margin-bottom:10px;">`).join('');
    const canDelete = currentUser && (currentUser.role === 'admin' || currentUser.id === p.user_id);
    content.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
            <i class="fas fa-user-circle" style="font-size:2.4rem; color:#bdc1c6;"></i>
            <div>
                <div style="font-weight:700;">${tEsc(p.username || '익명')}</div>
                <div style="font-size:0.78rem; color:#9aa0a6;">${talkDateShort(p.created_at)}</div>
            </div>
            ${canDelete ? `<button onclick="deleteTalkPost(${p.id})" style="margin-left:auto; padding:5px 12px; border:1px solid #f0b3ac; background:#fff; color:#d93025; border-radius:16px; font-size:0.8rem; cursor:pointer;">삭제</button>` : ''}
        </div>
        <h2 style="color:#202124; margin-bottom:4px;">${tEsc(p.title || '')}</h2>
        ${region}
        <div style="color:#333; line-height:1.7; white-space:pre-wrap; margin:14px 0;">${tEsc(p.content || '')}</div>
        ${photos ? `<div style="margin:16px 0;"><div style="font-weight:600; color:#5f6368; margin-bottom:8px;">업로드한 사진들</div>${photos}</div>` : ''}
        <div style="display:flex; gap:22px; align-items:center; border-top:1px solid #e8eaed; padding-top:14px;">
            <span onclick="toggleTalkReaction(${p.id},'like')" style="cursor:pointer; ${likeOn} font-weight:700;"><i class="fas fa-thumbs-up"></i> ${p.like_count}</span>
            <span onclick="toggleTalkReaction(${p.id},'heart')" style="cursor:pointer; ${heartOn} font-weight:700;"><i class="fas fa-heart"></i> ${p.heart_count}</span>
        </div>`;

    const clist = document.getElementById('talkCommentList');
    document.getElementById('talkCommentCount').textContent = `(${comments.length})`;
    if (comments.length === 0) {
        clist.innerHTML = '<div style="color:#9aa0a6; text-align:center; padding:16px;">아직 댓글이 없어요.<br>댓글을 남겨주세요!</div>';
    } else {
        clist.innerHTML = comments.map(c => `
            <div style="display:flex; gap:10px;">
                <i class="fas fa-user-circle" style="font-size:1.8rem; color:#bdc1c6;"></i>
                <div style="flex:1;">
                    <div style="font-size:0.85rem;"><strong>${tEsc(c.username || '익명')}</strong> <span style="color:#9aa0a6; font-size:0.75rem;">${talkTimeAgo(c.created_at)}</span></div>
                    <div style="color:#333; margin-top:2px;">${tEsc(c.content || '')}</div>
                    ${c.photo ? `<img src="${c.photo}" style="max-width:200px; border-radius:8px; margin-top:6px;">` : ''}
                </div>
            </div>`).join('');
    }
}

function backToTalkList() {
    const dm = document.getElementById('talkDetailMode'); if (dm) dm.style.display = 'none';
    const wm = document.getElementById('talkWriteMode'); if (wm) wm.style.display = 'none';
    const lm = document.getElementById('talkListMode'); if (lm) lm.style.display = 'block';
}

function openTalkWrite() {
    if (!currentUser) return alert('로그인이 필요한 기능입니다.');
    talkWritePhotos = [];
    ['talkWriteRegion', 'talkWritePlace', 'talkWriteTitle', 'talkWriteContent'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('talkWritePhotoPreview').innerHTML = '';
    document.getElementById('talkListMode').style.display = 'none';
    document.getElementById('talkDetailMode').style.display = 'none';
    document.getElementById('talkWriteMode').style.display = 'block';
}

async function onTalkWritePhoto(input) {
    const files = Array.from(input.files || []);
    for (const f of files) {
        if (talkWritePhotos.length >= 8) { alert('사진은 최대 8장까지 첨부할 수 있어요.'); break; }
        try { talkWritePhotos.push(await talkFileToDataURL(f)); } catch (_) {}
    }
    input.value = '';
    renderTalkWritePreviews();
}
function renderTalkWritePreviews() {
    const wrap = document.getElementById('talkWritePhotoPreview');
    if (!wrap) return;
    wrap.innerHTML = talkWritePhotos.map((src, i) => `
        <div style="position:relative;">
            <img src="${src}" style="width:96px; height:96px; object-fit:cover; border-radius:8px;">
            <button onclick="removeTalkWritePhoto(${i})" style="position:absolute; top:-6px; right:-6px; width:22px; height:22px; border-radius:50%; border:none; background:#202124; color:#fff; cursor:pointer; font-size:0.8rem; line-height:1;">×</button>
        </div>`).join('');
}
function removeTalkWritePhoto(i) { talkWritePhotos.splice(i, 1); renderTalkWritePreviews(); }

async function submitTalkPost() {
    if (!currentUser) return alert('로그인이 필요한 기능입니다.');
    const region = document.getElementById('talkWriteRegion').value.trim();
    const place = document.getElementById('talkWritePlace').value.trim();
    const title = document.getElementById('talkWriteTitle').value.trim();
    const contentV = document.getElementById('talkWriteContent').value.trim();
    if (!title && !contentV) return alert('제목 또는 내용을 입력해주세요.');
    try {
        const res = await fetch('/api/talk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, region, place, title, content: contentV, photos: talkWritePhotos })
        });
        if (res.ok) {
            talkWritePhotos = [];
            backToTalkList();
            renderTalk();
        } else {
            const e = await res.json().catch(() => ({}));
            alert(e.error || '등록에 실패했습니다.');
        }
    } catch (e) { console.error('여행 톡 등록 오류:', e); alert('등록 실패'); }
}

function onTalkCommentPhoto(input) {
    const f = (input.files || [])[0];
    if (!f) return;
    talkFileToDataURL(f).then(d => {
        talkCommentPhoto = d;
        document.getElementById('talkCommentPhotoPreview').innerHTML =
            `<img src="${talkCommentPhoto}" style="max-width:120px; border-radius:8px; vertical-align:middle;"> <button onclick="clearTalkCommentPhoto()" style="border:none; background:none; color:#d93025; cursor:pointer;">사진 제거</button>`;
        input.value = '';
    }).catch(() => {});
}
function clearTalkCommentPhoto() {
    talkCommentPhoto = '';
    const el = document.getElementById('talkCommentPhotoPreview');
    if (el) el.innerHTML = '';
}

async function submitTalkComment() {
    if (!currentUser) return alert('로그인이 필요한 기능입니다.');
    if (!currentTalkPostId) return;
    const input = document.getElementById('talkCommentInput');
    const contentV = input.value.trim();
    if (!contentV && !talkCommentPhoto) return alert('댓글 내용을 입력해주세요.');
    try {
        const res = await fetch(`/api/talk/${currentTalkPostId}/comment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, content: contentV || '(사진)', photo: talkCommentPhoto })
        });
        if (res.ok) {
            input.value = '';
            clearTalkCommentPhoto();
            openTalkDetail(currentTalkPostId);
        } else {
            alert('댓글 등록에 실패했습니다.');
        }
    } catch (e) { console.error('댓글 등록 오류:', e); }
}

async function toggleTalkReaction(id, type) {
    if (!currentUser) return alert('로그인이 필요한 기능입니다.');
    try {
        const res = await fetch(`/api/talk/${id}/reaction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, type })
        });
        if (!res.ok) return;
        const detail = document.getElementById('talkDetailMode');
        const detailVisible = detail && detail.style.display !== 'none';
        if (detailVisible && currentTalkPostId === id) openTalkDetail(id);
        else renderTalkFeedOnly();
    } catch (e) { console.error('반응 처리 오류:', e); }
}

async function deleteTalkPost(id) {
    if (!currentUser) return;
    if (!confirm('이 글을 삭제할까요?')) return;
    try {
        const res = await fetch(`/api/talk/${id}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id, user_role: currentUser.role })
        });
        if (res.ok) { backToTalkList(); renderTalk(); }
        else { const e = await res.json().catch(() => ({})); alert(e.error || '삭제에 실패했습니다.'); }
    } catch (e) { console.error('삭제 오류:', e); }
}

// ============================================================
// 여행 홈: 카테고리 탭(숙소/관광/맛집/루트) + AI 추천/인기 장소 카드 + 검색
// ============================================================
let homeCat = 'attraction';
let homeAiPlaces = [];
let homePopularPlaces = [];
let homeSearchPlaces = [];

const HOME_CAT_LABEL = { attraction: '관광', accommodation: '숙소', restaurant: '맛집' };
const HOME_CAT_KIND = { attraction: '관광명소', accommodation: '숙소', restaurant: '맛집' };

// 여행 홈 진입(또는 탭 전환) 시 화면 구성
function enterHome() {
    if (!homeCat) homeCat = 'attraction';
    document.querySelectorAll('.home-cat').forEach(b => b.classList.toggle('active', b.dataset.cat === homeCat));
    const discover = document.getElementById('homeDiscover');
    const routes = document.getElementById('homeRoutes');
    if (homeCat === 'route') {
        if (discover) discover.style.display = 'none';
        if (routes) routes.style.display = 'block';
        renderCommunity();
    } else {
        if (routes) routes.style.display = 'none';
        if (discover) discover.style.display = 'block';
        renderHomeDiscover(homeCat);
    }
}

function setHomeCat(btn, cat) {
    homeCat = cat;
    document.querySelectorAll('.home-cat').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    clearHomeSearch();
    enterHome();
}

async function renderHomeDiscover(cat) {
    const lab = document.getElementById('homePopularCatLabel');
    if (lab) lab.textContent = HOME_CAT_LABEL[cat] || '관광';
    const ai = document.getElementById('homeAiCards');
    const pop = document.getElementById('homePopularCards');
    if (!ai || !pop) return;
    ai.innerHTML = '<div style="color:#888; padding:10px;">불러오는 중...</div>';
    pop.innerHTML = '';
    try {
        if (!allPlaces || allPlaces.length === 0) await fetchPlaces();
        let list = (allPlaces || []).filter(p => (p.category || '') === cat);
        if (list.length === 0) list = (allPlaces || []).slice();
        // 접근성 태그가 풍부한 순으로 정렬 → 추천/인기에 활용
        const ranked = list
            .map(p => ({ p, s: (p.tags || []).length }))
            .sort((a, b) => b.s - a.s)
            .map(x => x.p);
        homeAiPlaces = ranked.slice(0, 8);
        homePopularPlaces = ranked.slice(0, 12);
        ai.innerHTML = homeAiPlaces.length
            ? homeAiPlaces.map((p, i) => homeCardHTML(p, 'ai', i, true)).join('')
            : '<div style="color:#888; padding:10px;">추천할 장소가 아직 없어요.</div>';
        pop.innerHTML = homePopularPlaces.length
            ? homePopularPlaces.map((p, i) => homeCardHTML(p, 'pop', i, false)).join('')
            : '<div style="color:#888; padding:10px;">표시할 장소가 없어요.</div>';
    } catch (e) {
        console.error('여행 홈 추천 로드 오류:', e);
        ai.innerHTML = '<div style="color:#d93025;">불러오지 못했습니다.</div>';
    }
}

function homeCardHTML(p, listName, idx, isAi) {
    const tags = p.tags || [];
    const kind = HOME_CAT_KIND[p.category] || '장소';
    const aiChip = isAi
        ? '<span style="display:inline-block; background:#d2e3fc; color:#1a56c4; padding:2px 10px; border-radius:10px; font-size:0.72rem; font-weight:700; margin:6px 0;">#많이 찾는 장소</span>'
        : '';
    const tagBadges = tags.slice(0, 3).map(t => `<span style="font-size:0.7rem; color:#5f6368;">#${tEsc(t)}</span>`).join(' ');
    return `
    <div class="home-card">
        <div class="home-card-img"><i class="far fa-image"></i></div>
        <div style="font-weight:700; color:#202124; margin-top:8px;">${tEsc(p.name)}</div>
        <div style="font-size:0.78rem; color:#5f6368; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${kind} · ${tEsc(p.address || '')}</div>
        <div style="margin:4px 0; min-height:14px;">${tagBadges}</div>
        ${aiChip}
        <button onclick="homeAddToPlan('${listName}',${idx})" style="width:100%; margin-top:6px; padding:8px; border:1px solid #202124; background:#fff; border-radius:18px; cursor:pointer; font-weight:700; font-size:0.85rem;">내 일정에 담기</button>
    </div>`;
}

function homeAddToPlan(listName, idx) {
    const arr = listName === 'ai' ? homeAiPlaces : listName === 'pop' ? homePopularPlaces : homeSearchPlaces;
    const p = arr && arr[idx];
    if (!p) return;
    if (typeof openPlaceModal === 'function') openPlaceModal(p);
}

async function homeSearch() {
    const inp = document.getElementById('homeSearchInput');
    const q = (inp ? inp.value : '').trim();
    if (!q) return;
    const wrap = document.getElementById('homeSearchResultsWrap');
    const box = document.getElementById('homeSearchResults');
    if (wrap) wrap.style.display = 'block';
    if (box) box.innerHTML = '<div style="color:#888; padding:10px;">검색 중...</div>';
    try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(q));
        const data = await res.json();
        homeSearchPlaces = (Array.isArray(data) ? data : []).slice(0, 20).map(d => ({
            id: d.place_id,
            name: d.name || d.display_name,
            address: d.display_name || '',
            category: 'searched',
            tags: [],
            lat: parseFloat(d.lat),
            lng: parseFloat(d.lon)
        }));
        if (!homeSearchPlaces.length) {
            if (box) box.innerHTML = '<div style="color:#888; padding:10px;">검색 결과가 없습니다.</div>';
            return;
        }
        if (box) box.innerHTML = homeSearchPlaces.map((p, i) => homeCardHTML(p, 'search', i, false)).join('');
    } catch (e) {
        console.error('여행 홈 검색 오류:', e);
        if (box) box.innerHTML = '<div style="color:#d93025;">검색에 실패했습니다.</div>';
    }
}

function clearHomeSearch() {
    const wrap = document.getElementById('homeSearchResultsWrap');
    if (wrap) wrap.style.display = 'none';
    const box = document.getElementById('homeSearchResults');
    if (box) box.innerHTML = '';
    const inp = document.getElementById('homeSearchInput');
    if (inp) inp.value = '';
    homeSearchPlaces = [];
}

// 내 정보(자리표시)
function renderProfile() {
    const c = document.getElementById('profileContainer');
    if (!c) return;
    if (!currentUser) {
        c.innerHTML = '<p>로그인하면 내 정보를 볼 수 있어요.</p>';
        return;
    }
    c.innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px;">
            <i class="fas fa-user-circle" style="font-size:3.4rem; color:#bdc1c6;"></i>
            <div>
                <div style="font-size:1.2rem; font-weight:700; color:#202124;">${tEsc(currentUser.username)}</div>
                <div style="color:#5f6368; font-size:0.9rem;">${currentUser.role === 'admin' ? '관리자' : '일반 회원'}</div>
            </div>
        </div>
        <button onclick="window.location.href='my_routes.html'" style="padding:10px 18px; border:1px solid #dadce0; background:#fff; border-radius:8px; cursor:pointer; font-weight:600;">내 여행기(작성한 루트) 보기</button>
        <p style="margin-top:20px; color:#9aa0a6; font-size:0.85rem;">※ 내 정보 화면은 추후 확장 예정입니다.</p>`;
}

function selectDay(day) {
    currentDay = day;
    updateDayTabs();
    updatePlanUI();
}

function addDay() {
    maxDay++;
    currentDay = maxDay;
    updateDayTabs();
    updatePlanUI();
}

function updateDayTabs() {
    const container = document.getElementById('dayTabsContainer');
    if(!container) return;
    
    // Check max day in existing plan items if we loaded from DB
    const daysInPlan = planItems.map(i => i.day || 1);
    const calculatedMax = Math.max(1, maxDay, ...daysInPlan);
    maxDay = calculatedMax;

    let html = '';
    for(let i=1; i<=maxDay; i++) {
        const activeClass = (i === currentDay) ? 'active' : '';
        const style = (i === currentDay) ? 'border-bottom:2px solid var(--primary-color); font-weight:bold; color:var(--primary-color);' : '';
        html += `<button class="day-tab ${activeClass}" data-day="${i}" onclick="selectDay(${i})" style="background:none; border:none; padding:5px 10px; cursor:pointer; ${style}">${i}일차</button>`;
    }
    html += `<button id="addDayBtn" style="background:none; border:1px dashed #ccc; border-radius:4px; padding:5px 10px; cursor:pointer;" onclick="addDay()">+ 일자 추가</button>`;
    container.innerHTML = html;
}

function selectViewDay(day) {
    currentViewDay = day;
    updateViewDayTabs();
    
    // We need to re-render the view timeline for this day. 
    // Since switchView('plan-view') handles this, we can just extract the logic.
    renderViewTimeline();
}

function updateViewDayTabs() {
    const container = document.getElementById('viewDayTabsContainer');
    if(!container) return;
    
    const daysInPlan = planItems.map(i => i.day || 1);
    const viewMaxDay = Math.max(1, ...daysInPlan);

    let html = '';
    for(let i=1; i<=viewMaxDay; i++) {
        const activeClass = (i === currentViewDay) ? 'active' : '';
        const style = (i === currentViewDay) ? 'border-bottom:2px solid var(--primary-color); font-weight:bold; color:var(--primary-color);' : '';
        html += `<button class="day-tab ${activeClass}" data-day="${i}" onclick="selectViewDay(${i})" style="background:none; border:none; padding:5px 10px; cursor:pointer; ${style}">${i}일차</button>`;
    }
    container.innerHTML = html;
}


function renderViewTimeline() {
    const viewTimeline = document.getElementById('viewTimeline');
    if(!viewTimeline) return;
    viewTimeline.innerHTML = '';
    
    let totalStayTime = 0;
    let totalMoveTime = 0;
    let totalCost = 0;

    const dayItems = planItems.filter(item => (item.day || 1) === currentViewDay);

    dayItems.forEach((item, index) => {
        totalStayTime += item.stayTime;
        totalMoveTime += item.moveTime || 0;
        totalCost += item.moveCost || 0;

        if (index > 0) {
            const prev = dayItems[index - 1];
            const transportDiv = document.createElement('div');
            transportDiv.className = 'transport-info';

            // 이동 수단(버스/지하철 등)에 맞춘 노선·도착(몇 분 뒤) 안내 카드
            const mode = item.transportMode || 'walk';
            const cardWrap = document.createElement('div');
            cardWrap.innerHTML = transitLegHTML(prev, item, mode);   // 즉시 시뮬레이션
            transportDiv.appendChild(cardWrap);

            // 사용자가 기록한 소요시간/비용이 있으면 카드 아래에 함께 표시
            if ((item.moveTime || 0) > 0 || (item.moveCost || 0) > 0) {
                let moveTimeStr = `${item.moveTime || 0}분`;
                if (item.moveTime >= 60) {
                    const hours = Math.floor(item.moveTime / 60);
                    const mins = item.moveTime % 60;
                    moveTimeStr = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
                }
                const rec = document.createElement('div');
                rec.style.cssText = 'font-size:0.74rem; color:#5f6368; margin-top:4px; padding-left:2px;';
                rec.textContent = `기록: ${moveTimeStr} 소요${(item.moveCost > 0) ? ' · ' + item.moveCost.toLocaleString() + '원' : ''}`;
                transportDiv.appendChild(rec);
            }

            viewTimeline.appendChild(transportDiv);
            hydrateTransitCard(cardWrap, prev, item, mode);   // 가능하면 실데이터(Tmap)로 교체
        }

        const placeDiv = document.createElement('div');
        placeDiv.className = 'timeline-item';
        
        let tagsHtml = '';
        if(item.userTags) {
            item.userTags.forEach(tag => {
                let tagName = tag;
                if(tag === 'wheelchair') tagName = '휠체어';
                if(tag === 'elevator') tagName = '엘리베이터';
                if(tag === 'parking') tagName = '주차장';
                if(tag === 'stroller') tagName = '유모차';
                tagsHtml += `<span class="badge">${tagName}</span>`;
            });
        }

        placeDiv.innerHTML = `
            <h4>${index + 1}. ${item.name}</h4>
            ${categoryRegionChips(item)}
            <p style="font-size:0.85rem; color:#666; margin: 3px 0;">체류: ${item.stayTime}분</p>
            <div class="tags" style="margin-bottom: 5px;">${tagsHtml}</div>
            ${item.photo ? `<img src="${item.photo}" style="max-width: 100%; border-radius: 8px; margin-top: 5px;">` : ''}
            ${item.memo ? `<p style="font-size:0.85rem; background:#f8f9fa; padding:5px; border-radius:4px; margin-top:5px;">${item.memo}</p>` : ''}
        `;
        
        placeDiv.style.cursor = 'pointer';
        
        // Find absolute index in markers
        const absoluteIndex = planItems.indexOf(item);
        
        placeDiv.addEventListener('click', () => {
            if (map && markers[absoluteIndex]) {
                map.setView([item.lat, item.lng], 16);
                markers[absoluteIndex].openPopup();
            }
            document.querySelectorAll('#viewTimeline .timeline-item').forEach(el => el.style.borderLeft = 'none');
            placeDiv.style.borderLeft = '4px solid #1a73e8';
            openPlaceDetail(item, absoluteIndex);
        });

        viewTimeline.appendChild(placeDiv);
    });

    // Update Day Summary in View
    const totalTime = totalStayTime + totalMoveTime;
    let totalTimeStr = `${totalTime}분`;
    if (totalTime >= 60) {
        const h = Math.floor(totalTime / 60);
        const m = totalTime % 60;
        totalTimeStr = m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
    }

    document.getElementById('viewTotalStayTime').textContent = totalStayTime;
    document.getElementById('viewTotalMoveTime').textContent = totalMoveTime;
    document.getElementById('viewTotalTime').textContent = totalTimeStr;
    document.getElementById('viewTotalCost').textContent = totalCost.toLocaleString();

    if(map) { setTimeout(() => map.invalidateSize(), 300); }
}


function renderMyRoutes() {
    const list = document.getElementById('myRoutesContainer');
    if(!list) return;
    list.innerHTML = '';
    
    if(!currentUser) {
        list.innerHTML = '<p>로그인 후 이용 가능합니다.</p>';
        return;
    }

    const myPlans = communityPlans.filter(p => p.author_id === currentUser.id);

    if (myPlans.length === 0) {
        list.innerHTML = '<p>작성한 루트가 없습니다.</p>';
        return;
    }

    let html = '<div class="community-list">';
    myPlans.forEach(plan => {
        const places = plan.items.map(i => i.name).join(' ➔ ');
        
        const safeTitle = plan.title.replace(/'/g, "\'").replace(/"/g, '"');
        const safeAuthor = plan.author.replace(/'/g, "\'").replace(/"/g, '"');
        const safeDesc = (plan.description || '').replace(/'/g, "\'").replace(/"/g, '"').replace(/\n/g, '<br>');
        const safePlaces = places.replace(/'/g, "\'").replace(/"/g, '"');

        html += `
            <div class="community-card" style="cursor: pointer;" onclick="openCommunityPlanModal(${plan.id}, '${safeTitle}', '${safeAuthor}', ${plan.avg_rating}, '${safeDesc}', '${safePlaces}')">
                <div class="community-header">
                    <div>
                        <h3 class="community-title">${plan.title}</h3>
                    </div>
                    <div class="community-meta">
                        <span class="community-rating">평점 <i class="fas fa-star" style="color: gold;"></i> ${plan.avg_rating.toFixed(1)} (${plan.review_count}명)</span>
                    </div>
                </div>
                <div class="community-info">
                    <strong>작성자:</strong> ${plan.author}
                </div>
                <div class="community-course">
                    <strong>코스:</strong> ${places}
                </div>
            </div>
        `;
    });
    html += '</div>';
    list.innerHTML = html;
}
