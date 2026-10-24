/* Uses only the public plugin API. Nothing here imports WebSpeak internals. */
(async () => {
  const api = window.webspeak, context = await api.ready;
  const $ = id => document.getElementById(id), video = $('video');
  const language = context.language, zh = language === 'zh';
  const texts = {
    zh: ['一起观看','所有参与者共享播放、暂停和进度；音量仅影响自己。','视频直链','载入视频','允许播放','请使用浏览器支持的 MP4 / WebM 视频直链。不会把视频经过 WebSpeak 服务器转发。','浏览器阻止自动播放，请点击“允许播放”。','视频无法加载，请检查地址、格式与 HTTPS。','有人同时操作，已获取最新进度，请重试。'],
    en: ['Watch Together','Playback, pause and seeking are shared; volume is local.','Direct video URL','Load video','Enable playback','Use a browser-compatible MP4 / WebM URL. Video is fetched directly, never relayed by WebSpeak.','Autoplay was blocked. Click Enable playback.','Video could not load. Check URL, format and HTTPS.','Another participant changed playback. Refreshed; please try again.'],
    de: ['Gemeinsam ansehen','Wiedergabe, Pause und Position sind gemeinsam; Lautstärke ist lokal.','Direkte Video-URL','Video laden','Wiedergabe erlauben','Browserkompatible MP4-/WebM-URL verwenden. Video wird direkt geladen.','Autoplay blockiert. Wiedergabe erlauben anklicken.','Video nicht ladbar. URL, Format und HTTPS prüfen.','Gleichzeitige Änderung. Aktualisiert; erneut versuchen.'],
    ru: ['Смотреть вместе','Воспроизведение, пауза и позиция общие; громкость локальная.','Прямая ссылка на видео','Загрузить видео','Разрешить воспроизведение','Используйте прямую ссылку MP4 / WebM. Видео загружается напрямую.','Автовоспроизведение заблокировано. Нажмите Разрешить воспроизведение.','Не удалось загрузить видео. Проверьте адрес, формат и HTTPS.','Другой участник изменил состояние. Обновлено; повторите.'],
    ja: ['一緒に見る','再生・停止・位置を共有します。音量は自分の端末のみです。','動画の直接 URL','動画を読み込む','再生を許可','ブラウザー対応の MP4 / WebM URL を使用します。動画は直接取得されます。','自動再生がブロックされました。「再生を許可」を押してください。','動画を読み込めません。URL・形式・HTTPS を確認してください。','他の参加者が操作しました。最新状態で再試行してください。'],
  };
  const t = texts[language] || texts.en;
  ['title','lead','url-label','load','unlock','note'].forEach((id,i) => $(id).textContent=t[i]);
  $('play').ariaLabel=zh?'同步播放':'Play for everyone'; $('pause').ariaLabel=zh?'同步暂停':'Pause for everyone';
  $('fullscreen').ariaLabel=zh?'全屏':'Fullscreen';
  let snapshot=context.snapshot, offset=snapshot.serverTime-Date.now(), source='', busy=false, seeking=false, playingAttempt=false;
  video.volume=.7;
  function validState(value) {
    if(!value || typeof value.url!=='string' || value.url.length>2048 || typeof value.playing!=='boolean' || !Number.isFinite(value.position) || value.position<0 || value.position>604800 || !Number.isFinite(value.updatedAt)) return null;
    try {const u=new URL(value.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;}catch{return null;}
    return value;
  }
  function targetPosition(state) {return Math.max(0,Math.min(604800,state.position+(state.playing?Math.max(0,(Date.now()+offset-state.updatedAt)/1000):0)));}
  function status(message='') {$('status').textContent=message;}
  async function apply() {
    const state=validState(snapshot.state); if(!state)return;
    if(source!==state.url){source=state.url;video.src=source;$('url').value=source;video.load();}
    const desired=targetPosition(state);
    if(Number.isFinite(video.duration)&&video.duration>0&&desired>=video.duration){video.pause();video.playbackRate=1;return;}
    if(video.readyState>=1 && !seeking){const diff=desired-video.currentTime;
      if(Math.abs(diff)>(state.playing?.7:.04))video.currentTime=Math.min(desired,Number.isFinite(video.duration)?video.duration:desired);
      video.playbackRate=state.playing&&Math.abs(diff)>.15&&Math.abs(diff)<=.7?(diff>0?1.03:.97):1;
    }
    if(state.playing&&video.paused&&!playingAttempt){playingAttempt=true;try{await video.play();status();}catch{status(t[6]);}finally{playingAttempt=false;}}
    else if(!state.playing&&!video.paused)video.pause();
  }
  function receive(next) {if(next.roomId!==snapshot.roomId || next.revision<snapshot.revision)return;snapshot=next;offset=next.serverTime-Date.now();$('members').textContent=(zh?'参与者：':'Participants: ')+next.participants.length;void apply();}
  async function update(patch) {
    if(busy)return;busy=true;
    try {
      const state=validState(snapshot.state), next={url:state?.url||source,position:state?targetPosition(state):0,playing:state?.playing||false,updatedAt:Date.now()+offset,...patch};
      if(!validState(next))throw new Error(t[7]);
      receive(await api.room.update(snapshot.revision,next)); status();
    } catch(error){if(error.message==='PLUGIN_REVISION_CONFLICT'){receive(await api.room.snapshot());status(t[8]);}else status(error.message);}
    finally{busy=false;}
  }
  const load=()=>{if($('url').checkValidity())void update({url:$('url').value.trim(),position:0,playing:false});else $('url').reportValidity();};
  $('load').addEventListener('click',load);
  $('source').addEventListener('submit',event=>event.preventDefault());
  $('url').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();load();}});
  $('play').addEventListener('click',()=>{void video.play().catch(()=>status(t[6]));void update({playing:true});});
  $('pause').addEventListener('click',()=>void update({playing:false,position:video.currentTime}));
  $('unlock').addEventListener('click',()=>{void video.play().then(()=>{if(!snapshot.state?.playing)video.pause();status();}).catch(()=>status(t[6]));});
  $('fullscreen').addEventListener('click',()=>void video.requestFullscreen?.().catch(()=>undefined));
  $('volume').addEventListener('input',()=>video.volume=Number($('volume').value));
  $('seek').addEventListener('input',()=>{seeking=true;});
  $('seek').addEventListener('change',()=>{seeking=false;void update({position:Number($('seek').value)});});
  video.addEventListener('loadedmetadata',()=>void apply()); video.addEventListener('error',()=>status(t[7]));
  video.addEventListener('ended',()=>{video.playbackRate=1;});
  const time=value=>`${Math.floor(value/60)}:${Math.floor(value%60).toString().padStart(2,'0')}`;
  const timer=setInterval(()=>{void apply();const duration=Number.isFinite(video.duration)?video.duration:0;$('seek').max=String(duration||1);if(!seeking)$('seek').value=String(video.currentTime);$('time').textContent=`${time(video.currentTime)} / ${time(duration)}`;},1000);
  const unsubscribe=api.room.subscribe(receive);receive(snapshot);
  addEventListener('pagehide',()=>{clearInterval(timer);unsubscribe();video.pause();video.removeAttribute('src');video.load();},{once:true});
})();
