import { describe, it, expect } from 'vitest'
import K from '../keiryo-calc.js'

describe('§5 食品シード', () => {
  it('28品が登録されている', () => {
    expect(K.FOODS.length).toBe(28)
  })

  it('鮭は生と焼きの両方がある。焼いてもタンパク質は変わらない', () => {
    const raw = K.FOODS.find((f) => f.id === 'salmon')
    const grilled = K.FOODS.find((f) => f.id === 'salmon-grilled')
    expect(grilled).toBeTruthy()
    expect(grilled.p).toBe(raw.p)          // 焼いても中のタンパク質量は変わらない
    expect(grilled.f).toBeLessThan(raw.f)  // 脂は少し落ちる
    expect(grilled.g).toBeLessThan(raw.g)  // 水が抜けて軽くなる
  })

  it('id の重複がない', () => {
    expect(new Set(K.FOODS.map((f) => f.id)).size).toBe(K.FOODS.length)
  })

  // 野菜・きのこは食物繊維が炭水化物に計上されるため、PFC から逆算すると
  // 実際の倍近い値になる（例: エリンギ 19kcal に対し逆算 38.8kcal）。
  // これは成分表の仕様であって誤植ではないので、この検算からは外す。
  // 目的はカロリーの高い食品での桁ミス・転記ミスの検出。
  it('PFC のカロリー換算が表示 kcal と矛盾しない（野菜・きのこを除く）', () => {
    const checked = K.FOODS.filter((f) => f.cat !== 'veg' && f.cat !== 'mushroom')
    expect(checked.length).toBeGreaterThan(15)
    for (const f of checked) {
      const computed = f.p * 4 + f.f * 9 + f.c * 4
      expect(Math.abs(computed - f.kcal), f.name).toBeLessThan(f.kcal * 0.2 + 12)
    }
  })

  it('未登録の食品IDは例外になる（黙って0kcalにしない）', () => {
    expect(() => K.getFood('nonexistent')).toThrow()
  })

  it('ユーザーが自分で足した食品も引ける', () => {
    const mine = [{ id: 'my-protein-bar', name: '自作バー', unit: '1本', g: 60, kcal: 200, p: 20, f: 7, c: 15, cat: 'other' }]
    expect(K.getFood('my-protein-bar', mine).name).toBe('自作バー')
  })
})

describe('§4-3 定型セット', () => {
  it('初期セットは4つ', () => {
    expect(K.DEFAULT_PRESETS.map((p) => p.id)).toEqual(['meal-1', 'protein', 'meal-2', 'meal-3'])
  })

  it.each([
    ['meal-1', 695],
    ['protein', 120],
    ['meal-2', 687],
    ['meal-3', 639.5],
  ])('%s のカロリー', (id, kcal) => {
    const p = K.DEFAULT_PRESETS.find((x) => x.id === id)
    expect(K.nutritionOfPreset(p).kcal).toBeCloseTo(kcal, 1)
  })

  it('3食目は深夜（0時台）を想定している', () => {
    expect(K.DEFAULT_PRESETS.find((p) => p.id === 'meal-3').hour).toBe(0)
  })

  it('★2食目（仕事終わり）が1日のメイン＝3食目より多い', () => {
    const k = (id) => K.nutritionOfPreset(K.DEFAULT_PRESETS.find((p) => p.id === id)).kcal
    expect(k('meal-2')).toBeGreaterThan(k('meal-3'))
  })

  it('2食目の鮭は「焼き」・豆腐は入れない（本人が食べないため）', () => {
    const ids = K.DEFAULT_PRESETS.find((p) => p.id === 'meal-2').items.map((i) => i.foodId)
    expect(ids).toContain('salmon-grilled')
    expect(ids).not.toContain('salmon')
    expect(ids).not.toContain('tofu-momen')
  })

  it('豆腐の代わりにギリシャヨーグルトを入れ、タンパク質を落としていない', () => {
    const tofu = K.FOODS.find((f) => f.id === 'tofu-momen')
    const yog = K.FOODS.find((f) => f.id === 'greek-yogurt')
    expect(K.DEFAULT_PRESETS.find((p) => p.id === 'meal-2').items.map((i) => i.foodId)).toContain('greek-yogurt')
    expect(Math.abs(yog.p - tofu.p)).toBeLessThan(1)   // P はほぼ同じ
    expect(yog.f).toBeLessThan(tofu.f)                 // 脂質は大幅に少ない
  })

  it('3食目の野菜は「ブロッコリー」と具体名で入っている', () => {
    expect(K.DEFAULT_PRESETS.find((p) => p.id === 'meal-3').items.map((i) => i.foodId)).toContain('broccoli')
  })
})

describe('★指摘③: 定型セット4つの合計と目標のズレ', () => {
  const total = K.nutritionOfAllPresets()
  const plan = K.buildPlan({ body: { weightKg: 83.3, bodyFatPct: 15.7 } })

  it('合計 2,142 kcal — 目標 2,200 より少し少ない', () => {
    expect(total.kcal).toBeCloseTo(2141.5, 0)
    expect(plan.kcal - total.kcal).toBeLessThan(100)
  })

  it('脂質 53g — 目標 60g を下回る（豆腐を抜いたぶん軽くなった）', () => {
    expect(total.fatG).toBeCloseTo(53.4, 1)
    expect(total.fatG).toBeLessThan(plan.fatG)
  })

  it('タンパク質 208g — 目標 170g を約38g 上回る', () => {
    expect(total.proteinG).toBeCloseTo(208.45, 1)
    expect(total.proteinG - plan.proteinG).toBeGreaterThan(35)
  })

  it('炭水化物 216g — 目標 245g を約29g 下回る', () => {
    expect(total.carbG).toBeCloseTo(215.85, 1)
    expect(plan.carbG - total.carbG).toBeGreaterThan(20)
  })
})

describe('記録済みの食事の合計', () => {
  it('数値でも文字列でも足せる（フォーム入力を素通しできる）', () => {
    const s = K.sumNutrition([
      { kcal: 695, proteinG: 52.05, fatG: 22.25, carbG: 68.55 },
      { kcal: '120', proteinG: '21', fatG: '1.5', carbG: '3' },
    ])
    expect(s.kcal).toBe(815)
    expect(s.proteinG).toBeCloseTo(73.05, 2)
  })

  it('空なら全部ゼロ', () => {
    expect(K.sumNutrition([])).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 })
  })
})

describe('数量を「実際の量」に言い換える（「1」だけでは何の1か分からない）', () => {
  const f = (id) => K.FOODS.find((x) => x.id === id)

  it('キムチ（50g単位）×1 → 50g', () => {
    expect(K.itemAmountLabel(f('kimchi'), 1)).toBe('50g')
  })

  it('キムチ ×2 → 100g', () => {
    expect(K.itemAmountLabel(f('kimchi'), 2)).toBe('100g')
  })

  it('白米（100g単位）×1.5 → 150g', () => {
    expect(K.itemAmountLabel(f('rice'), 1.5)).toBe('150g')
  })

  it('卵（1個）×3 → 3個（150g）', () => {
    expect(K.itemAmountLabel(f('egg-m'), 3)).toBe('3個（150g）')
  })

  it('納豆（1パック45g）×1 → 1パック（45g）', () => {
    expect(K.itemAmountLabel(f('natto'), 1)).toBe('1パック（45g）')
  })

  it('鮭（1切れ80g）×2 → 2切れ（160g）', () => {
    expect(K.itemAmountLabel(f('salmon'), 2)).toBe('2切れ（160g）')
  })

  it('プロテイン（1杯30g）×1 → 1杯（30g）', () => {
    expect(K.itemAmountLabel(f('whey'), 1)).toBe('1杯（30g）')
  })

  it('味噌汁（1杯・g表記なし）×1 → 1杯（200g）', () => {
    expect(K.itemAmountLabel(f('misoshiru'), 1)).toBe('1杯（200g）')
  })

  it('サバ缶（1缶190g）×1 → 1缶（190g）', () => {
    expect(K.itemAmountLabel(f('saba-can'), 1)).toBe('1缶（190g）')
  })

  it('豆腐（半丁150g・数字で始まらない単位）はグラムで出す', () => {
    expect(K.itemAmountLabel(f('tofu-momen'), 1)).toBe('150g')
  })

  it('0.5 のような端数でも壊れない', () => {
    expect(K.itemAmountLabel(f('rice'), 0.5)).toBe('50g')
    expect(K.itemAmountLabel(f('egg-m'), 0.5)).toBe('0.5個（25g）')
  })

  it('全食品で例外を投げない', () => {
    for (const food of K.FOODS) {
      expect(() => K.itemAmountLabel(food, 1), food.name).not.toThrow()
      expect(K.itemAmountLabel(food, 1), food.name).toBeTruthy()
    }
  })

  it('単位の説明が出せる', () => {
    expect(K.itemUnitHint(f('kimchi'))).toBe('1 ＝ 50g')
    expect(K.itemUnitHint(f('egg-m'))).toBe('1 ＝ 1個')
  })
})
