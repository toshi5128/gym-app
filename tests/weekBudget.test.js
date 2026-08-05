import { describe, it, expect } from 'vitest'
import K from '../keiryo-calc.js'

const DAILY = 2200
/** 2026-07-18(土) を外食日とする週。月曜は 7/13 */
const SATURDAY = '2026-07-18'

describe('§4-2 週予算の再配分 — 仕様書の例がそのまま出ること', () => {
  const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 3000 })

  it('週予算 = 2,200 × 7 = 15,400 kcal', () => {
    expect(plan.weeklyBudgetKcal).toBe(15400)
  })

  it('外食日を除く残りは6日', () => {
    expect(plan.normalDays).toBe(6)
  })

  it('(15,400 - 3,000) ÷ 6 = 2,066.7 → 平日目標 2,050 kcal', () => {
    expect(plan.normalTargetKcal).toBe(2050)
  })

  it('50kcal 単位は「切り捨て」。切り上げると週予算を超えてしまう', () => {
    expect(2100 * 6 + 3000).toBeGreaterThan(plan.weeklyBudgetKcal)
    expect(plan.allocatedKcal).toBeLessThanOrEqual(plan.weeklyBudgetKcal)
  })

  it('割り当て合計 15,300 / 余り 100 kcal（安全側のバッファ）', () => {
    expect(plan.allocatedKcal).toBe(15300)
    expect(plan.slackKcal).toBe(100)
  })
})

describe('§4-2 外食日の指定パターン', () => {
  it('外食日ゼロなら平日目標は日次目標のまま', () => {
    const plan = K.planWeek({ dailyTargetKcal: DAILY })
    expect(plan.normalDays).toBe(7)
    expect(plan.normalTargetKcal).toBe(2200)
    expect(plan.slackKcal).toBe(0)
  })

  it('外食2日なら平日目標はさらに下がる', () => {
    const plan = K.planWeek({
      dailyTargetKcal: DAILY,
      eatOutDates: ['2026-07-18', '2026-07-19'],
      eatOutKcal: 3000,
    })
    // (15400 - 6000) / 5 = 1880 → 1850
    expect(plan.normalDays).toBe(5)
    expect(plan.normalTargetKcal).toBe(1850)
  })

  it('外食の想定カロリーが低ければ平日はゆるくなる', () => {
    const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 2500 })
    expect(plan.normalTargetKcal).toBe(2150)
  })

  it('外食の想定が週予算を食い尽くす場合は警告を出す', () => {
    const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 20000 })
    expect(plan.warnings.length).toBeGreaterThan(0)
    expect(plan.normalTargetKcal).toBe(0)
  })

  it('外食日の初期値は 3,000 kcal', () => {
    expect(K.DEFAULT_EAT_OUT_KCAL).toBe(3000)
  })

  it('その日の目標は外食日なら想定値、平日なら再配分値', () => {
    const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 3000 })
    expect(K.dailyTargetFor(plan, SATURDAY)).toBe(3000)
    expect(K.dailyTargetFor(plan, '2026-07-15')).toBe(2050)
  })

  it('曜日固定（土曜）からその週の外食日が求まる', () => {
    expect(K.eatOutDateForWeek('2026-07-15', 6)).toBe('2026-07-18')
    expect(K.eatOutDateForWeek('2026-07-15', 0)).toBe('2026-07-19')
  })
})

describe('★変更点①: 下限ガードは日次ではなく週平均で判定する', () => {
  const bmr = K.bmrFromLbm(K.resolveLbm({ weightKg: 83.3, bodyFatPct: 15.7 }))
  const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 3000 })

  it('週平均は外食週でも 2,200 のまま', () => {
    expect(K.weeklyAvgDailyKcal(plan)).toBe(2200)
  })

  it('週平均で判定すれば ok（毎週の誤警告が出ない）', () => {
    expect(K.evaluateCalorieSafety(K.weeklyAvgDailyKcal(plan), bmr).level).toBe('ok')
  })

  it('もし平日目標 2,050 で判定していたら warn になっていた', () => {
    expect(K.evaluateCalorieSafety(plan.normalTargetKcal, bmr).level).toBe('warn')
  })
})

describe('§4-2 進捗 — 1日の超過では警告しない', () => {
  const plan = K.planWeek({ dailyTargetKcal: DAILY, eatOutDates: [SATURDAY], eatOutKcal: 3000 })

  it('月曜に 3,000kcal 食べても（日次超過でも）まだ ok', () => {
    const p = K.weekProgress(plan, [{ logDate: '2026-07-13', kcal: 3000, proteinG: 170 }], '2026-07-13')
    expect(p.status).not.toBe('over')
    expect(p.message).not.toContain('超え')
  })

  it('週予算を超えて初めて over になる', () => {
    const intakes = ['13', '14', '15', '16', '17', '18', '19'].map((d) => ({
      logDate: `2026-07-${d}`,
      kcal: 2300,
      proteinG: 170,
    }))
    const p = K.weekProgress(plan, intakes, '2026-07-19')
    expect(p.consumedKcal).toBe(16100)
    expect(p.status).toBe('over')
    expect(p.remainingKcal).toBe(-700)
  })

  it('残り予算とペースを返す', () => {
    const p = K.weekProgress(plan, [{ logDate: '2026-07-13', kcal: 2000, proteinG: 170 }], '2026-07-14')
    expect(p.remainingKcal).toBe(13400)
    expect(p.remainingDays).toBe(6)
    expect(p.paceKcalPerDay).toBeCloseTo(2233.3, 1)
  })

  it('前週・翌週の記録は今週の集計に混ざらない', () => {
    const p = K.weekProgress(
      plan,
      [
        { logDate: '2026-07-12', kcal: 9999, proteinG: 0 },
        { logDate: '2026-07-20', kcal: 9999, proteinG: 0 },
        { logDate: '2026-07-13', kcal: 2000, proteinG: 170 },
      ],
      '2026-07-14',
    )
    expect(p.consumedKcal).toBe(2000)
  })

  it('週の開始日を月曜で返す', () => {
    expect(K.weekProgress(plan, [], '2026-07-18').weekStartDate).toBe('2026-07-13')
  })

  it('UI 文言は「オーバー」ではなく中立表現', () => {
    const p = K.weekProgress(plan, [{ logDate: '2026-07-13', kcal: 3000, proteinG: 170 }], '2026-07-13')
    expect(p.message).not.toContain('オーバー')
  })
})

describe('§4-2 タンパク質だけは日次ノルマを維持する', () => {
  it('外食日でも P の目標は 170g のまま（週予算に載せない）', () => {
    expect(K.proteinStatusFor(170, 120).met).toBe(false)
    expect(K.proteinStatusFor(170, 120).shortfallG).toBe(50)
  })

  it('達成していれば不足はゼロ', () => {
    const s = K.proteinStatusFor(170, 209)
    expect(s.met).toBe(true)
    expect(s.shortfallG).toBe(0)
  })
})
