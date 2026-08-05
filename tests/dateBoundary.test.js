import { describe, it, expect } from 'vitest'
import K from '../keiryo-calc.js'

/** new Date(year, monthIndex, day, hour, min) はローカル時刻。JST 環境の実挙動と一致する */
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min)

describe('§4-1 日付境界 04:00 — 仕様書 §10 が名指しした4ケース', () => {
  it('境界は 4:00', () => {
    expect(K.DEFAULT_BOUNDARY_HOUR).toBe(4)
  })

  it('7/18 23:59 → 7/18（当日のまま）', () => {
    expect(K.toLogDate(at(2026, 7, 18, 23, 59))).toBe('2026-07-18')
  })

  it('7/19 00:00 → 7/18（前日に寄せる）', () => {
    expect(K.toLogDate(at(2026, 7, 19, 0, 0))).toBe('2026-07-18')
  })

  it('7/19 03:59 → 7/18（まだ前日）', () => {
    expect(K.toLogDate(at(2026, 7, 19, 3, 59))).toBe('2026-07-18')
  })

  it('7/19 04:00 → 7/19（ここから新しい1日）', () => {
    expect(K.toLogDate(at(2026, 7, 19, 4, 0))).toBe('2026-07-19')
  })
})

describe('§4-1 実際の生活パターンで壊れないこと', () => {
  it('トレ後 24:30 の3食目は前日ぶんに計上される', () => {
    expect(K.toLogDate(at(2026, 7, 19, 0, 30))).toBe('2026-07-18')
  })

  it('起床9:15 の体重測定は当日ぶん', () => {
    expect(K.toLogDate(at(2026, 7, 19, 9, 15))).toBe('2026-07-19')
  })

  it('1日ぶんの記録が同じ logDate にそろう（9:45 / 14:00 / 19:00 / 翌0:30）', () => {
    const times = [
      at(2026, 7, 18, 9, 45),
      at(2026, 7, 18, 14, 0),
      at(2026, 7, 18, 19, 0),
      at(2026, 7, 19, 0, 30),
    ]
    expect(new Set(times.map((t) => K.toLogDate(t))).size).toBe(1)
    expect(K.toLogDate(times[3])).toBe('2026-07-18')
  })

  it('2:00 の就寝直前の記録も前日ぶん', () => {
    expect(K.toLogDate(at(2026, 7, 19, 2, 0))).toBe('2026-07-18')
  })
})

describe('§4-1 月またぎ・年またぎ・うるう日', () => {
  it('8/1 02:00 → 7/31', () => {
    expect(K.toLogDate(at(2026, 8, 1, 2, 0))).toBe('2026-07-31')
  })

  it('1/1 01:00 → 前年 12/31', () => {
    expect(K.toLogDate(at(2026, 1, 1, 1, 0))).toBe('2025-12-31')
  })

  it('3/1 03:00 → 2/28（平年）', () => {
    expect(K.toLogDate(at(2026, 3, 1, 3, 0))).toBe('2026-02-28')
  })

  it('3/1 03:00 → 2/29（うるう年 2028）', () => {
    expect(K.toLogDate(at(2028, 3, 1, 3, 0))).toBe('2028-02-29')
  })

  it('日付は UTC ではなくローカル基準（toISOString のずれを踏まない）', () => {
    expect(K.toLogDate(at(2026, 7, 19, 8, 0))).toBe('2026-07-19')
  })
})

describe('§4-1 境界時刻は設定で変更できる', () => {
  it('境界 0:00 なら 0:30 は当日ぶん', () => {
    expect(K.toLogDate(at(2026, 7, 19, 0, 30), 0)).toBe('2026-07-19')
  })

  it('境界 6:00 なら 5:00 は前日ぶん', () => {
    expect(K.toLogDate(at(2026, 7, 19, 5, 0), 6)).toBe('2026-07-18')
  })
})

describe('§4-1 記録画面の明示ラベル', () => {
  it('0:30 の記録は「7/18(土)の記録として保存されます」', () => {
    expect(K.logDateLabel(at(2026, 7, 19, 0, 30))).toBe('7/18(土)の記録として保存されます')
  })

  it('19:00 の記録は当日ラベル', () => {
    expect(K.logDateLabel(at(2026, 7, 18, 19, 0))).toBe('7/18(土)の記録として保存されます')
  })

  it('深夜ぶんかどうかを判定できる', () => {
    expect(K.isLateNight(at(2026, 7, 19, 0, 30))).toBe(true)
    expect(K.isLateNight(at(2026, 7, 18, 23, 30))).toBe(false)
  })
})

describe('§4-1 logDate の実時刻レンジ', () => {
  it('7/18 は 7/18 4:00 〜 7/19 4:00', () => {
    const { start, end } = K.logDateRange('2026-07-18')
    expect(start.getDate()).toBe(18)
    expect(start.getHours()).toBe(4)
    expect(end.getDate()).toBe(19)
    expect(end.getHours()).toBe(4)
  })

  it('レンジの内側の時刻は必ずその logDate になる', () => {
    const { start, end } = K.logDateRange('2026-07-18')
    const mid = new Date((start.getTime() + end.getTime()) / 2)
    expect(K.toLogDate(mid)).toBe('2026-07-18')
    expect(K.toLogDate(new Date(end.getTime()))).toBe('2026-07-19')
  })
})

describe('週の単位（月曜始まり）', () => {
  it('土曜 7/18 の週は月曜 7/13 から', () => {
    expect(K.weekStart('2026-07-18')).toBe('2026-07-13')
  })

  it('日曜 7/19 も同じ週（前の月曜に寄る）', () => {
    expect(K.weekStart('2026-07-19')).toBe('2026-07-13')
  })

  it('月曜 7/20 から次の週', () => {
    expect(K.weekStart('2026-07-20')).toBe('2026-07-20')
  })

  it('週の7日が月曜〜日曜でそろう', () => {
    expect(K.weekDates('2026-07-18')).toEqual([
      '2026-07-13', '2026-07-14', '2026-07-15',
      '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19',
    ])
  })

  it('addLogDays が月をまたいでも正しい', () => {
    expect(K.addLogDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(K.addLogDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})
