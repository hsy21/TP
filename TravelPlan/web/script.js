// State Variables
let allPlaces = [];
let planItems = [];
let currentSelectedPlace = null;
let map = null;
let markers = [];
let polyline = null;
let communityPlans = [];

// DOM Elements
const searchResults = document.getElementById('searchResults');
const searchInput = document.getElementById('searchInput');
const filterBtns = document.querySelectorAll('.filter-btn');
const planTimeline = document.getElementById('planTimeline');
const modal = document.getElementById('placeModal');
const closeBtn = document.querySelector('.close-btn');
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
    
    // Filter buttons event
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const category = e.target.dataset.category;
            if (category === 'all') {
                displayPlaces(allPlaces);
            } else {
                const filtered = allPlaces.filter(p => p.category === category);
                displayPlaces(filtered);
            }
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
        switchView('plan');
    });
    
    document.getElementById('nav-community').addEventListener('click', (e) => {
        e.preventDefault();
        switchView('community');
        renderCommunity();
    });

    // Share event
    document.querySelector('.btn-share').addEventListener('click', async () => {
        if(planItems.length === 0) return alert('일정을 먼저 추가해주세요.');
        
        try {
            const res = await fetch('/api/community/share', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    author: '나(Me)',
                    title: '나의 배리어프리 서울 여행',
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

function switchView(view) {
    const navPlan = document.getElementById('nav-plan');
    const navComm = document.getElementById('nav-community');
    const planView = document.getElementById('planView');
    const mapView = document.getElementById('mapView');
    const commView = document.getElementById('communityView');
    const sidebar = document.querySelector('.sidebar');

    if (view === 'plan') {
        navPlan.classList.add('active');
        navComm.classList.remove('active');
        planView.style.display = 'flex';
        mapView.style.display = 'block';
        sidebar.style.display = 'flex';
        commView.style.display = 'none';
        if(map) {
            setTimeout(() => map.invalidateSize(), 100);
        }
    } else {
        navComm.classList.add('active');
        navPlan.classList.remove('active');
        planView.style.display = 'none';
        mapView.style.display = 'none';
        sidebar.style.display = 'none';
        commView.style.display = 'block';
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
function updateMapMarkers() {
    if(!map) return;
    
    // Clear existing
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    if(polyline) map.removeLayer(polyline);

    if(planItems.length === 0) return;

    const path = [];
    const bounds = L.latLngBounds();

    planItems.forEach((item, idx) => {
        const position = [item.lat, item.lng];
        path.push(position);
        bounds.extend(position);

        const marker = L.marker(position).addTo(map)
            .bindPopup(`<b>${idx + 1}. ${item.name}</b>`);
        
        markers.push(marker);
    });

    polyline = L.polyline(path, {
        color: '#4A90E2',
        weight: 3,
        opacity: 0.8
    }).addTo(map);

    map.fitBounds(bounds, { padding: [30, 30] });
}

// Search function
function searchPlaces() {
    const query = searchInput.value.toLowerCase();
    const filtered = allPlaces.filter(p => p.name.toLowerCase().includes(query) || p.address.toLowerCase().includes(query));
    displayPlaces(filtered);
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
    currentSelectedPlace = place;
    document.getElementById('modalPlaceName').textContent = place.name;
    
    // Reset form
    document.getElementById('stayTime').value = 60;
    document.getElementById('placeMemo').value = '';
    document.getElementById('transportMode').value = 'walk';
    document.querySelectorAll('.tag-checkbox input').forEach(cb => {
        cb.checked = place.tags.includes(cb.value);
    });

    modal.classList.add('active');
}

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

    const newItem = {
        ...currentSelectedPlace,
        stayTime,
        memo,
        transportMode,
        userTags: selectedTags,
        moveTime: planItems.length > 0 ? Math.floor(Math.random() * 30) + 10 : 0, 
        moveCost: planItems.length > 0 && transportMode === 'taxi' ? Math.floor(Math.random() * 5000) + 5000 : 0
    };

    planItems.push(newItem);
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
                <i class="far fa-calendar-plus"></i>
                <p>장소를 추가하여 일정을 만들어보세요.</p>
            </div>
        `;
        return;
    }

    planTimeline.innerHTML = '';
    let totalStayTime = 0;
    let totalMoveTime = 0;
    let totalCost = 0;

    planItems.forEach((item, index) => {
        totalStayTime += item.stayTime;
        totalMoveTime += item.moveTime;
        totalCost += item.moveCost;

        // Transport Info (from previous to current)
        if (index > 0) {
            const transportDiv = document.createElement('div');
            transportDiv.className = 'transport-info';
            
            let icon = 'fa-walking';
            if(item.transportMode === 'bus') icon = 'fa-bus';
            if(item.transportMode === 'subway') icon = 'fa-subway';
            if(item.transportMode === 'taxi') icon = 'fa-taxi';
            if(item.transportMode === 'wheelchair') icon = 'fa-wheelchair';

            transportDiv.innerHTML = `<span><i class="fas ${icon}"></i> ${item.moveTime}분 소요 ${item.moveCost > 0 ? `(${item.moveCost.toLocaleString()}원)` : ''}</span>`;
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
            <p style="font-size:0.85rem; color:#666; margin: 5px 0;"><i class="far fa-clock"></i> 체류: ${item.stayTime}분</p>
            <div class="tags" style="margin-bottom: 5px;">${tagsHtml}</div>
            ${item.memo ? `<p style="font-size:0.85rem; background:#f0f0f0; padding:5px; border-radius:4px;">${item.memo}</p>` : ''}
            <button onclick="removePlace(${index})" style="position:absolute; top:10px; right:10px; background:none; border:none; color:#dc3545; cursor:pointer;"><i class="fas fa-trash"></i></button>
        `;
        planTimeline.appendChild(placeDiv);
    });

    // Update Summary
    document.getElementById('totalStayTime').textContent = totalStayTime;
    document.getElementById('totalMoveTime').textContent = totalMoveTime;
    document.getElementById('totalTime').textContent = totalStayTime + totalMoveTime;
    document.getElementById('totalCost').textContent = totalCost.toLocaleString();

    updateMapMarkers();
}

function removePlace(index) {
    planItems.splice(index, 1);
    savePlanToServer();
    updatePlanUI();
}

// Community Rendering
function renderCommunity() {
    const list = document.getElementById('communityList');
    list.innerHTML = '';

    communityPlans.forEach(plan => {
        const div = document.createElement('div');
        div.style.background = '#fff';
        div.style.padding = '1.5rem';
        div.style.borderRadius = '8px';
        div.style.marginBottom = '1rem';
        div.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';

        const places = plan.items.map(i => i.name).join(' ➔ ');

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                <h3 style="color:var(--primary-color)">${plan.title}</h3>
                <span style="color:#666; font-size:0.9rem;"><i class="fas fa-heart" style="color:red"></i> ${plan.likes}</span>
            </div>
            <p style="margin-bottom: 0.5rem;"><strong>작성자:</strong> ${plan.author}</p>
            <p style="margin-bottom: 1rem; color:#555; font-size:0.9rem;"><strong>코스:</strong> ${places}</p>
            <button class="btn-fork" style="background:var(--primary-color); color:#fff; border:none; padding:8px 16px; border-radius:4px; cursor:pointer;" onclick="forkPlan(${plan.id})">
                <i class="fas fa-code-branch"></i> 내 일정으로 가져오기 (Fork)
            </button>
        `;
        list.appendChild(div);
    });
}

async function forkPlan(id) {
    if(confirm('이 일정을 내 일정으로 복사하시겠습니까? 기존 내 일정은 덮어씌워집니다.')) {
        try {
            const res = await fetch('/api/community/fork', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plan_id: id })
            });
            if(res.ok) {
                await fetchMyPlan();
                alert('일정을 성공적으로 가져왔습니다!');
                switchView('plan');
                updatePlanUI();
            }
        } catch(e) {
            console.error("Fork error:", e);
        }
    }
}
