import test from 'node:test';
import assert from 'node:assert/strict';
import { compare13F, parse13FInformationTable } from '../server/secData.js';
import { parseBlsCalendarIcs } from '../server/macroCalendar.js';
import { selectOptionExpiration } from '../server/marketIntelligence.js';

test('13F XML bilgi tablosunu normalize eder', () => {
  const xml = `<?xml version="1.0"?><informationTable xmlns="x"><infoTable>
    <nameOfIssuer>Example &amp; Co</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>123456789</cusip>
    <value>1250</value><shrsOrPrnAmt><sshPrnamt>50000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion></infoTable></informationTable>`;
  const rows = parse13FInformationTable(xml);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].issuer, 'Example & Co');
  assert.equal(rows[0].valueUsd, 1_250);
  assert.equal(rows[0].shares, 50_000);
});

test('2022 ve öncesi 13F değerleri açık legacy seçeneğiyle bin dolar ölçeklenir', () => {
  const xml = `<informationTable><infoTable><nameOfIssuer>Legacy Co</nameOfIssuer><cusip>111111111</cusip><value>1250</value><sshPrnamt>10</sshPrnamt></infoTable></informationTable>`;
  assert.equal(parse13FInformationTable(xml, { legacyThousands: true })[0].valueUsd, 1_250_000);
});

test('13F kıyası PUT/CALL satırlarını ayırır ve yinelenen hisse satırlarını toplar', () => {
  const current = [
    { cusip: '123', titleOfClass: 'COM', putCall: null, issuer: 'Example', shares: 60, valueUsd: 600 },
    { cusip: '123', titleOfClass: 'COM', putCall: null, issuer: 'Example', shares: 40, valueUsd: 400 },
    { cusip: '123', titleOfClass: 'COM', putCall: 'CALL', issuer: 'Example', shares: 25, valueUsd: 250 },
  ];
  const previous = [
    { cusip: '123', titleOfClass: 'COM', putCall: null, issuer: 'Example', shares: 80, valueUsd: 800 },
    { cusip: '123', titleOfClass: 'COM', putCall: 'CALL', issuer: 'Example', shares: 30, valueUsd: 300 },
  ];
  const moves = compare13F(current, previous);
  assert.equal(moves.length, 2);
  assert.equal(moves.find((move) => move.putCall == null).changeShares, 20);
  assert.equal(moves.find((move) => move.putCall === 'CALL').changeShares, -5);
});

test('BLS ICS içinden CPI ve NFP olaylarını seçer', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20260904T083000\nSUMMARY:Employment Situation\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20260911T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nEND:VCALENDAR`;
  const events = parseBlsCalendarIcs(ics);
  assert.deepEqual(events.map((event) => event.code), ['NFP', 'CPI']);
  assert.ok(events.every((event) => event.date.endsWith('Z')));
});

test('BLS ET saatini DST sınırlarında doğru UTC saatine çevirir', () => {
  const ics = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20260306T083000\nSUMMARY:Employment Situation\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20260710T083000\nSUMMARY:Consumer Price Index\nEND:VEVENT\nBEGIN:VEVENT\nDTSTART;TZID=America/New_York:20261106T083000\nSUMMARY:Producer Price Index\nEND:VEVENT\nEND:VCALENDAR`;
  const events = parseBlsCalendarIcs(ics);
  assert.deepEqual(events.map((event) => event.date), [
    '2026-03-06T13:30:00.000Z',
    '2026-07-10T12:30:00.000Z',
    '2026-11-06T13:30:00.000Z',
  ]);
});

test('opsiyon vadesi bilanço tarihini kapsayan ilk zincirden seçilir', () => {
  const expirations = ['2026-08-14', '2026-08-21', '2026-09-18'].map((date) => new Date(`${date}T00:00:00Z`));
  assert.equal(
    selectOptionExpiration(expirations, '2026-08-18T21:00:00Z').toISOString(),
    '2026-08-21T00:00:00.000Z'
  );
  assert.equal(selectOptionExpiration(expirations, null).toISOString(), '2026-08-14T00:00:00.000Z');
});
