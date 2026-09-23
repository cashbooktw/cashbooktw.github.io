import importlib.util
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dispatches', Path(__file__).resolve().parents[1] / 'scripts/update_dispatches.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class DispatchTests(unittest.TestCase):
    def test_twse_skips_today_and_uses_actual_trading_date(self):
        q=m.twse_quote({'data':[['115/09/21','0','0','0','22,000','-100'],['115/09/22','0','0','0','22,110','110'],['115/09/23','0','0','0','22,200','90']]},date(2026,9,23))
        self.assertEqual(q['date'],'2026-09-22'); self.assertEqual(q['close'],22110); self.assertEqual(q['change_pct'],.5)
    def test_twse_holiday_and_month_boundary(self):
        q=m.twse_quote({'data':[['115/08/28','0','0','0','21,900','-100']]},date(2026,9,1))
        self.assertEqual(q['date'],'2026-08-28')
    def chart(self):
        stamps=[int(datetime(2026,9,d,13,30,tzinfo=timezone.utc).timestamp()) for d in (18,21,22)]
        return {'chart':{'result':[{'timestamp':stamps,'indicators':{'quote':[{'close':[100,102,105]}]}}]}}
    def test_us_incomplete_bar_is_not_previous_close(self):
        q=m.yahoo_quote(self.chart(),datetime(2026,9,22,18,tzinfo=timezone.utc))
        self.assertEqual(q['date'],'2026-09-21');self.assertEqual(q['change'],2)
    def test_us_completed_bar_and_taipei_date(self):
        q=m.yahoo_quote(self.chart(),datetime(2026,9,22,23,17,tzinfo=timezone.utc))
        self.assertEqual(q['date'],'2026-09-22');self.assertEqual(q['close'],105)
    def test_missing_quotes_not_zero(self):
        with self.assertRaises(ValueError):m.twse_quote({'data':[]},date(2026,9,23))
        with self.assertRaises(ValueError):m.yahoo_quote({'chart':{'error':{'code':'Not Found'}}},datetime.now(timezone.utc))
        for value in (None,True,'NaN','Infinity'):
            with self.assertRaises(ValueError):m.numeric(value)
    def test_fx_direction(self):
        q=m.fx_quote({'base':'USD','quote':'TWD','rate':32.1,'date':'2026-09-22'},date(2026,9,23))
        self.assertEqual(q['rate'],32.1)
        with self.assertRaises(ValueError):m.fx_quote({'base':'TWD','quote':'USD','rate':.03,'date':'2026-09-22'},date(2026,9,23))
    def test_outage_retains_dated_values_and_marks_failures(self):
        previous={'quotes':{'tw':{'date':'2026-09-21','close':22000}},'fx':None}
        with patch.object(m,'get_json',side_effect=OSError('offline')):
            q=m.refresh(datetime(2026,9,23,tzinfo=timezone.utc),previous)
        self.assertEqual(q['quotes'],previous['quotes']);self.assertEqual(len(q['errors']),5)

if __name__ == '__main__': unittest.main()
