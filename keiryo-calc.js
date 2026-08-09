/**
 * ATLAS「食事」タブの計算コア。
 *
 * 仕様書 = KEIRYO-SPEC-v2.md（下田さんの Downloads）。
 * 係数・閾値をここ以外に書かないこと。画面側は必ずこの部品を経由する。
 *
 * ★この1ファイルを index.html（ブラウザ）と tests/（vitest）の両方が読む。
 *  コピーを作らないこと。数式を直すのはここだけ。
 *  直したら必ず `npm test` を通してからデプロイする。
 *
 * 設計思想: 日単位の完璧主義を捨て、週単位で帳尻を合わせる。
 * 外食は「失敗」ではなく「計画」として先に週予算へ織り込む。
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.KEIRYO = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  // =========================================================================
  // 係数（仕様書 §1）
  // =========================================================================

  /** 骨格筋量 → 除脂肪体重の換算係数。実測 70.2 / 40.1 = 1.75（1.85 は過大） */
  var SMM_TO_LBM = 1.75
  /** タンパク質: 除脂肪体重 1kg あたり (g) */
  var PROTEIN_PER_LBM = 2.4
  /** 脂質: 体重 1kg あたり (g)。0.9 だと C の枠を圧迫する */
  var FAT_PER_BODYWEIGHT = 0.72
  /** 脂質の下限係数: 体重 1kg あたり (g) */
  var FAT_FLOOR_PER_BODYWEIGHT = 0.7
  /** 炭水化物の下限 (g) */
  var CARB_FLOOR_G = 100
  /** 標準の1日あたり赤字 (kcal) */
  var DEFAULT_DEFICIT = 550
  var DEFAULT_ACTIVITY = 1.45
  var KCAL_P = 4, KCAL_F = 9, KCAL_C = 4

  var ACTIVITY_LEVELS = [
    { value: 1.2,   label: 'ほぼ運動なし（デスクワークのみ）' },
    { value: 1.375, label: '軽い運動 週1〜3回' },
    { value: 1.45,  label: '筋トレ 週4〜5回 ＋ デスクワーク' },
    { value: 1.55,  label: '中程度の運動 週3〜5回' },
    { value: 1.725, label: '激しい運動 ほぼ毎日 ＋ 競技' }
  ]

  // =========================================================================
  // 丸め
  // =========================================================================

  /** カロリーは 50kcal 単位（2184.7 → 2200） */
  function roundKcal(kcal, step) { step = step || 50; return Math.round(kcal / step) * step }
  /** マクロは 5g 単位（168.5 → 170） */
  function roundMacro(g, step) { step = step || 5; return Math.round(g / step) * step }

  // =========================================================================
  // 除脂肪体重 / BMR / TDEE
  // =========================================================================

  function lbmFromBodyFat(weightKg, bodyFatPct) { return weightKg * (1 - bodyFatPct / 100) }
  function lbmFromSkeletalMuscle(smmKg) { return smmKg * SMM_TO_LBM }

  /**
   * 体脂肪率を最優先、無ければ骨格筋量から。どちらも無ければ例外。
   * 0.1kg 単位に丸める（体組成計の表示精度に合わせる。丸めないと BMR が1kcalずれる）。
   */
  function resolveLbm(body) {
    var raw = null
    if (body.bodyFatPct != null) raw = lbmFromBodyFat(body.weightKg, body.bodyFatPct)
    else if (body.skeletalMuscleKg != null) raw = lbmFromSkeletalMuscle(body.skeletalMuscleKg)
    if (raw == null) throw new Error('体脂肪率か骨格筋量のどちらかが必要です')
    return Math.round(raw * 10) / 10
  }

  /** Katch-McArdle */
  function bmrFromLbm(lbmKg) { return 370 + 21.6 * lbmKg }
  function tdeeFromBmr(bmr, activity) { return bmr * activity }

  // =========================================================================
  // 目標カロリーと PFC
  // =========================================================================

  /**
   * P は LBM 基準、F は体重基準で先に確定し、残りをすべて C に回す（仕様書 §7）。
   */
  function macrosForCalories(targetKcal, lbmKg, weightKg) {
    var proteinG = roundMacro(lbmKg * PROTEIN_PER_LBM)
    var fatFloor = weightKg * FAT_FLOOR_PER_BODYWEIGHT
    var fatG = roundMacro(Math.max(weightKg * FAT_PER_BODYWEIGHT, fatFloor))
    var pKcal = proteinG * KCAL_P
    var fKcal = fatG * KCAL_F
    var carbG = Math.max(CARB_FLOOR_G, Math.round((targetKcal - pKcal - fKcal) / KCAL_C))
    return {
      kcal: targetKcal, proteinG: proteinG, fatG: fatG, carbG: carbG,
      ratio: {
        protein: (pKcal / targetKcal) * 100,
        fat: (fKcal / targetKcal) * 100,
        carb: ((carbG * KCAL_C) / targetKcal) * 100
      }
    }
  }

  /** プロフィールから目標一式を組み立てる。画面はこの戻り値を正とする。 */
  function buildPlan(input) {
    var activity = input.activity == null ? DEFAULT_ACTIVITY : input.activity
    var deficit = input.deficit == null ? DEFAULT_DEFICIT : input.deficit
    var lbmKg = resolveLbm(input.body)
    var bmr = bmrFromLbm(lbmKg)
    var tdee = tdeeFromBmr(bmr, activity)
    var targetKcal = input.overrideKcal != null ? input.overrideKcal : roundKcal(tdee - deficit)
    var m = macrosForCalories(targetKcal, lbmKg, input.body.weightKg)
    return {
      lbmKg: lbmKg, bmr: bmr, tdee: tdee,
      kcal: m.kcal, proteinG: m.proteinG, fatG: m.fatG, carbG: m.carbG, ratio: m.ratio
    }
  }

  // =========================================================================
  // ゴール（仕様書 §2）
  // =========================================================================

  /**
   * 目標体重は入力させない。目標体脂肪率から逆算する。
   * LBM を下回る体重は物理的に不可能なのでここで弾く。
   */
  function goalFromTargetBodyFat(lbmKg, currentWeightKg, targetBodyFatPct) {
    if (targetBodyFatPct <= 0 || targetBodyFatPct >= 100) {
      throw new Error('目標体脂肪率は 0〜100% の範囲で入力してください')
    }
    var goalWeightKg = lbmKg / (1 - targetBodyFatPct / 100)
    if (goalWeightKg < lbmKg) throw new Error('除脂肪体重を下回る目標体重は設定できません')
    return { goalWeightKg: goalWeightKg, fatToLoseKg: currentWeightKg - goalWeightKg }
  }

  /**
   * 着地予定日。固定文字で焼き付けず、実データの週間ペースから毎回引き直す。
   * 減っていない（ペースが0以上）なら予測不能として null。
   */
  function projectLandingDate(currentWeightKg, goalWeightKg, weeklyChangeKg, from) {
    var toLose = currentWeightKg - goalWeightKg
    if (toLose <= 0) return { weeksRemaining: 0, date: new Date(from.getTime()) }
    if (weeklyChangeKg >= 0) return null
    var weeks = toLose / Math.abs(weeklyChangeKg)
    var d = new Date(from.getTime())
    d.setDate(d.getDate() + Math.round(weeks * 7))
    return { weeksRemaining: weeks, date: d }
  }

  // =========================================================================
  // 下限ガード（仕様書 §7 ＋ 変更点①）
  // =========================================================================

  /**
   * カロリー設定の安全判定。
   *
   * 【仕様書からの変更点①】判定対象は「その日の目標」ではなく「週平均の1日あたり目標」。
   * 週予算方式では外食週の平日目標が 2,050kcal まで下がるが、これは警告閾値 2,075kcal を
   * 割り込むため、日次で判定すると外食を予定するたびに毎週警告が出て警告が意味を失う。
   * 週平均で見れば 2,200kcal のままなので実態に合う。
   */
  function evaluateCalorieSafety(weeklyAvgDailyKcal, bmr) {
    var warnThreshold = bmr * 1.1
    var stopThreshold = bmr
    var base = {
      evaluatedKcal: weeklyAvgDailyKcal,
      warnThreshold: warnThreshold,
      stopThreshold: stopThreshold
    }
    if (weeklyAvgDailyKcal < stopThreshold) {
      base.level = 'blocked'
      base.message = '基礎代謝 ' + Math.round(bmr) + 'kcal を下回る設定はできません'
    } else if (weeklyAvgDailyKcal < warnThreshold) {
      base.level = 'warn'
      base.message = '週平均が ' + Math.round(warnThreshold) + 'kcal を下回っています。筋肉が落ちるリスクがあります'
    } else {
      base.level = 'ok'
    }
    return base
  }

  // =========================================================================
  // 週次レビュー（仕様書 §7）
  // =========================================================================

  /**
   * 判断は生の体重では絶対に行わない。呼び出し側は必ず7日移動平均を渡すこと。
   */
  function reviewWeek(input) {
    // 浮動小数点の誤差対策。82.3 - 83.0 は -0.7000000000000028 になり、
    // 丸めないと「ちょうど -0.7kg（順調）」が「落としすぎ」に誤判定される。
    var deltaKg = Math.round((input.thisWeekAvgKg - input.lastWeekAvgKg) * 1000) / 1000

    // 実測ベースの安全弁: 骨格筋が2週で -0.5kg 以上減ったら最優先で増やす
    if (input.smmChange2WeeksKg != null && input.smmChange2WeeksKg <= -0.5) {
      return { deltaKg: deltaKg, verdict: 'too_fast', kcalAdjustment: 200, suggestCardio: false,
        message: '骨格筋量が2週で0.5kg以上減っています。+200kcal を強く推奨します' }
    }
    if (deltaKg < -0.7) {
      return { deltaKg: deltaKg, verdict: 'too_fast', kcalAdjustment: 150, suggestCardio: false,
        message: '落としすぎです。筋肉が減るリスクがあります。+150kcal を提案します' }
    }
    if (deltaKg <= -0.3) {
      return { deltaKg: deltaKg, verdict: 'on_track', kcalAdjustment: 0, suggestCardio: false,
        message: '順調です。変更なし' }
    }
    if (deltaKg <= -0.1) {
      return { deltaKg: deltaKg, verdict: 'slowing', kcalAdjustment: 0, suggestCardio: false,
        message: 'やや停滞。1週間は変更せず経過観察します' }
    }
    // 停滞。2週連続で初めて手を打つ。カロリー削減と有酸素は必ずどちらか一方
    if (!input.stalledLastWeek) {
      return { deltaKg: deltaKg, verdict: 'stalled', kcalAdjustment: 0, suggestCardio: false,
        message: '停滞しています。もう1週間ようすを見ます' }
    }
    return { deltaKg: deltaKg, verdict: 'stalled', kcalAdjustment: -100, suggestCardio: false,
      message: '2週連続で停滞。-100kcal か 有酸素の追加、どちらか一方を選んでください' }
  }

  /** カロリー調整は必ず C だけで行う。P と F はいかなる調整でも減らさない（§7）。 */
  function applyAdjustment(plan, kcalAdjustment) {
    var nextKcal = plan.kcal + kcalAdjustment
    var carbG = Math.max(CARB_FLOOR_G, plan.carbG + Math.round(kcalAdjustment / KCAL_C))
    var pKcal = plan.proteinG * KCAL_P
    var fKcal = plan.fatG * KCAL_F
    return {
      kcal: nextKcal, proteinG: plan.proteinG, fatG: plan.fatG, carbG: carbG,
      ratio: {
        protein: (pKcal / nextKcal) * 100,
        fat: (fKcal / nextKcal) * 100,
        carb: ((carbG * KCAL_C) / nextKcal) * 100
      }
    }
  }

  /**
   * 直近 windowDays 日の平均。参考値フラグの立った測定は除外する（§6）。
   * weighIns: [{ logDate:'YYYY-MM-DD', weightKg, isReference? }]
   */
  function movingAverage(weighIns, endLogDate, windowDays) {
    windowDays = windowDays || 7
    var end = new Date(endLogDate + 'T00:00:00')
    var start = new Date(end.getTime())
    start.setDate(start.getDate() - (windowDays - 1))
    var inWindow = weighIns.filter(function (w) {
      if (w.isReference) return false
      var d = new Date(w.logDate + 'T00:00:00')
      return d >= start && d <= end
    })
    if (inWindow.length === 0) return null
    var sum = inWindow.reduce(function (s, w) { return s + w.weightKg }, 0)
    return sum / inWindow.length
  }

  // =========================================================================
  // 日付境界 04:00（仕様書 §4-1）
  //
  // トレが24時に終わり、そこから3食目を食べる生活のため、0:30 の食事が翌日に
  // 計上されると前日・当日の両方の集計が壊れる。
  // 集計は必ず logDate で行い、実時刻は表示専用にとどめる。
  // =========================================================================

  var DEFAULT_BOUNDARY_HOUR = 4
  var WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

  function pad2(n) { return (n < 10 ? '0' : '') + n }

  /** Date → 'YYYY-MM-DD'（ローカル基準。toISOString は UTC ずれを起こすので使わない） */
  function formatLogDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }

  /** 実時刻から、その記録が属する「1日」を決める。 */
  function toLogDate(eatenAt, boundaryHour) {
    if (boundaryHour == null) boundaryHour = DEFAULT_BOUNDARY_HOUR
    var d = new Date(eatenAt.getTime())
    if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1)
    return formatLogDate(d)
  }

  /** 記録画面の明示ラベル: 「7/18(土)の記録として保存されます」 */
  function logDateLabel(eatenAt, boundaryHour) {
    var logDate = toLogDate(eatenAt, boundaryHour)
    var d = new Date(logDate + 'T00:00:00')
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAY_JA[d.getDay()] + ')の記録として保存されます'
  }

  /** その log_date が実時刻でどこからどこまでか */
  function logDateRange(logDate, boundaryHour) {
    if (boundaryHour == null) boundaryHour = DEFAULT_BOUNDARY_HOUR
    var start = new Date(logDate + 'T00:00:00')
    start.setHours(boundaryHour, 0, 0, 0)
    var end = new Date(start.getTime())
    end.setDate(end.getDate() + 1)
    return { start: start, end: end }
  }

  /** その実時刻が「深夜ぶん（前日扱い）」か。UI の注意書き判定に使う */
  function isLateNight(eatenAt, boundaryHour) {
    if (boundaryHour == null) boundaryHour = DEFAULT_BOUNDARY_HOUR
    return eatenAt.getHours() < boundaryHour
  }

  function addLogDays(logDate, days) {
    var d = new Date(logDate + 'T00:00:00')
    d.setDate(d.getDate() + days)
    return formatLogDate(d)
  }

  /** その logDate が属する週の開始日（月曜始まり） */
  function weekStart(logDate) {
    var d = new Date(logDate + 'T00:00:00')
    var dow = d.getDay() // 0=日
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
    return formatLogDate(d)
  }

  /** 週の7日ぶん（月曜〜日曜） */
  function weekDates(logDate) {
    var start = weekStart(logDate)
    var out = []
    for (var i = 0; i < 7; i++) out.push(addLogDays(start, i))
    return out
  }

  // =========================================================================
  // 週予算方式（仕様書 §4-2）
  // =========================================================================

  var DEFAULT_EAT_OUT_KCAL = 3000
  /** 平日目標の丸め単位。切り捨てなので週合計は必ず予算内に収まる */
  var NORMAL_TARGET_STEP = 50

  /**
   * 週予算を外食日と平日に配分する。
   * 例: 15,400 - 3,000 = 12,400 を 6日で割ると 2,066.7。
   *     50kcal 単位で「切り捨て」て 2,050（切り上げると予算を超える）。
   */
  function planWeek(input) {
    var dailyTargetKcal = input.dailyTargetKcal
    var eatOutDates = input.eatOutDates || []
    var eatOutKcal = input.eatOutKcal == null ? DEFAULT_EAT_OUT_KCAL : input.eatOutKcal
    var warnings = []
    var weeklyBudgetKcal = dailyTargetKcal * 7
    var normalDays = 7 - eatOutDates.length

    if (normalDays <= 0) {
      warnings.push('週の全日が外食日です。再配分できません')
      var allocated0 = eatOutKcal * eatOutDates.length
      return {
        weeklyBudgetKcal: weeklyBudgetKcal, eatOutDates: eatOutDates, eatOutKcal: eatOutKcal,
        normalDays: 0, normalTargetKcal: 0, allocatedKcal: allocated0,
        slackKcal: weeklyBudgetKcal - allocated0, warnings: warnings
      }
    }

    var remaining = weeklyBudgetKcal - eatOutKcal * eatOutDates.length
    var raw = remaining / normalDays
    var normalTargetKcal = Math.max(0, Math.floor(raw / NORMAL_TARGET_STEP) * NORMAL_TARGET_STEP)
    if (raw <= 0) warnings.push('外食日の想定カロリーが週予算を食い尽くしています。想定値を見直してください')

    var allocatedKcal = normalTargetKcal * normalDays + eatOutKcal * eatOutDates.length
    return {
      weeklyBudgetKcal: weeklyBudgetKcal, eatOutDates: eatOutDates, eatOutKcal: eatOutKcal,
      normalDays: normalDays, normalTargetKcal: normalTargetKcal,
      allocatedKcal: allocatedKcal, slackKcal: weeklyBudgetKcal - allocatedKcal, warnings: warnings
    }
  }

  /** その日の目標。外食日なら想定値、そうでなければ再配分後の平日目標 */
  function dailyTargetFor(plan, logDate) {
    return plan.eatOutDates.indexOf(logDate) >= 0 ? plan.eatOutKcal : plan.normalTargetKcal
  }

  /**
   * 週の進捗。1日の超過は評価しない — 見るのは週予算だけ。
   * intakes: [{ logDate, kcal, proteinG }]
   */
  function weekProgress(plan, intakes, todayLogDate) {
    var dates = weekDates(todayLogDate)
    var consumedKcal = intakes.reduce(function (sum, i) {
      return dates.indexOf(i.logDate) >= 0 ? sum + i.kcal : sum
    }, 0)
    var remainingKcal = plan.weeklyBudgetKcal - consumedKcal
    var todayIndex = dates.indexOf(todayLogDate)
    var remainingDays = Math.max(0, 7 - todayIndex)
    var paceKcalPerDay = remainingDays > 0 ? remainingKcal / remainingDays : null

    var status = 'ok'
    var message = '今週はあと ' + Math.round(remainingKcal).toLocaleString() + 'kcal 使えます'
    if (remainingKcal < 0) {
      status = 'over'
      message = '今週の予算を ' + Math.abs(Math.round(remainingKcal)).toLocaleString() + 'kcal 超えています'
    } else if (paceKcalPerDay != null && paceKcalPerDay < plan.normalTargetKcal * 0.9) {
      status = 'tight'
      message = '残り' + remainingDays + '日は1日 ' + Math.round(paceKcalPerDay).toLocaleString() + 'kcal ペースです'
    }

    return {
      weekStartDate: weekStart(todayLogDate), weeklyBudgetKcal: plan.weeklyBudgetKcal,
      consumedKcal: consumedKcal, remainingKcal: remainingKcal, remainingDays: remainingDays,
      paceKcalPerDay: paceKcalPerDay, status: status, message: message
    }
  }

  /**
   * 外食日でもタンパク質だけは日次ノルマを維持する。
   * P のバーは週予算とは独立に、毎日それ単体で評価する（§4-2 末尾）。
   */
  function proteinStatusFor(dailyProteinTargetG, actualG) {
    return {
      targetG: dailyProteinTargetG, actualG: actualG,
      met: actualG >= dailyProteinTargetG,
      shortfallG: Math.max(0, dailyProteinTargetG - actualG)
    }
  }

  /** 週の平均日次カロリー。下限ガードはこの値で判定する */
  function weeklyAvgDailyKcal(plan) { return plan.weeklyBudgetKcal / 7 }

  /** 曜日固定の外食日から、その週の logDate を求める。dayOfWeek は 0=日 〜 6=土 */
  function eatOutDateForWeek(anyLogDateInWeek, dayOfWeek) {
    var monday = weekStart(anyLogDateInWeek)
    return addLogDays(monday, dayOfWeek === 0 ? 6 : dayOfWeek - 1)
  }

  // =========================================================================
  // 食品データ（仕様書 §5）
  // 日本食品標準成分表ベース。誤差は許容する（記録の速さを優先）。
  // 各ユーザーが自分の食品を足せるので、ここは初期シードにあたる。
  // =========================================================================

  var FOODS = [
    { id:'chicken-thigh-skinless', name:'鶏もも肉（皮なし・生）', unit:'100g',     g:100, kcal:113, p:19.0, f:5.0,  c:0,    cat:'meat' },
    { id:'chicken-thigh-skin',     name:'鶏もも肉（皮つき・生）', unit:'100g',     g:100, kcal:190, p:16.6, f:14.2, c:0,    cat:'meat' },
    { id:'chicken-breast',         name:'鶏むね肉（皮なし・生）', unit:'100g',     g:100, kcal:105, p:23.3, f:1.9,  c:0.1,  cat:'meat' },
    { id:'salmon',                 name:'鮭（生）',              unit:'1切れ80g',  g:80,  kcal:133, p:22.3, f:4.1,  c:0.1,  cat:'fish' },
    // 焼き鮭。1切れ(生80g)を焼くと水分が抜けて約64gになるが、タンパク質の量は変わらない。
    // 減るのは水と、網に落ちる脂ぶんだけ。
    { id:'salmon-grilled',         name:'焼き鮭',                unit:'1切れ',     g:64,  kcal:128, p:22.3, f:3.6,  c:0.1,  cat:'fish' },
    { id:'egg-m',                  name:'卵（Mサイズ）',          unit:'1個',      g:50,  kcal:76,  p:6.2,  f:5.2,  c:0.2,  cat:'egg' },
    { id:'natto',                  name:'納豆',                  unit:'1パック45g', g:45, kcal:90,  p:7.4,  f:4.5,  c:5.4,  cat:'soy' },
    { id:'tofu-momen',             name:'木綿豆腐',              unit:'半丁150g',  g:150, kcal:110, p:10.5, f:6.3,  c:2.4,  cat:'soy' },
    { id:'kimchi',                 name:'キムチ',                unit:'50g',      g:50,  kcal:23,  p:1.3,  f:0.2,  c:3.9,  cat:'veg' },
    { id:'rice',                   name:'白米（炊飯後）',         unit:'100g',     g:100, kcal:156, p:2.5,  f:0.3,  c:37.1, cat:'grain' },
    { id:'mochimugi',              name:'もち麦（炊飯後）',       unit:'100g',     g:100, kcal:130, p:3.0,  f:0.6,  c:27.0, cat:'grain' },
    { id:'whey',                   name:'ホエイプロテイン',       unit:'1杯30g',   g:30,  kcal:120, p:21.0, f:1.5,  c:3.0,  cat:'supplement' },
    { id:'greek-yogurt',           name:'ギリシャヨーグルト',     unit:'100g',     g:100, kcal:59,  p:10.0, f:0.4,  c:3.9,  cat:'dairy' },
    { id:'broccoli',               name:'ブロッコリー（茹で）',   unit:'100g',     g:100, kcal:30,  p:3.9,  f:0.4,  c:4.3,  cat:'veg' },
    { id:'asparagus',              name:'アスパラガス（茹で）',   unit:'100g',     g:100, kcal:24,  p:2.6,  f:0.1,  c:4.6,  cat:'veg' },
    { id:'komatsuna',              name:'小松菜（茹で）',        unit:'100g',     g:100, kcal:14,  p:1.6,  f:0.1,  c:3.0,  cat:'veg' },
    { id:'spinach',                name:'ほうれん草（茹で）',     unit:'100g',     g:100, kcal:23,  p:2.6,  f:0.5,  c:4.0,  cat:'veg' },
    { id:'chingensai',             name:'チンゲン菜（茹で）',     unit:'100g',     g:100, kcal:12,  p:0.9,  f:0.1,  c:2.4,  cat:'veg' },
    { id:'cabbage',                name:'キャベツ（生）',        unit:'100g',     g:100, kcal:21,  p:1.3,  f:0.2,  c:5.2,  cat:'veg' },
    { id:'shimeji',                name:'しめじ',                unit:'100g',     g:100, kcal:18,  p:2.7,  f:0.5,  c:4.8,  cat:'mushroom' },
    { id:'eringi',                 name:'エリンギ',              unit:'100g',     g:100, kcal:19,  p:2.8,  f:0.4,  c:6.0,  cat:'mushroom' },
    { id:'misoshiru',              name:'味噌汁（具入り）',       unit:'1杯',      g:200, kcal:40,  p:3.0,  f:1.5,  c:4.0,  cat:'other' },
    { id:'banana',                 name:'バナナ',                unit:'1本',      g:100, kcal:86,  p:1.1,  f:0.2,  c:22.5, cat:'fruit' },
    { id:'kiwi',                   name:'キウイ',                unit:'1個',      g:85,  kcal:51,  p:1.0,  f:0.1,  c:13.5, cat:'fruit' },
    { id:'onigiri',                name:'おにぎり（塩・鮭）',     unit:'1個',      g:110, kcal:180, p:4.0,  f:1.0,  c:38.0, cat:'grain' },
    { id:'pork-fillet',            name:'豚ヒレ肉',              unit:'100g',     g:100, kcal:118, p:22.2, f:3.7,  c:0.2,  cat:'meat' },
    { id:'beef-round',             name:'牛もも赤身',            unit:'100g',     g:100, kcal:140, p:21.2, f:6.0,  c:0.5,  cat:'meat' },
    { id:'saba-can',               name:'サバ水煮缶',            unit:'1缶190g',  g:190, kcal:350, p:39.7, f:20.9, c:0.4,  cat:'fish' }
  ]

  var FOOD_BY_ID = {}
  FOODS.forEach(function (f) { FOOD_BY_ID[f.id] = f })

  function getFood(id, extraFoods) {
    if (extraFoods) {
      for (var i = 0; i < extraFoods.length; i++) if (extraFoods[i].id === id) return extraFoods[i]
    }
    var food = FOOD_BY_ID[id]
    if (!food) throw new Error('未登録の食品です: ' + id)
    return food
  }

  // =========================================================================
  // 定型セット（仕様書 §4-3）
  // ホーム最上部に常時表示。1タップで即記録、確認ダイアログなし。
  // 誤タップ対策は5秒間の「取り消し」トーストで行う。
  // items: [{ foodId, qty }]  qty は単位いくつぶん（白米150g なら 1.5）
  // =========================================================================

  var EMPTY_NUTRITION = { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 }

  function addNutrition(a, b) {
    return {
      kcal: a.kcal + b.kcal, proteinG: a.proteinG + b.proteinG,
      fatG: a.fatG + b.fatG, carbG: a.carbG + b.carbG
    }
  }

  function nutritionOfItem(item, extraFoods) {
    var food = getFood(item.foodId, extraFoods)
    return {
      kcal: food.kcal * item.qty, proteinG: food.p * item.qty,
      fatG: food.f * item.qty, carbG: food.c * item.qty
    }
  }

  function nutritionOfItems(items, extraFoods) {
    return items.reduce(function (acc, it) {
      return addNutrition(acc, nutritionOfItem(it, extraFoods))
    }, EMPTY_NUTRITION)
  }

  /* 新規ユーザー向けの初期セット。各自が中身を編集できる。
     中身は「1日のメニュー表（2026-08-07・味噌汁/豆腐なし版）」に合わせてある。
     ★この版から 味噌汁・豆腐・鮭・ヨーグルト は定型セットから外れた（食品としては残してある）。
     ★一番大きい食事は 2食目 ではなく 3食目（トレ後）になった。
     ★2026-08-09：卵3個を1食目にまとめず、1食目・2食目・3食目へ1個ずつ分散（本人の希望）。
       1日の合計（卵3個）は変わらない。各食のPFCだけが動く。 */
  var DEFAULT_PRESETS = [
    // 1食目 9:45（起床30分以内）＝卵かけご飯（卵1個＋ご飯200g）＋キムチ＋プロテイン
    { id:'meal-1',  name:'1食目',     summary:'', hour:9, ml:250,
      items:[{foodId:'egg-m',qty:1},{foodId:'rice',qty:2},{foodId:'kimchi',qty:1},{foodId:'whey',qty:1}] },
    // 間食 15:00 ＝プロテイン1杯だけ
    { id:'protein', name:'プロテイン', summary:'ホエイ1杯（30g）', hour:15, ml:250,
      items:[{foodId:'whey',qty:1}] },
    // 2食目 19:00（仕事から帰ってきた時）＝鶏もも185g・白米200g・ブロッコリー150g・卵1個
    { id:'meal-2',  name:'2食目',     summary:'', hour:19, ml:200,
      items:[{foodId:'chicken-thigh-skinless',qty:1.85},{foodId:'egg-m',qty:1},{foodId:'rice',qty:2},{foodId:'broccoli',qty:1.5}] },
    // 3食目 24:00（筋トレ後・深夜）＝1日で一番大きい。鶏もも250g・卵1個・納豆・白米250g・キムチ
    { id:'meal-3',  name:'3食目',     summary:'', hour:0, ml:0,
      items:[{foodId:'chicken-thigh-skinless',qty:2.5},{foodId:'egg-m',qty:1},{foodId:'natto',qty:1},{foodId:'rice',qty:2.5},{foodId:'kimchi',qty:1}] }
  ]

  /**
   * サプリメント。カロリーはほぼ無いので、記録の目的は「今日飲んだかどうか」だけ。
   * ※ 医学的な指示ではない。持病・服薬がある場合は医師や薬剤師に相談すること。
   */
  var DEFAULT_SUPPS = [
    { id:'multivit', name:'マルチビタミン',   note:'食事で不足しがちなビタミン・ミネラルの底上げ' },
    { id:'fishoil',  name:'フィッシュオイル', note:'EPA/DHA。魚を食べない日の補い' },
    { id:'creatine', name:'クレアチン 5g',    note:'筋力と除脂肪体重の維持。毎日同じ量を続けるのがコツ' },
    { id:'vitd',     name:'ビタミンD',        note:'日光に当たらない生活だと不足しやすい' },
    { id:'zinc',     name:'亜鉛・マグネシウム', note:'汗で失われやすい。就寝前に飲む人が多い' }
  ]

  /**
   * 数量を「実際の量」に言い換える。
   * 編集画面に「1」とだけ出ても、何の1なのか分からない（キムチは1＝50g、卵は1＝1個）。
   *   キムチ(50g) × 1   → '50g'
   *   白米(100g) × 1.5  → '150g'
   *   卵(1個)   × 3     → '3個（150g）'
   */
  function itemAmountLabel(food, qty) {
    var unit = String(food.unit || '')
    var grams = Math.round((+food.g || 0) * qty)
    if (/^\d+(\.\d+)?\s*g$/.test(unit)) return grams + 'g'
    var m = unit.match(/^(\d+(?:\.\d+)?)\s*([^\d]+?)(?:\d+(?:\.\d+)?\s*g)?$/)
    if (!m) return grams + 'g'
    var count = Math.round(parseFloat(m[1]) * qty * 100) / 100
    return count + m[2] + '（' + grams + 'g）'
  }

  /** 「1あたり何か」の説明。編集画面で数量の意味を示す */
  function itemUnitHint(food) {
    return '1 ＝ ' + String(food.unit || '')
  }

  function nutritionOfPreset(preset, extraFoods) { return nutritionOfItems(preset.items, extraFoods) }

  /** 定型セットを全部食べた場合の1日合計。設定画面で目標とのズレを見せる */
  function nutritionOfAllPresets(presets, extraFoods) {
    return (presets || DEFAULT_PRESETS)
      .map(function (p) { return nutritionOfPreset(p, extraFoods) })
      .reduce(addNutrition, EMPTY_NUTRITION)
  }

  /** 記録済みの食事を合計する。meals: [{kcal, proteinG, fatG, carbG}] */
  function sumNutrition(meals) {
    return meals.reduce(function (acc, m) {
      return {
        kcal: acc.kcal + (+m.kcal || 0), proteinG: acc.proteinG + (+m.proteinG || 0),
        fatG: acc.fatG + (+m.fatG || 0), carbG: acc.carbG + (+m.carbG || 0)
      }
    }, EMPTY_NUTRITION)
  }

  // =========================================================================
  // 水分とカフェイン
  //
  // ※ これは医学的な指示ではなく一般的な目安。持病・服薬がある場合は医師の指示を優先する。
  // 目標は「飲み物として記録したぶん」で数える。食品に含まれる水分は勘定に入れない
  // （そのぶん目標は少し多めに出るので、安全側）。
  // =========================================================================

  /** 体重1kgあたりの1日の目安 (ml)。一般的な成人の目安 */
  var WATER_ML_PER_KG = 35
  /** 運動1時間あたりの追加 (ml)。発汗ぶんの補給 */
  var WATER_ML_PER_TRAINING_HOUR = 500
  /** 1日のカフェイン上限 (mg)。健康な成人の一般的な目安 */
  var CAFFEINE_DAILY_MAX_MG = 400
  /** 1回あたりのカフェイン上限 (mg) */
  var CAFFEINE_SINGLE_MAX_MG = 200
  /** 就寝の何時間前からカフェインを避けたいか（半減期は5〜6時間） */
  var CAFFEINE_CUTOFF_H = 6

  /**
   * 1日に必要な水分の目安 (ml)。50ml 単位に丸める。
   * trainingMinutes を渡すと、その日の運動ぶんが上乗せされる。
   */
  function waterTargetMl(weightKg, opts) {
    opts = opts || {}
    var base = weightKg * WATER_ML_PER_KG
    var train = ((+opts.trainingMinutes || 0) / 60) * WATER_ML_PER_TRAINING_HOUR
    return Math.round((base + train) / 50) * 50
  }

  /** 飲み物の合計。drinks: [{ml, caffeineMg, kcal}] */
  function sumDrinks(drinks) {
    return (drinks || []).reduce(
      function (a, d) {
        return {
          ml: a.ml + (+d.ml || 0),
          caffeineMg: a.caffeineMg + (+d.caffeineMg || 0),
          kcal: a.kcal + (+d.kcal || 0),
        }
      },
      { ml: 0, caffeineMg: 0, kcal: 0 },
    )
  }

  /**
   * 「あと何本」に言い換える。
   * ml という単位は日常の行動に結びつかない（3,100ml と言われても何をすればいいか分からない）。
   * いつも飲んでいる容器の大きさ（既定500ml）で割って「あと◯本」に直す。
   */
  function waterCups(ml, targetMl, cupMl) {
    var cup = cupMl > 0 ? cupMl : 500
    var total = Math.max(1, Math.ceil(targetMl / cup))
    var done = Math.max(0, Math.min(total, Math.floor(ml / cup)))
    var remainingMl = Math.max(0, targetMl - ml)
    return {
      cupMl: cup,
      total: total,                                   // 目標を本数に直すと何本か
      done: done,                                     // もう飲んだ本数
      remaining: Math.ceil(remainingMl / cup),        // あと何本
      remainingMl: remainingMl,
    }
  }

  /** 水分の進み具合。足りない時だけ知らせる（飲みすぎ警告は出さない） */
  function hydrationStatus(ml, targetMl) {
    var remainingMl = Math.max(0, targetMl - ml)
    var pct = targetMl > 0 ? Math.min(100, (ml / targetMl) * 100) : 0
    var level = ml >= targetMl ? 'done' : (pct >= 60 ? 'ok' : 'low')
    return {
      ml: ml, targetMl: targetMl, remainingMl: remainingMl, pct: pct, level: level,
      message: level === 'done'
        ? '今日の目安に届きました'
        : 'あと ' + remainingMl.toLocaleString() + 'ml',
    }
  }

  /** その時刻から就寝までの残り時間 (h)。bedHour が翌日にまたがる場合も正しく出す */
  function hoursUntilBed(atHour, bedHour) {
    return (((bedHour - atHour) % 24) + 24) % 24
  }

  /**
   * カフェインの状態。
   * lastAtHour を渡すと、就寝前に近すぎないかも見る（睡眠の質のため）。
   */
  function caffeineStatus(mg, opts) {
    opts = opts || {}
    var out = { mg: mg, maxMg: CAFFEINE_DAILY_MAX_MG, level: 'ok', message: '' }
    if (mg > CAFFEINE_DAILY_MAX_MG) {
      out.level = 'over'
      out.message = '1日の目安 ' + CAFFEINE_DAILY_MAX_MG + 'mg を超えています'
      return out
    }
    if (opts.lastAtHour != null && mg > 0) {
      var h = hoursUntilBed(opts.lastAtHour, opts.bedHour == null ? 2 : opts.bedHour)
      if (h < CAFFEINE_CUTOFF_H) {
        out.level = 'late'
        out.message = '就寝まで約' + h + '時間。カフェインは' + CAFFEINE_CUTOFF_H + '時間前までが目安です'
        return out
      }
    }
    if (mg > CAFFEINE_DAILY_MAX_MG * 0.8) {
      out.level = 'near'
      out.message = '目安 ' + CAFFEINE_DAILY_MAX_MG + 'mg に近づいています'
    }
    return out
  }

  /** 初期の飲み物。各自が編集できる（ml / カフェイン / kcal）。
      「ml」は実際に口に入る量。氷は溶ければ水になるので、氷入りでも量は変えない。 */
  var DEFAULT_DRINKS = [
    { id: 'water500',  name: '水',            ml: 500, caffeineMg: 0,  kcal: 0 },
    { id: 'water250',  name: '水（コップ）',   ml: 250, caffeineMg: 0,  kcal: 0 },
    { id: 'coffee',    name: 'コーヒー',       ml: 150, caffeineMg: 90, kcal: 4 },
    // ネスプレッソ ヴァーチュオを氷に注いだアイスコーヒー。
    // ★水分として数えるのは「最終的に口に入る量」。氷は溶ければ水になるので、
    //   コーヒー＋溶けた氷でグラス1杯ぶん＝500ml として数える。
    //   カフェインはカプセル由来なので氷では増えない（マグ相当 170mg を初期値）。
    { id: 'vertuo',    name: 'ヴァーチュオ（氷入り）', ml: 500, caffeineMg: 170, kcal: 2 },
    { id: 'cafeaulait',name: 'カフェオレ',     ml: 200, caffeineMg: 60, kcal: 90 },
    { id: 'greentea',  name: '緑茶',          ml: 200, caffeineMg: 40, kcal: 0 },
    { id: 'mugicha',   name: '麦茶',          ml: 500, caffeineMg: 0,  kcal: 0 },
    // プロテインは粉のぶんを食事側で記録済みなので、ここでは水分だけ数える（kcal は 0）
    { id: 'proteinw',  name: 'プロテインの水', ml: 250, caffeineMg: 0,  kcal: 0 },
  ]

  // =========================================================================

  return {
    // 水分・カフェイン
    WATER_ML_PER_KG: WATER_ML_PER_KG, WATER_ML_PER_TRAINING_HOUR: WATER_ML_PER_TRAINING_HOUR,
    CAFFEINE_DAILY_MAX_MG: CAFFEINE_DAILY_MAX_MG, CAFFEINE_SINGLE_MAX_MG: CAFFEINE_SINGLE_MAX_MG,
    CAFFEINE_CUTOFF_H: CAFFEINE_CUTOFF_H, DEFAULT_DRINKS: DEFAULT_DRINKS,
    waterTargetMl: waterTargetMl, waterCups: waterCups, sumDrinks: sumDrinks, hydrationStatus: hydrationStatus,
    hoursUntilBed: hoursUntilBed, caffeineStatus: caffeineStatus,
    // 係数
    SMM_TO_LBM: SMM_TO_LBM, PROTEIN_PER_LBM: PROTEIN_PER_LBM,
    FAT_PER_BODYWEIGHT: FAT_PER_BODYWEIGHT, FAT_FLOOR_PER_BODYWEIGHT: FAT_FLOOR_PER_BODYWEIGHT,
    CARB_FLOOR_G: CARB_FLOOR_G, DEFAULT_DEFICIT: DEFAULT_DEFICIT,
    DEFAULT_ACTIVITY: DEFAULT_ACTIVITY, ACTIVITY_LEVELS: ACTIVITY_LEVELS,
    DEFAULT_BOUNDARY_HOUR: DEFAULT_BOUNDARY_HOUR, DEFAULT_EAT_OUT_KCAL: DEFAULT_EAT_OUT_KCAL,
    NORMAL_TARGET_STEP: NORMAL_TARGET_STEP,
    // 丸め
    roundKcal: roundKcal, roundMacro: roundMacro,
    // 体組成・目標
    lbmFromBodyFat: lbmFromBodyFat, lbmFromSkeletalMuscle: lbmFromSkeletalMuscle,
    resolveLbm: resolveLbm, bmrFromLbm: bmrFromLbm, tdeeFromBmr: tdeeFromBmr,
    macrosForCalories: macrosForCalories, buildPlan: buildPlan,
    goalFromTargetBodyFat: goalFromTargetBodyFat, projectLandingDate: projectLandingDate,
    // 安全・レビュー
    evaluateCalorieSafety: evaluateCalorieSafety, reviewWeek: reviewWeek,
    applyAdjustment: applyAdjustment, movingAverage: movingAverage,
    // 日付境界
    formatLogDate: formatLogDate, toLogDate: toLogDate, logDateLabel: logDateLabel,
    logDateRange: logDateRange, isLateNight: isLateNight, addLogDays: addLogDays,
    weekStart: weekStart, weekDates: weekDates,
    // 週予算
    planWeek: planWeek, dailyTargetFor: dailyTargetFor, weekProgress: weekProgress,
    proteinStatusFor: proteinStatusFor, weeklyAvgDailyKcal: weeklyAvgDailyKcal,
    eatOutDateForWeek: eatOutDateForWeek,
    // 食品・定型セット
    FOODS: FOODS, getFood: getFood, DEFAULT_PRESETS: DEFAULT_PRESETS, DEFAULT_SUPPS: DEFAULT_SUPPS,
    EMPTY_NUTRITION: EMPTY_NUTRITION, addNutrition: addNutrition,
    nutritionOfItem: nutritionOfItem, nutritionOfItems: nutritionOfItems,
    itemAmountLabel: itemAmountLabel, itemUnitHint: itemUnitHint,
    nutritionOfPreset: nutritionOfPreset, nutritionOfAllPresets: nutritionOfAllPresets,
    sumNutrition: sumNutrition
  }
})
