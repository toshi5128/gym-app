import { describe, it, expect } from 'vitest'
import K from '../keiryo-calc.js'

describe('水分の目安（体重ベース＋運動ぶんの上乗せ）', () => {
  it('係数は体重1kgあたり35ml・運動1時間あたり+500ml', () => {
    expect(K.WATER_ML_PER_KG).toBe(35)
    expect(K.WATER_ML_PER_TRAINING_HOUR).toBe(500)
  })

  it('83.3kg・運動なし → 2,900ml', () => {
    // 83.3 × 35 = 2915.5 → 50ml単位で 2900
    expect(K.waterTargetMl(83.3)).toBe(2900)
  })

  it('83.3kg・筋トレ120分 → 3,900ml（+1,000ml）', () => {
    expect(K.waterTargetMl(83.3, { trainingMinutes: 120 })).toBe(3900)
  })

  it('トレ60分なら +500ml', () => {
    expect(K.waterTargetMl(83.3, { trainingMinutes: 60 }) - K.waterTargetMl(83.3)).toBe(500)
  })

  it('トレ時間が未記録（null/undefined）でも壊れない', () => {
    expect(K.waterTargetMl(83.3, { trainingMinutes: null })).toBe(2900)
    expect(K.waterTargetMl(83.3, {})).toBe(2900)
  })

  it('必ず50ml単位に丸まる', () => {
    for (const w of [60, 72.4, 83.3, 95.7, 110]) {
      expect(K.waterTargetMl(w) % 50).toBe(0)
    }
  })

  it('体重が増えれば目安も増える', () => {
    expect(K.waterTargetMl(90)).toBeGreaterThan(K.waterTargetMl(70))
  })
})

describe('飲み物の合計', () => {
  const drinks = [
    { ml: 500, caffeineMg: 0, kcal: 0 },
    { ml: 150, caffeineMg: 90, kcal: 4 },
    { ml: 200, caffeineMg: 60, kcal: 90 },
  ]

  it('ml・カフェイン・kcal をそれぞれ合計する', () => {
    expect(K.sumDrinks(drinks)).toEqual({ ml: 850, caffeineMg: 150, kcal: 94 })
  })

  it('空なら全部ゼロ', () => {
    expect(K.sumDrinks([])).toEqual({ ml: 0, caffeineMg: 0, kcal: 0 })
  })

  it('欠けている項目があっても落ちない', () => {
    expect(K.sumDrinks([{ ml: 500 }, { caffeineMg: 90 }])).toEqual({ ml: 500, caffeineMg: 90, kcal: 0 })
  })
})

describe('水分の進み具合 — 足りない時だけ知らせる', () => {
  it('1,750 / 3,900 → あと2,150ml', () => {
    const s = K.hydrationStatus(1750, 3900)
    expect(s.remainingMl).toBe(2150)
    expect(s.level).toBe('low')
    expect(s.message).toContain('2,150ml')
  })

  it('60%を超えたら ok', () => {
    expect(K.hydrationStatus(2400, 3900).level).toBe('ok')
  })

  it('届いたら done。残りはマイナスにしない', () => {
    const s = K.hydrationStatus(4200, 3900)
    expect(s.level).toBe('done')
    expect(s.remainingMl).toBe(0)
  })

  it('飲みすぎの警告は出さない（過剰摂取の判定はしない方針）', () => {
    expect(['done', 'ok', 'low']).toContain(K.hydrationStatus(9000, 3900).level)
  })

  it('目標が0でも壊れない', () => {
    expect(K.hydrationStatus(0, 0).pct).toBe(0)
  })
})

describe('カフェイン', () => {
  it('1日の目安は400mg', () => {
    expect(K.CAFFEINE_DAILY_MAX_MG).toBe(400)
  })

  it('コーヒー3杯（270mg）はまだ ok', () => {
    expect(K.caffeineStatus(270).level).toBe('ok')
  })

  it('340mg（85%）で「近づいている」', () => {
    expect(K.caffeineStatus(340).level).toBe('near')
  })

  it('450mg で超過', () => {
    const s = K.caffeineStatus(450)
    expect(s.level).toBe('over')
    expect(s.message).toContain('400mg')
  })

  it('ゼロなら何も言わない', () => {
    expect(K.caffeineStatus(0).level).toBe('ok')
    expect(K.caffeineStatus(0).message).toBe('')
  })
})

describe('カフェインと就寝時刻（就寝2:00の生活）', () => {
  it('就寝までの時間を日またぎでも正しく出す', () => {
    expect(K.hoursUntilBed(22, 2)).toBe(4)   // 22時 → 翌2時
    expect(K.hoursUntilBed(14, 2)).toBe(12)  // 14時 → 翌2時
    expect(K.hoursUntilBed(2, 2)).toBe(0)
    expect(K.hoursUntilBed(1, 2)).toBe(1)    // 深夜1時 → 2時
  })

  it('22時のコーヒーは就寝4時間前 → 注意が出る', () => {
    const s = K.caffeineStatus(90, { lastAtHour: 22, bedHour: 2 })
    expect(s.level).toBe('late')
    expect(s.message).toContain('4時間')
  })

  it('14時のコーヒーなら就寝12時間前 → 注意なし', () => {
    expect(K.caffeineStatus(90, { lastAtHour: 14, bedHour: 2 }).level).toBe('ok')
  })

  it('境界: 就寝6時間前（20時）はまだ ok、5時間前（21時）は注意', () => {
    expect(K.caffeineStatus(90, { lastAtHour: 20, bedHour: 2 }).level).toBe('ok')
    expect(K.caffeineStatus(90, { lastAtHour: 21, bedHour: 2 }).level).toBe('late')
  })

  it('総量超過のほうが、就寝前の注意より優先される', () => {
    expect(K.caffeineStatus(500, { lastAtHour: 22, bedHour: 2 }).level).toBe('over')
  })

  it('カフェインが0なら遅い時間でも注意しない', () => {
    expect(K.caffeineStatus(0, { lastAtHour: 23, bedHour: 2 }).level).toBe('ok')
  })
})

describe('初期の飲み物', () => {
  it('7種類そろっている', () => {
    expect(K.DEFAULT_DRINKS.length).toBe(7)
  })

  it('id の重複がない', () => {
    expect(new Set(K.DEFAULT_DRINKS.map((d) => d.id)).size).toBe(K.DEFAULT_DRINKS.length)
  })

  it('全部に ml とカフェイン量が入っている', () => {
    for (const d of K.DEFAULT_DRINKS) {
      expect(d.ml, d.name).toBeGreaterThan(0)
      expect(typeof d.caffeineMg, d.name).toBe('number')
      expect(typeof d.kcal, d.name).toBe('number')
    }
  })

  it('プロテインの水は kcal 0（粉のぶんは食事側で記録済み＝二重計上を避ける）', () => {
    expect(K.DEFAULT_DRINKS.find((d) => d.id === 'proteinw').kcal).toBe(0)
  })

  it('コーヒー1杯は90mg。4杯で360mgとなり、5杯目で目安を超える', () => {
    const c = K.DEFAULT_DRINKS.find((d) => d.id === 'coffee')
    expect(c.caffeineMg).toBe(90)
    expect(K.caffeineStatus(c.caffeineMg * 4).level).toBe('near')
    expect(K.caffeineStatus(c.caffeineMg * 5).level).toBe('over')
  })
})
