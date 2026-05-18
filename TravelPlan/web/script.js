// State Variables
let allPlaces = [];
let planItems = [];
let currentSelectedPlace = null;
let map = null;
let markers = [];
let polyline = null;
let communityPlans = [];
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
    const navMyRoutes = document.getElementById('nav-my-routes');
    if (navMyRoutes) {
        navMyRoutes.addEventListener('click', () => {
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

    document.getElementById('logoutBtn').addEventListener('click', () => {
        currentUser = null;
        localStorage.removeItem('currentUser');
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
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if(data.success) {
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateAuthUI();
                loginModal.classList.remove('active');
                renderCommunity(); // Re-render to update permissions
            } else {
                alert('로그인 실패: ' + (data.error || '알 수 없는 오류'));
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
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p })
            });
            const data = await res.json();
            if(data.success) {
                alert('회원가입이 완료되었습니다! 자동으로 로그인됩니다.');
                currentUser = data.user;
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateAuthUI();
                loginModal.classList.remove('active');
                renderCommunity();
            } else {
                alert('회원가입 실패: ' + (data.error || '알 수 없는 오류'));
            }
        } catch(e) {
            console.error("Signup error", e);
        }
    });

    // Share event
    const btnShare = document.getElementById('btnShareMode') || document.querySelector('.btn-share');
    if (btnShare) {
        btnShare.addEventListener('click', async () => {
            if (!currentUser) return alert('일정을 등록하려면 먼저 로그인해주세요.');
            if(planItems.length === 0) return alert('일정을 먼저 추가해주세요.');
            
            const title = prompt('일정의 제목을 입력해주세요:', `${currentUser.username}의 추천 일정`);
            if(!title) return;

            try {
                const res = await fetch('/api/community/share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        author: currentUser.username,
                        author_id: currentUser.id,
                        title: title,
                        description: document.getElementById('planDescription').value || '',
                        items: planItems
                    })
                });
                if(res.ok) {
                    alert('커뮤니티에 일정이 공유되었습니다!');
                    await fetchCommunityPlans(); // 새로고침
                }
            } catch (e) {
                console.error(e);
                alert('공유 실패');
            }
        });
    }
});

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

async function fetchCommunityPlans() {
    try {
        const res = await fetch('/api/community');
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
let currentDesktopView = 'plan-edit';
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
    const sidebar = document.querySelector('.sidebar');

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
                nearbyList.innerHTML += `
                    <div style="padding:10px; border:1px solid #dadce0; border-radius:4px; cursor:pointer; background:#fff;" onclick="forkPlan(${p.id})">
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
        navComm.classList.add('active');
        navPlan.classList.remove('active');
        planView.style.display = 'none';
        if(viewBoard) viewBoard.style.display = 'none';
        mapView.style.display = 'none';
        sidebar.style.display = 'none';
        commView.style.display = 'block';
        if(myRoutesView) myRoutesView.style.display = 'none';

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

    let searchQuery = query + ' 대한민국';
    
    // API Call
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        
        let places = data.map(item => {
            let cat = 'searched';
            let itemType = (item.type || '').toLowerCase();
            let itemClass = (item.class || '').toLowerCase();
            let dispName = (item.display_name || '').toLowerCase();

            if (['restaurant', 'cafe', 'fast_food', 'food_court', 'bar'].includes(itemType) || dispName.includes('식당') || dispName.includes('맛집') || dispName.includes('카페')) cat = 'restaurant';
            else if (['hotel', 'guest_house', 'motel', 'hostel'].includes(itemType) || dispName.includes('호텔') || dispName.includes('숙소') || dispName.includes('모텔') || dispName.includes('펜션')) cat = 'accommodation';
            else if (['attraction', 'museum', 'theme_park', 'zoo', 'park', 'viewpoint'].includes(itemType) || dispName.includes('관광지') || dispName.includes('공원') || dispName.includes('명소')) cat = 'attraction';

            const p = {
                id: item.place_id,
                name: item.name || item.display_name.split(',')[0],
                address: item.display_name,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                category: cat,
                tags: []
            };
            
            p.tags = [...new Set([...p.tags, ...generateAITags(p)])];
            return p;
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

        item.innerHTML = `
            <h4>${place.name}</h4>
            <p>${place.address}</p>
            <div class="tags">${tagsHtml}</div>
        `;
        
        item.addEventListener('click', () => openPlaceModal(place));
        searchResults.appendChild(item);
    });
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
            <p style="font-size:0.85rem; color:#666; margin: 3px 0;">체류: ${item.stayTime}분</p>
            <div class="tags" style="margin-bottom: 5px;">${tagsHtml}</div>
            ${item.photo ? `<img src="${item.photo}" style="max-width: 100%; border-radius: 8px; margin-top: 5px;">` : ''}
            ${item.memo ? `<p style="font-size:0.85rem; background:#f8f9fa; padding:5px; border-radius:4px; margin-top:5px;">${item.memo}</p>` : ''}
            <div style="position:absolute; top:10px; right:10px; display:flex; gap:5px;">
                <button onclick="event.stopPropagation(); editPlace(${index})" style="background:none; border:none; color:#1a73e8; cursor:pointer; font-size:0.9rem;">수정</button>
                <button onclick="event.stopPropagation(); removePlace(${index})" style="background:none; border:none; color:#d93025; cursor:pointer; font-size:0.9rem;">삭제</button>
            </div>
        `;
        
        // Add click event to focus on map
        placeDiv.style.cursor = 'pointer';
        placeDiv.addEventListener('click', () => {
            if (map && markers[planItems.indexOf(item)]) {
                map.setView([item.lat, item.lng], 16);
                markers[planItems.indexOf(item)].openPopup();
                
                // Highlight selected item in UI visually (optional)
                document.querySelectorAll('.timeline-item').forEach(el => el.style.borderLeft = 'none');
                placeDiv.style.borderLeft = '4px solid #1a73e8';
            }
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

// Community Rendering
function renderCommunity() {
    const list = document.getElementById('communityContainer');
    if(!list) return;
    list.innerHTML = '';
    
    let filteredPlans = communityPlans;
    if(currentUser) {
        filteredPlans = communityPlans.filter(p => p.author_id !== currentUser.id);
    }

    // 추천 루트: 평점 높은 순, 같으면 리뷰 수 많은 순, 같으면 최신 순 (리뷰 없어도 보여줌)
    const recommendedPlans = [...filteredPlans]
        .sort((a, b) => b.avg_rating - a.avg_rating || b.review_count - a.review_count || b.id - a.id)
        .slice(0, 3); // 상위 3개만 추천
        
    // 최근 등록 루트 (전체)
    const recentPlans = [...filteredPlans].sort((a, b) => b.id - a.id);

    const renderCards = (plansArray, title) => {
        if (plansArray.length === 0) return '';
        
        let html = `<h3 style="margin: 2rem 0 1rem 0; color: #202124;">${title}</h3>`;
        html += `<div class="community-list">`;
        
        plansArray.forEach(plan => {
            const places = plan.items.map(i => i.name).join(' ➔ ');
            
            let reviewHtml = '';
            if(plan.reviews && plan.reviews.length > 0) {
                reviewHtml = '<div class="review-section"><div class="review-title">리뷰:</div>';
                plan.reviews.forEach(r => {
                    const stars = Array(r.rating).fill('★').join('');
                    reviewHtml += `<div class="review-item"><strong>${r.username}</strong>: ${stars} ${r.review}</div>`;
                });
                reviewHtml += '</div>';
            }

            // Delete permission
            let deleteBtn = '';
            if(currentUser && (currentUser.role === 'admin' || currentUser.id === plan.author_id)) {
                deleteBtn = `<button onclick="deletePlan(${plan.id})" class="btn-google btn-google-danger">삭제</button>`;
            }

            // Review permission
            let reviewBtn = '';
            if(!currentUser || (currentUser && currentUser.id !== plan.author_id)) {
                const safeTitle = plan.title.replace(/'/g, "\\'").replace(/"/g, '"');
                reviewBtn = `<button onclick="openReviewModal(${plan.id}, '${safeTitle}')" class="btn-google btn-google-secondary">평가 남기기</button>`;
            }

            const safeTitle = plan.title.replace(/'/g, "\\'").replace(/"/g, '"');
            const safeAuthor = plan.author.replace(/'/g, "\\'").replace(/"/g, '"');
            const safeDesc = (plan.description || '').replace(/'/g, "\\'").replace(/"/g, '"').replace(/\n/g, '<br>');
            const safePlaces = places.replace(/'/g, "\\'").replace(/"/g, '"');

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
        html += `</div>`;
        return html;
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

async function forkPlan(id) {
    try {
        const res = await fetch(`/api/community/${id}/details`);
        if(res.ok) {
            const data = await res.json();
            
            // Save current state to undo stack
            saveToUndo();
            
            // Add fetched items to currentDay
            data.items.forEach(item => {
                planItems.push({
                    ...item,
                    day: currentDay
                });
            });

            // Append description
            const descArea = document.getElementById('planDescription');
            if(descArea) {
                descArea.value += (descArea.value ? '\n' : '') + (data.description || '');
            }

            const cpModal = document.getElementById('communityPlanModal');
            if(cpModal) cpModal.classList.remove('active');
            
            await savePlanToServer();
            updateDayTabs();
            updatePlanUI();
            switchView('plan-edit');
            alert(`${currentDay}일차에 루트가 적용되었습니다!`);
        }
    } catch(e) {
        console.error("Fork error:", e);
    }
}

function openCommunityPlanModal(id, title, author, rating, desc, places) {
    const plan = communityPlans.find(p => p.id === id);
    if (!plan) return;

    document.getElementById('cpModalTitle').textContent = title;
    document.getElementById('cpModalAuthor').textContent = author;
    document.getElementById('cpModalRating').innerHTML = `평점 <i class="fas fa-star" style="color: gold;"></i> ${rating.toFixed(1)} (${plan.review_count}명)`;
    document.getElementById('cpModalDescription').innerHTML = desc || '등록된 설명이 없습니다.';
    
    // Places list
    const placesDiv = document.getElementById('cpModalPlaces');
    placesDiv.innerHTML = '';
    plan.items.forEach((item, idx) => {
        let photoHtml = item.photo ? `<div style="margin-top:5px;"><img src="${item.photo}" style="max-width: 100%; border-radius:4px;"></div>` : '';
        placesDiv.innerHTML += `<div style="padding:8px; background:#f1f3f4; border-radius:4px; margin-bottom:4px;">${idx + 1}. ${item.name}${photoHtml}</div>`;
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

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-google btn-google-primary';
    applyBtn.textContent = '적용하기';
    applyBtn.onclick = () => forkPlan(id);
    actionsDiv.appendChild(applyBtn);

    if(!currentUser || (currentUser && currentUser.id !== plan.author_id)) {
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'btn-google btn-google-secondary';
        reviewBtn.textContent = '평가 남기기';
        reviewBtn.onclick = () => {
            document.getElementById('communityPlanModal').classList.remove('active');
            openReviewModal(id, title);
        };
        actionsDiv.appendChild(reviewBtn);
    }

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
            const transportDiv = document.createElement('div');
            transportDiv.className = 'transport-info';
            
            let modeName = '도보';
            if(item.transportMode === 'bus') modeName = '버스';
            if(item.transportMode === 'subway') modeName = '지하철';
            if(item.transportMode === 'taxi') modeName = '택시';
            if(item.transportMode === 'wheelchair') modeName = '휠체어';

            let moveTimeStr = `${item.moveTime || 0}분`;
            if (item.moveTime >= 60) {
                const hours = Math.floor(item.moveTime / 60);
                const mins = item.moveTime % 60;
                moveTimeStr = mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
            }

            transportDiv.innerHTML = `<span>[${modeName}] ${moveTimeStr} 소요 ${(item.moveCost > 0) ? '(' + item.moveCost.toLocaleString() + '원)' : ''}</span>`;
            viewTimeline.appendChild(transportDiv);
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
                document.querySelectorAll('#viewTimeline .timeline-item').forEach(el => el.style.borderLeft = 'none');
                placeDiv.style.borderLeft = '4px solid #1a73e8';
            }
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
