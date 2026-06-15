// services/recommendation_service.dart
import '../models/travel_plan.dart';

class RecommendationService {
  // 검색 및 노출 가중치 알고리즘
  // 평가 데이터(averageRating)와 평점 누적 수(reviewCount)를 바탕으로 점수 산출
  List<TravelPlan> getRecommendedPlans(List<TravelPlan> allPublicPlans) {
    // 가중치 적용: 평점(70%) + 리뷰수(30% - 리뷰 100개 기준 정규화)
    allPublicPlans.sort((a, b) {
      double scoreA = _calculateScore(a);
      double scoreB = _calculateScore(b);
      return scoreB.compareTo(scoreA); // 내림차순 정렬
    });
    
    return allPublicPlans;
  }

  double _calculateScore(TravelPlan plan) {
    double normalizedReviewCount = (plan.reviewCount / 100.0).clamp(0.0, 1.0);
    return (plan.averageRating * 0.7) + (normalizedReviewCount * 5.0 * 0.3);
  }

  // 평가 시스템
  void ratePlan(TravelPlan plan, double newRating) {
    double totalScore = (plan.averageRating * plan.reviewCount) + newRating;
    plan.reviewCount += 1;
    plan.averageRating = totalScore / plan.reviewCount;
  }
}
