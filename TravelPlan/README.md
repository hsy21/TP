# TravelPlan

# 프로젝트 개요
교통약자(임산부, 노약자, 장애인 등)를 포함한 모든 사용자를 고려한 맞춤형 여행 일정 계획 웹/앱입니다.

## 파일 구조 및 주요 기능 구현 현황

# 1. 
- 장소 및 메모 추가, 카테고리 분류(맛집, 관광 등)
- 맞춤형 태그 시스템 (이동수단, 임산부, 노약자, 장애인 등)
- 체류 시간 설정 (stayDurationMinutes)
- 독립적 수정을 위한 `copyWith` 복제 기능

# 2.
- 이동수단 옵션 (버스, 지하철, 도보, 자전거, 휠체어, 택시)
- 경로 데이터 (소요시간, 이동거리, 예상 비용)

# 3.
- 커뮤니티 공유 상태 관리 (`isPublic`)
- 전체 소요 시간 자동 도출 (`totalEstimatedTimeMinutes`: 체류시간 + 이동소요시간)
- 계획 적용(Fork) 기능: 원본 데이터 무결성을 유지하며 타인의 계획을 내 것으로 완전히 독립적으로 복제하는 `fork()` 메서드 구현

# 4.
- Open API를 모의한 경로 데이터 자동 계산 로직
- 장소간 거리 산출 (Haversine formula 적용)
- 선택한 이동수단별 소요 시간 및 택시비/대중교통비 예상 비용 산출 로직

# 5.
- 평가 시스템 및 추천 노출 알고리즘
- 누적 평가 데이터(averageRating)와 평점 누적 수(reviewCount)를 바탕으로 가중치를 적용한 `getRecommendedPlans` 정렬 로직

# 향후 진행(UI 및 API 연동)
현재 시스템에 Flutter가 설치되어 있지 않아, 초기 핵심 비즈니스 로직 중심으로 작성되었습니다. 향후 Flutter 환경 세팅 후:
1. `google_maps_flutter` 및 'google_maps_route' 등 대중교통 Open API 패키지 연동
2. Firebase 연동 및 데이터베이스(Firestore) 구축
3. UI 화면(Plan List, Map View, Fork/Share UI)을 구현.
