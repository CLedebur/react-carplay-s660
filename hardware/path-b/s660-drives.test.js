// node --test hardware/path-b/s660-drives.test.js
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { summarise, createDrives } = require('./s660-drives')

// A made-up 20 s recording: 0x1D0 wheels at 36 km/h, 0x1DC rpm 2000, and one AHA in 0x1A4 from 5 to 7 s.
const wheels = kmh => {
  const w = BigInt(Math.round(kmh * 100))
  return ((w << 49n) | (w << 34n) | (w << 19n) | (w << 4n)).toString(16).padStart(16, '0').toUpperCase()
}
const fakeLog = file => {
  const lines = []
  for (let ms = 0; ms <= 20000; ms += 20) {
    const t = (1000 + ms / 1000).toFixed(6)
    lines.push(`(${t}) can0 1D0#${wheels(36)}`, `(${t}) can0 1DC#0007D000`, `(${t}) can0 1A4#006A0000${ms >= 5000 && ms < 7000 ? '80' : '00'}000027`)
  }
  fs.writeFileSync(file, lines.join('\n') + '\n')
}

test('a recording is summed up: distance, peaks, interventions, a 1 s trace', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's660-drives-'))
  const log = path.join(dir, 'x.log')
  fakeLog(log)
  const s = await summarise(log, path.join(dir, 'none.jsonl'))
  assert.ok(Math.abs(s.distanceKm - 0.2) < 0.005, `distance ${s.distanceKm}`) // 36 km/h for 20 s = 200 m
  assert.strictEqual(s.max.rpm, 2000)
  assert.deepStrictEqual(s.events, { agile: 1, active: 0, abs: 0 })
  assert.strictEqual(s.series.length, 21)
  assert.strictEqual(s.requests, null) // a listen-only recording has no request log
})

test('the list reads names, newest first, and refuses anything else', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's660-drives-'))
  for (const f of ['2026-11-03-113640-4a12-engine.log', '2026-11-02-111500-abcd-listen.log', 'notes.txt', '../x.log']) {
    if (!f.includes('/')) fs.writeFileSync(path.join(dir, f), '')
  }
  process.env.S660_DRIVES_DIR = dir
  delete require.cache[require.resolve('./s660-drives')]
  const d = require('./s660-drives').createDrives()
  const names = d.list().map(x => x.name)
  assert.deepStrictEqual(names, ['2026-11-03-113640-4a12-engine', '2026-11-02-111500-abcd-listen'])
  assert.strictEqual(d.get('../../etc/passwd'), null)
})
