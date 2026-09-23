/* Progressive presentation layer. Keeps the existing edition/schema reader untouched. */
(() => {
  'use strict';
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  const day = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  const weatherInfo = (code) => {
    if (code === 0) return ['晴朗','sun'];
    if ([1,2].includes(code)) return ['晴時多雲','partly'];
    if (code === 3) return ['陰天','cloud'];
    if ([45,48].includes(code)) return ['有霧','fog'];
    if ([51,53,55,56,57].includes(code)) return ['毛毛雨','rain'];
    if ([61,63,65,66,67,80,81,82].includes(code)) return ['降雨','rain'];
    if ([71,73,75,77,85,86].includes(code)) return ['降雪','snow'];
    if ([95,96,99].includes(code)) return ['雷雨','storm'];
    return ['天氣不明','unknown'];
  };
  function validWeather(data, today = day()) {
    const d = data?.daily, i = d?.time?.indexOf(today) ?? -1;
    if (i < 0 || !['weather_code','temperature_2m_min','temperature_2m_max','precipitation_sum'].every(k => finite(d[k]?.[i]))) throw new Error('缺少當日預報');
    if (d.precipitation_sum[i] < 0 || d.temperature_2m_min[i] > d.temperature_2m_max[i]) throw new Error('預報資料無效');
    return {date:today,code:d.weather_code[i],low:d.temperature_2m_min[i],high:d.temperature_2m_max[i],rain:d.precipitation_sum[i]};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {day,weatherInfo,validWeather};
  if (typeof document === 'undefined') return;
  const $ = id => document.getElementById(id);
  const el = (tag,text,cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const number = (v,digits=2) => new Intl.NumberFormat('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v);
  const dateText = value => String(value).replaceAll('-','/');
  const sourceLink = (text,url) => {const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
  const source = (card,text,url) => {const p=el('p',undefined,'dispatch-source');p.append(sourceLink(text+' ↗',url));card.append(p);};
  const note = (card,text,cls='dispatch-note') => card.append(el('p',text,cls));
  const paths = {sun:'M24 5v4m0 30v4M5 24h4m30 0h4M10 10l3 3m22 22 3 3M10 38l3-3m22-22 3-3',cloud:'M12 32h24a8 8 0 0 0 0-16 12 12 0 0 0-22-2 9 9 0 0 0-2 18Z',rain:'m16 37-3 6m12-6-3 6m12-6-3 6',fog:'M7 38h34M12 43h24',snow:'M24 35v10m-5-8 10 6m0-6-10 6',storm:'m26 33-7 8h7l-5 7',unknown:'M18 18a6 6 0 1 1 10 4c-4 2-4 4-4 6m0 7v1'};
  function weatherIcon(kind) {
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    for(const [k,v] of Object.entries({viewBox:'0 0 48 50',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',class:'weather-icon'}))svg.setAttribute(k,v);
    if(['sun','partly'].includes(kind)){const c=document.createElementNS(ns,'circle');c.setAttribute('cx','24');c.setAttribute('cy','24');c.setAttribute('r','9');svg.append(c);}
    const names=kind==='sun'?['sun']:kind==='partly'?['sun','cloud']:['rain','fog','snow','storm'].includes(kind)?['cloud',kind]:[kind];
    for(const name of names){const p=document.createElementNS(ns,'path');p.setAttribute('d',paths[name]||paths.unknown);svg.append(p);}return svg;
  }
  const headings={tw:['台股前日收盤','TAIWAN / TAIEX'],us:['美股前日收盤','WALL STREET'],fx:['台幣・美元','CURRENCY EXCHANGE'],weather:['新竹市今日天氣','HSINCHU / ECMWF']};
  function card(key){const c=$('dispatch-'+key);c.replaceChildren();const h=el('h3',headings[key][0],'dispatch-label');h.append(el('span',headings[key][1]));c.append(h);return c;}
  function unavailable(key,text){const c=card(key);c.append(el('p',text,'dispatch-unavailable'));return c;}
  function change(q){const sign=q.change>0?'▲':q.change<0?'▼':'—';return `${sign} ${number(Math.abs(q.change))}（${q.change_pct>0?'+':''}${number(q.change_pct)}%）`;}
  const validQuote = q => q && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && q.date<day() && ['close','change','change_pct'].every(k=>finite(q[k])) && q.close>0;
  function freshness(c,q,snapshot){note(c,`${dateText(q.date)} 收盤`);if(snapshot?.errors?.[q.key] || snapshot?.date!==day() || snapshot?.cached)note(c,'保留最近可用資料；更新暫未完成','dispatch-note dispatch-stale');}
  function drawMarkets(data){
    const tw=data?.quotes?.tw;
    if(validQuote(tw)){const c=card('tw');c.append(el('p',number(tw.close),'dispatch-value'));note(c,change(tw));freshness(c,{...tw,key:'tw'},data);source(c,'臺灣證券交易所','https://www.twse.com.tw/zh/trading/historical/fmtqik.html');}
    else {const c=unavailable('tw','暫無可用收盤資料');source(c,'查閱證交所','https://www.twse.com.tw/zh/trading/historical/fmtqik.html');}
    const c=card('us');let count=0;const dates=new Set();let failed=false;
    for(const [key,name] of [['sp500','S&P 500'],['nasdaq','NASDAQ'],['dow','道瓊工業']]){
      const q=data?.quotes?.[key];if(!validQuote(q))continue;count++;
      const row=el('div',undefined,'dispatch-row');row.append(el('span',name));const values=el('span');values.append(el('strong',number(q.close)),el('small',`${q.change_pct>=0?'+':''}${number(q.change_pct)}%`));row.append(values);c.append(row);
      dates.add(q.date);if(data?.errors?.[key])failed=true;
    }
    if(count)note(c,`${[...dates].map(dateText).join('、')} 收盤`);
    if(!count)c.append(el('p','暫無可用收盤資料','dispatch-unavailable'));
    else if(data.date!==day()||data.cached||failed)note(c,'保留最近可用資料；更新暫未完成','dispatch-note dispatch-stale');
    if(count>0&&count<3)note(c,'部分指數暫無資料');
    source(c,'Yahoo Finance · 收盤參考','https://finance.yahoo.com/markets/world-indices/');
  }
  function drawFX(q,cached=false){
    if(!q || !finite(q.rate) || q.rate<=0 || q.base?.toUpperCase()!=='USD' || q.quote?.toUpperCase()!=='TWD' || !/^\d{4}-\d{2}-\d{2}$/.test(q.date) || q.date>day())throw new Error('匯率資料無效');
    const c=card('fx');note(c,'1 USD =');const p=el('p',number(q.rate,3),'dispatch-value');p.append(el('span',' TWD','dispatch-unit'));c.append(p);note(c,`1 TWD = ${number(1/q.rate,5)} USD`);note(c,`${dateText(q.date)} · 每日參考匯率，非銀行牌告`);if(cached)note(c,'連線失敗，顯示最近可用資料','dispatch-note dispatch-stale');source(c,'Frankfurter','https://frankfurter.dev/');
  }
  function drawWeather(w,cached=false){const c=card('weather'),[label,kind]=weatherInfo(w.code),row=el('div',undefined,'dispatch-weather');row.append(weatherIcon(kind));const p=el('p',`${number(w.low,0)}–${number(w.high,0)}°`,'dispatch-value');p.append(el('span','C','dispatch-unit'));row.append(p);c.append(row);note(c,`${label} · 預估全天降雨 ${number(w.rain,1)} mm`);note(c,`${dateText(w.date)} · 新竹市 · 台北時間`);if(cached)note(c,'連線失敗，顯示今日快取預報','dispatch-note dispatch-stale');source(c,'Open-Meteo / ECMWF IFS 0.25°','https://open-meteo.com/en/docs/ecmwf-api');}
  async function getJSON(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{signal:controller.signal,credentials:'omit',cache:'no-cache'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(timer);}}
  const store={get(key){try{return JSON.parse(localStorage.getItem('signal-'+key));}catch{return null;}},set(key,value){try{localStorage.setItem('signal-'+key,JSON.stringify(value));}catch{/* Storage is optional. */}}};
  async function loadMarkets(){let data;try{data=await getJSON('https://raw.githubusercontent.com/cashbooktw/cashbooktw.github.io/master/data/dispatches.json');if(data.schema_version!==1)throw new Error('資料版本不符');store.set('markets',data);}catch{try{data=await getJSON('data/dispatches.json');}catch{data=store.get('markets');}if(data)data={...data,cached:true};}drawMarkets(data);return data;}
  async function loadFX(snapshot){try{const q=await getJSON('https://api.frankfurter.dev/v2/rate/USD/TWD');drawFX(q);store.set('fx',q);}catch{try{drawFX(snapshot?.fx||store.get('fx'),true);}catch{const c=unavailable('fx','匯率暫時無法取得');source(c,'Frankfurter','https://frankfurter.dev/');}}}
  async function loadWeather(){
    const now=day();let cached=store.get('weather');
    if(!cached?.value||!finite(cached.saved)||!['code','low','high','rain'].every(k=>finite(cached.value[k]))||cached.value.rain<0||cached.value.low>cached.value.high)cached=null;
    if(cached?.value?.date===now&&Date.now()-cached.saved<30*60*1000){drawWeather(cached.value);return;}
    const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:'24.8039',longitude:'120.9647',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',models:'ecmwf_ifs025',timezone:'Asia/Taipei',forecast_days:'1'});
    try{const w=validWeather(await getJSON(url));drawWeather(w);store.set('weather',{saved:Date.now(),value:w});}catch{if(cached?.value?.date===now)drawWeather(cached.value,true);else{const c=unavailable('weather','今日預報暫時無法取得');note(c,'不以昨日天氣冒充今日預報');source(c,'Open-Meteo / ECMWF','https://open-meteo.com/en/docs/ecmwf-api');}}
  }
  const grid=$('stories');let frame=0;
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(layout);};
  function layout(){frame=0;if(!('ResizeObserver' in window))return;const wide=window.innerWidth>=700;grid.classList.toggle('press-grid',wide);for(const story of grid.children){const content=story.querySelector('.story-content');if(content)story.style.gridRowEnd=wide?`span ${Math.max(1,Math.ceil(content.getBoundingClientRect().height/8))}`:'';}}
  const resize='ResizeObserver' in window?new ResizeObserver(schedule):null;
  function enhance(){
    resize?.disconnect();
    [...grid.children].forEach((story,index)=>{
      if(!story.querySelector('.story-content')){
        const meta=story.querySelector('.story-meta'),sources=story.querySelector('.story-sources');
        if(meta&&sources){
          if(!meta.querySelector('time')&&sources.querySelector('time')){for(const span of meta.querySelectorAll('span'))if(span.textContent==='發布時間未提供')span.remove();meta.append(sources.querySelector('time'));}
          const seen=new Set([...meta.querySelectorAll('time')].map(t=>Date.parse(t.dateTime)));
          for(const link of [...sources.querySelectorAll('.source-link')])meta.append(link);
          for(const time of [...sources.querySelectorAll('time')]){const key=Date.parse(time.dateTime);if(!seen.has(key)){seen.add(key);meta.append(time);}}
          if(meta.querySelector('.source-link'))sources.remove();
        }
        const summary=story.querySelector('.story-summary'),photo=story.querySelector('.news-photo');
        if(summary){const body=el('div',undefined,'story-body');story.insertBefore(body,photo||summary);if(photo)body.append(photo);body.append(summary);}
        story.classList.add(['story--image-left','story--image-right','story--image-top'][index%3]);
        const content=el('div',undefined,'story-content');content.append(...story.childNodes);story.append(content);
      }
      resize?.observe(story.querySelector('.story-content'));
    });schedule();
  }
  new MutationObserver(enhance).observe(grid,{childList:true});
  new MutationObserver(schedule).observe($('edition-panel'),{attributes:true,attributeFilter:['hidden']});
  // The original reader briefly resets the loading title; do not restore the retired subtitle.
  const title=document.querySelector('title');new MutationObserver(()=>{const clean=document.title.replace(' · 每日情報報','');if(document.title!==clean)document.title=clean;}).observe(title,{childList:true});
  window.addEventListener('resize',schedule,{passive:true});document.fonts?.ready.then(schedule);enhance();
  if($('dispatch-board')){
    for(const key of Object.keys(headings))unavailable(key,'調閱資料中…');
    const refresh=()=>{loadMarkets().then(loadFX).catch(()=>{});loadWeather().catch(()=>{});};refresh();
    let lastRefresh=Date.now();document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>30*60*1000){lastRefresh=Date.now();refresh();}});
    setInterval(()=>{if(!document.hidden){lastRefresh=Date.now();refresh();}},30*60*1000);
  }
})();
