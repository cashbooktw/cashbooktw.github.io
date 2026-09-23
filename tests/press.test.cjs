const test=require('node:test');const assert=require('node:assert/strict');
const {day,weatherInfo,validWeather}=require('../assets/js/press.js');
test('Taipei date is independent of the browser timezone',()=>{assert.equal(day(new Date('2026-09-22T16:01:00Z')),'2026-09-23');});
test('Weather symbols cover WMO codes and unknown values',()=>{for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99])assert.notEqual(weatherInfo(code)[1],'unknown');assert.equal(weatherInfo(null)[1],'unknown');});
const forecast=()=>({daily:{time:['2026-09-23'],weather_code:[61],temperature_2m_min:[24],temperature_2m_max:[30],precipitation_sum:[0]}});
test('Zero millimetres is valid and is not a missing value',()=>{assert.equal(validWeather(forecast(),'2026-09-23').rain,0);});
test('Missing data cannot become zero or an old forecast',()=>{const p=forecast();p.daily.precipitation_sum[0]=null;assert.throws(()=>validWeather(p,'2026-09-23'));assert.throws(()=>validWeather(forecast(),'2026-09-24'));});
test('Invalid temperature range and negative rain are rejected',()=>{const p=forecast();p.daily.temperature_2m_min[0]=35;assert.throws(()=>validWeather(p,'2026-09-23'));p.daily.temperature_2m_min[0]=24;p.daily.precipitation_sum[0]=-1;assert.throws(()=>validWeather(p,'2026-09-23'));});
