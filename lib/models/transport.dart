// models/transport.dart
enum TransportType { bus, subway, walk, bicycle, wheelchair, taxi }

class RouteSegment {
  TransportType transportType;
  int estimatedTimeMinutes; // 이동 소요 시간
  double distanceMeters;    // 이동 거리
  int estimatedCost;        // 예상 비용 (요금 체계 반영)

  RouteSegment({
    required this.transportType,
    required this.estimatedTimeMinutes,
    required this.distanceMeters,
    required this.estimatedCost,
  });
}
