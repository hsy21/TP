// models/place.dart
class Place {
  String id;
  String name;
  String category; // 맛집, 관광, 숙소 등
  String? memo;
  List<String> tags; // 이동수단, 임산부, 노약자, 장애인 등
  int stayDurationMinutes; // 체류 예상 시간 (분)
  double latitude;
  double longitude;

  Place({
    required this.id,
    required this.name,
    required this.category,
    this.memo,
    this.tags = const [],
    this.stayDurationMinutes = 60,
    required this.latitude,
    required this.longitude,
  });

  Place copyWith({
    String? id,
    String? name,
    String? category,
    String? memo,
    List<String>? tags,
    int? stayDurationMinutes,
    double? latitude,
    double? longitude,
  }) {
    return Place(
      id: id ?? this.id,
      name: name ?? this.name,
      category: category ?? this.category,
      memo: memo ?? this.memo,
      tags: tags ?? List.from(this.tags),
      stayDurationMinutes: stayDurationMinutes ?? this.stayDurationMinutes,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
    );
  }
}
