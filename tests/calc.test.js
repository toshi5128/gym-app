import { describe, it, expect } from 'vitest'
import K from '../keiryo-calc.js'

/**
 * ブラウザが読むのと「同じ1ファイル」を検証している。コピーは存在しない。
 * 仕様書 = KEIRYO-SPEC-v2.md
 */

/** 仕様書 §1 の実測データ（2026-07-18 計測） */
const MEASURED = {
  heightCm: 176.0,
  weightKg: 83.3,
  bodyFatPct: 15.7,
  skeletalMuscleKg: 40.1,
  bmrOnScale: 1887,
}

describe('§1 検算 — 仕様書の数値がそのまま出ること', () => {
  const lbm = K.resolveLbm({ weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct })

  it('LBM = 70.2 kg', () => {
    expect(lbm).toBe(70.2)
    expect(K.lbmFromBodyFat(MEASURED.weightKg, MEASURED.bodyFatPct)).toBeCloseTo(70.2, 1)
  })

  it('BMR = 1886 kcal（体組成計の 1887 とほぼ一致）', () => {
    const bmr = K.bmrFromLbm(lbm)
    expect(Math.round(bmr)).toBe(1886)
    expect(Math.abs(bmr - MEASURED.bmrOnScale)).toBeLessThan(2)
  })

  it('TDEE = 2735 kcal（活動係数 1.45）', () => {
    expect(Math.round(K.tdeeFromBmr(K.bmrFromLbm(lbm), 1.45))).toBe(2735)
  })

  it('目標 = 2,200 kcal（TDEE - 550 を 50 単位で丸め）', () => {
    expect(K.roundKcal(K.tdeeFromBmr(K.bmrFromLbm(lbm), 1.45) - 550)).toBe(2200)
  })

  it('PFC = P170 / F60 / C245', () => {
    const plan = K.buildPlan({ body: { weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct } })
    expect(plan.kcal).toBe(2200)
    expect(plan.proteinG).toBe(170)
    expect(plan.fatG).toBe(60)
    expect(plan.carbG).toBe(245)
  })

  it('PFC のカロリー合計が目標と一致する', () => {
    const plan = K.buildPlan({ body: { weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct } })
    expect(plan.proteinG * 4 + plan.fatG * 9 + plan.carbG * 4).toBe(plan.kcal)
  })

  it('比率 P31% / F25% / C44%（表示は四捨五入前提）', () => {
    const plan = K.buildPlan({ body: { weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct } })
    expect(plan.ratio.protein).toBeCloseTo(30.9, 1)
    expect(plan.ratio.fat).toBeCloseTo(24.5, 1)
    expect(plan.ratio.carb).toBeCloseTo(44.5, 1)
  })

  it('buildPlan が LBM / BMR / TDEE も返す', () => {
    const plan = K.buildPlan({ body: { weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct } })
    expect(plan.lbmKg).toBeCloseTo(70.2, 1)
    expect(Math.round(plan.bmr)).toBe(1886)
    expect(Math.round(plan.tdee)).toBe(2735)
  })
})

describe('§1 骨格筋量→LBM の係数は 1.85 ではなく 1.75', () => {
  it('係数が 1.75', () => {
    expect(K.SMM_TO_LBM).toBe(1.75)
  })

  it('実測 40.1kg から LBM 70.2kg 付近が出る', () => {
    expect(K.lbmFromSkeletalMuscle(MEASURED.skeletalMuscleKg)).toBeCloseTo(70.2, 0)
  })

  it('1.85 だと LBM を約4kg 過大評価してしまう（回帰防止）', () => {
    const wrong = MEASURED.skeletalMuscleKg * 1.85
    expect(wrong).toBeGreaterThan(74)
    expect(wrong - K.lbmFromSkeletalMuscle(MEASURED.skeletalMuscleKg)).toBeGreaterThan(3.9)
  })
})

describe('§1 活動係数 1.45 が選択肢にある', () => {
  it('1.45 が存在する', () => {
    expect(K.ACTIVITY_LEVELS.map((a) => a.value)).toContain(1.45)
  })
})

describe('§2 ゴールは体脂肪率から逆算する（体重を直接入力させない）', () => {
  const lbm = K.resolveLbm({ weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct })

  it.each([
    [12, 79.8],
    [10, 78.0],
    [8, 76.3],
  ])('体脂肪 %i%% → 目標体重 %f kg', (pct, expected) => {
    expect(K.goalFromTargetBodyFat(lbm, MEASURED.weightKg, pct).goalWeightKg).toBeCloseTo(expected, 1)
  })

  it('目標8% は現在から -7.0kg', () => {
    expect(K.goalFromTargetBodyFat(lbm, MEASURED.weightKg, 8).fatToLoseKg).toBeCloseTo(7.0, 1)
  })

  it('体脂肪率 0% 以下・100% 以上は弾く', () => {
    expect(() => K.goalFromTargetBodyFat(lbm, MEASURED.weightKg, 0)).toThrow()
    expect(() => K.goalFromTargetBodyFat(lbm, MEASURED.weightKg, 100)).toThrow()
  })
})

describe('§8 着地予定は固定文字ではなく実ペースから引き直す', () => {
  it('週 -0.45kg なら約15.6週後', () => {
    const r = K.projectLandingDate(83.3, 76.3, -0.45, new Date(2026, 7, 5))
    expect(r).not.toBeNull()
    expect(r.weeksRemaining).toBeCloseTo(15.6, 1)
    expect(r.date.getFullYear()).toBe(2026)
    expect(r.date.getMonth() + 1).toBe(11)
  })

  it('ペースが遅ければ着地も後ろにずれる', () => {
    const fast = K.projectLandingDate(83.3, 76.3, -0.5, new Date(2026, 7, 5))
    const slow = K.projectLandingDate(83.3, 76.3, -0.3, new Date(2026, 7, 5))
    expect(slow.date.getTime()).toBeGreaterThan(fast.date.getTime())
  })

  it('減っていない（0 以上）なら予測不能で null', () => {
    expect(K.projectLandingDate(83.3, 76.3, 0, new Date(2026, 7, 5))).toBeNull()
    expect(K.projectLandingDate(83.3, 76.3, 0.2, new Date(2026, 7, 5))).toBeNull()
  })

  it('すでに目標到達なら 0週', () => {
    expect(K.projectLandingDate(76.0, 76.3, -0.4, new Date(2026, 7, 5)).weeksRemaining).toBe(0)
  })
})

describe('§7 下限ガード — 変更点①「週平均で判定する」', () => {
  const bmr = K.bmrFromLbm(K.resolveLbm({ weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct }))

  it('閾値: 警告 2075 / 停止 1886', () => {
    const r = K.evaluateCalorieSafety(2200, bmr)
    expect(Math.round(r.warnThreshold)).toBe(2075)
    expect(Math.round(r.stopThreshold)).toBe(1886)
  })

  it('目標 2,200 は安全（BMR×1.2=2263 は下回るが v2 の閾値では ok）', () => {
    expect(K.evaluateCalorieSafety(2200, bmr).level).toBe('ok')
  })

  it('★変更点①: 外食週の平日目標 2,050 を日次で判定すると warn になってしまう', () => {
    expect(K.evaluateCalorieSafety(2050, bmr).level).toBe('warn')
  })

  it('★変更点①: 週平均で判定すれば外食週でも ok のまま', () => {
    expect(K.evaluateCalorieSafety((2200 * 7) / 7, bmr).level).toBe('ok')
  })

  it('BMR を下回る設定は blocked', () => {
    expect(K.evaluateCalorieSafety(1800, bmr).level).toBe('blocked')
  })
})

describe('§7 週次レビュー — 判断は7日移動平均のみ', () => {
  const w = (thisWeekAvgKg) => K.reviewWeek({ thisWeekAvgKg, lastWeekAvgKg: 83.0 })

  it('-0.8kg → 落としすぎ、+150kcal', () => {
    expect(w(82.2).verdict).toBe('too_fast')
    expect(w(82.2).kcalAdjustment).toBe(150)
  })

  it('-0.5kg → 順調、変更なし', () => {
    expect(w(82.5).verdict).toBe('on_track')
    expect(w(82.5).kcalAdjustment).toBe(0)
  })

  it('-0.2kg → やや停滞、経過観察（変更なし）', () => {
    expect(w(82.8).verdict).toBe('slowing')
    expect(w(82.8).kcalAdjustment).toBe(0)
  })

  it('0kg 1週目 → 停滞だがまだ動かさない', () => {
    expect(w(83.0).verdict).toBe('stalled')
    expect(w(83.0).kcalAdjustment).toBe(0)
  })

  it('0kg 2週連続 → -100kcal を提案', () => {
    expect(K.reviewWeek({ thisWeekAvgKg: 83.0, lastWeekAvgKg: 83.0, stalledLastWeek: true }).kcalAdjustment).toBe(-100)
  })

  it('カロリー削減と有酸素を同時に提案しない', () => {
    const r = K.reviewWeek({ thisWeekAvgKg: 83.0, lastWeekAvgKg: 83.0, stalledLastWeek: true })
    expect(r.kcalAdjustment !== 0 && r.suggestCardio).toBe(false)
  })

  it('★浮動小数点バグの回帰防止: ちょうど -0.7kg は on_track', () => {
    // 82.3 - 83.0 は -0.7000000000000028 になる。丸めないと too_fast に誤判定される
    expect(w(82.3).verdict).toBe('on_track')
    expect(w(82.7).verdict).toBe('on_track')
  })

  it('骨格筋が2週で -0.5kg 以上 → カロリー設定に関わらず +200kcal を最優先', () => {
    const r = K.reviewWeek({ thisWeekAvgKg: 82.2, lastWeekAvgKg: 83.0, smmChange2WeeksKg: -0.6 })
    expect(r.kcalAdjustment).toBe(200)
  })
})

describe('§7 カロリー調整は C だけで行う。P と F は減らさない', () => {
  const plan = K.buildPlan({ body: { weightKg: MEASURED.weightKg, bodyFatPct: MEASURED.bodyFatPct } })

  it('+150kcal は C を +38g するだけ', () => {
    const next = K.applyAdjustment(plan, 150)
    expect(next.proteinG).toBe(170)
    expect(next.fatG).toBe(60)
    expect(next.carbG).toBe(245 + 38)
  })

  it('-100kcal でも P/F は不変', () => {
    const next = K.applyAdjustment(plan, -100)
    expect(next.proteinG).toBe(170)
    expect(next.fatG).toBe(60)
    expect(next.carbG).toBe(245 - 25)
  })

  it('C は 100g を下回らない', () => {
    expect(K.applyAdjustment(plan, -2000).carbG).toBe(100)
  })
})

describe('§6/§7 7日移動平均 — 参考値は除外する', () => {
  const days = Array.from({ length: 7 }, (_, i) => ({
    logDate: `2026-07-${String(12 + i).padStart(2, '0')}`,
    weightKg: 83.0 + i * 0.1,
  }))

  it('7日ぶんの平均が出る', () => {
    expect(K.movingAverage(days, '2026-07-18')).toBeCloseTo(83.3, 2)
  })

  it('参考値フラグの記録は平均から除外される', () => {
    const withRef = [...days, { logDate: '2026-07-18', weightKg: 90.0, isReference: true }]
    expect(K.movingAverage(withRef, '2026-07-18')).toBeCloseTo(83.3, 2)
  })

  it('窓の外の記録は無視する', () => {
    const withOld = [...days, { logDate: '2026-07-01', weightKg: 99.0 }]
    expect(K.movingAverage(withOld, '2026-07-18')).toBeCloseTo(83.3, 2)
  })

  it('有効な記録が無ければ null', () => {
    expect(K.movingAverage([], '2026-07-18')).toBeNull()
  })
})
