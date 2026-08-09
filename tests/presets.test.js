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

  // 「1日のメニュー表（2026-08-07）」の小計 ±食材の移動分（2026-08-09）。
  // メニュー表: 1食目683 / 間食120 / 2食目566 / 3食目786
  // ・卵M 1個 = 76kcal を 1食目から2食目・3食目へ1個ずつ移した
  // ・納豆 1パック = 90kcal を 3食目から1食目へ移した
  it.each([
    ['meal-1', 683 - 76 * 2 + 90],
    ['protein', 120],
    ['meal-2', 566.05 + 76],
    ['meal-3', 785.5 + 76 - 90],
  ])('%s のカロリーがメニュー表の小計と合う', (id, kcal) => {
    const p = K.DEFAULT_PRESETS.find((x) => x.id === id)
    expect(K.nutritionOfPreset(p).kcal).toBeCloseTo(kcal, 1)
  })

  it('各食のタンパク質がメニュー表と合う（P は日次で守る数字なのでズレを許さない）', () => {
    const p = (id) => K.nutritionOfPreset(K.DEFAULT_PRESETS.find((x) => x.id === id)).proteinG
    expect(p('meal-1')).toBeCloseTo(45.9 - 6.2 * 2 + 7.4, 1)  // 表: 45 − 卵2個 ＋ 納豆
    expect(p('protein')).toBeCloseTo(21, 1)                   // 表: 21
    expect(p('meal-2')).toBeCloseTo(46.0 + 6.2, 1)            // 表: 46 ＋ 卵1個
    expect(p('meal-3')).toBeCloseTo(62.45 + 6.2 - 7.4, 1)     // 表: 62 ＋ 卵1個 − 納豆
  })

  it('時刻はメニュー表どおり（1食目9時台・間食15時・2食目19時・3食目は深夜0時台）', () => {
    const h = (id) => K.DEFAULT_PRESETS.find((p) => p.id === id).hour
    expect(h('meal-1')).toBe(9)
    expect(h('protein')).toBe(15)
    expect(h('meal-2')).toBe(19)
    expect(h('meal-3')).toBe(0)
  })

  it('★1日のメインは3食目（トレ後）＝2食目より多い', () => {
    const k = (id) => K.nutritionOfPreset(K.DEFAULT_PRESETS.find((p) => p.id === id)).kcal
    expect(k('meal-3')).toBeGreaterThan(k('meal-2'))
  })

  it('1食目は卵かけご飯（卵1個＋ご飯200g）＋納豆＋キムチ＋プロテイン', () => {
    const items = K.DEFAULT_PRESETS.find((p) => p.id === 'meal-1').items
    const q = (id) => (items.find((i) => i.foodId === id) || {}).qty
    expect(q('egg-m')).toBe(1)
    expect(q('natto')).toBe(1)     // 3食目（深夜）から1食目へ戻した
    expect(q('rice')).toBe(2)      // 白米100g単位 ×2 ＝ 200g
    expect(q('kimchi')).toBe(1)    // 50g
    expect(q('whey')).toBe(1)
    expect(items.length).toBe(5)
  })

  it('2食目は 鶏もも185g・卵1個・白米200g・ブロッコリー150g', () => {
    const items = K.DEFAULT_PRESETS.find((p) => p.id === 'meal-2').items
    const q = (id) => (items.find((i) => i.foodId === id) || {}).qty
    expect(q('chicken-thigh-skinless')).toBe(1.85)
    expect(q('egg-m')).toBe(1)
    expect(q('rice')).toBe(2)
    expect(q('broccoli')).toBe(1.5)
    expect(items.length).toBe(4)
  })

  it('3食目は 鶏もも250g・卵1個・白米250g・キムチ50g（納豆は1食目へ移した）', () => {
    const items = K.DEFAULT_PRESETS.find((p) => p.id === 'meal-3').items
    const q = (id) => (items.find((i) => i.foodId === id) || {}).qty
    expect(q('chicken-thigh-skinless')).toBe(2.5)
    expect(q('egg-m')).toBe(1)
    expect(q('natto')).toBeUndefined()
    expect(q('rice')).toBe(2.5)
    expect(q('kimchi')).toBe(1)
    expect(items.length).toBe(4)
  })

  // 卵は「1食にまとめ食い」ではなく毎食1個ずつ（2026-08-09 本人の希望）。
  it('★卵は1食目・2食目・3食目に1個ずつ散らす', () => {
    const eggQty = (id) => {
      const p = K.DEFAULT_PRESETS.find((x) => x.id === id)
      return p.items.filter((i) => i.foodId === 'egg-m').reduce((a, i) => a + i.qty, 0)
    }
    expect(eggQty('meal-1')).toBe(1)
    expect(eggQty('meal-2')).toBe(1)
    expect(eggQty('meal-3')).toBe(1)
  })

  // 味噌汁・豆腐なし版。鮭とヨーグルトもこの版では使わない（食品としては残っている）。
  it('定型セットに 味噌汁・豆腐・鮭・ヨーグルト は入っていない', () => {
    const all = K.DEFAULT_PRESETS.flatMap((p) => p.items.map((i) => i.foodId))
    for (const id of ['misoshiru', 'tofu-momen', 'salmon', 'salmon-grilled', 'greek-yogurt']) {
      expect(all, id).not.toContain(id)
    }
  })

  it('外した食品は「食品」としては残してある（単品で記録できる）', () => {
    for (const id of ['misoshiru', 'tofu-momen', 'salmon-grilled', 'greek-yogurt']) {
      expect(K.FOODS.some((f) => f.id === id), id).toBe(true)
    }
  })

  it('1日の食材量がメニュー表と合う（鶏435g・白米650g・卵3個・プロテイン2杯）', () => {
    const qty = (foodId) =>
      K.DEFAULT_PRESETS.reduce(
        (s, p) => s + p.items.filter((i) => i.foodId === foodId).reduce((a, i) => a + i.qty, 0), 0)
    expect(qty('chicken-thigh-skinless') * 100).toBeCloseTo(435, 0)  // 185 + 250
    expect(qty('rice') * 100).toBeCloseTo(650, 0)                    // 200 + 200 + 250
    expect(qty('egg-m')).toBe(3)
    expect(qty('whey')).toBe(2)
    expect(qty('natto')).toBe(1)
    expect(qty('kimchi') * 50).toBeCloseTo(100, 0)                   // 50 + 50
    expect(qty('broccoli') * 100).toBeCloseTo(150, 0)
  })
})

describe('定型セット4つの合計と目標のズレ（メニュー表 2026-08-07）', () => {
  const total = K.nutritionOfAllPresets()
  const plan = K.buildPlan({ body: { weightKg: 83.3, bodyFatPct: 15.7 } })

  it('合計 2,155 kcal — メニュー表の DAILY TOTAL と一致', () => {
    expect(total.kcal).toBeCloseTo(2154.55, 0)
  })

  it('タンパク質 175g — 日次ノルマ 170g を満たす', () => {
    expect(total.proteinG).toBeCloseTo(175.35, 1)
    expect(total.proteinG).toBeGreaterThan(170)
  })

  it('炭水化物 267g — メニュー表の各食の C の合計と一致', () => {
    expect(total.carbG).toBeCloseTo(267.4, 1)
  })

  /* ★脂質は 48g で、ホルモン維持の下限 58g（体重×0.7）を約10g 下回る。
     味噌汁・豆腐・鮭・ヨーグルトを外したぶん脂質源が卵と鶏だけになったため。
     メニュー表自身も「ブロッコリーをオリーブオイル小さじ1で和える（+4.5g）」を勧めている。
     ここは「気づかないまま下限割れが続く」のを防ぐための見張りなので、
     脂質源を足したら期待値ごと更新すること。 */
  it('脂質 48g — 下限 58g を下回っている（脂質源を足すまでの既知の状態）', () => {
    expect(total.fatG).toBeCloseTo(47.8, 1)
    expect(total.fatG).toBeLessThan(plan.fatG)
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
