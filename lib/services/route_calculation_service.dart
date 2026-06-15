// services/route_calculation_service.dart
import '../models/place.dart';
import '../models/transport.dart';
import 'dart:math';

class RouteCalculationService {
  // 장소와 장소 사이의 이동 거리 산출 및 이동수단 기반 예상 소요 시간/비용 계산 (Open API 모의 구현)
  Future<RouteSegment> calculateRoute(Place origin, Place destination, TransportType transportType) async {
    // 실제 구현 시 Google Maps API, OSRM, 카카오 모빌리티 API 등 호출
    // 여기서는 예시를 위해 더미 데이터 산출
    
    double distance = _calculateDistance(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
    
    int timeMinutes = 0;
    int cost = 0;

    switch (transportType) {
      case TransportType.walk:
      case TransportType.wheelchair:
        timeMinutes = (distance / 80).round(); // 분당 80m
        cost = 0;
        break;
      case TransportType.bicycle:
        timeMinutes = (distance / 250).round(); // 분당 250m
        cost = 0;
        break;
      case TransportType.bus:
      case TransportType.subway:
        timeMinutes = (distance / 500).round() + 10; // 분당 500m + 대기시간 10분
        cost = 1500; // 기본 대중교통 요금
        break;
      case TransportType.taxi:
        timeMinutes = (distance / 600).round() + 5; // 분당 600m + 대기 5분
        cost = 3800 + ((distance / 132).round() * 100); // 기본요금 3800원 + 132m당 100원
        break;
    }

    return RouteSegment(
      transportType: transportType,
      estimatedTimeMinutes: timeMinutes,
      distanceMeters: distance,
      estimatedCost: cost,
    );
  }

  // Haversine formula for distance
  double _calculateDistance(double lat1, double lon1, double lat2, double lon2) {
    var p = 0.017453292519943295;
    var c = cos;
    var a = 0.5 - c((lat2 - lat1) * p)/2 + 
          c(lat1 * p) * c(lat2 * p) * 
          (1 - c((lon2 - lon1) * p))/2;
    return 12742 * asin(sqrt(a)) * 1000; // in meters
  }
}
