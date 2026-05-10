// models/travel_plan.dart
import 'place.dart';
import 'transport.dart';
import 'dart:math';

class TravelPlan {
  String id;
  String title;
  String authorId;
  List<Place> places;
  List<RouteSegment> routes; // places 간의 경로 정보
  double averageRating;
  int reviewCount;
  bool isPublic;

  TravelPlan({
    required this.id,
    required this.title,
    required this.authorId,
    this.places = const [],
    this.routes = const [],
    this.averageRating = 0.0,
    this.reviewCount = 0,
    this.isPublic = false,
  });

  // 총 소요 시간 산출: 장소 체류 시간 합 + 이동 소요 시간 합
  int get totalEstimatedTimeMinutes {
    int stayTime = places.fold(0, (sum, place) => sum + place.stayDurationMinutes);
    int travelTime = routes.fold(0, (sum, route) => sum + route.estimatedTimeMinutes);
    return stayTime + travelTime;
  }

  // 데이터 무결성 보장을 위한 복제(Fork) 기능
  TravelPlan fork(String newAuthorId) {
    String newId = 'plan_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(1000)}';
    return TravelPlan(
      id: newId,
      title: '$title (Forked)',
      authorId: newAuthorId,
      places: places.map((p) => p.copyWith(id: 'place_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(1000)}')).toList(),
      routes: List.from(routes), // 값 복사
      averageRating: 0.0,
      reviewCount: 0,
      isPublic: false, // 복제본은 기본적으로 비공개
    );
  }
}
