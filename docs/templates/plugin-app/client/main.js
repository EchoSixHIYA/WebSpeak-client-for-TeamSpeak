const host=window.webspeak;
let context=await host.ready;
const copy={
 en:['Your application starts here','Standard browser APIs, your own routes and an optional Node backend.','Connected application context','Participant','Scope','Call my backend','Persisted requests','Frontend only'],
 zh:['从这里构建你的应用','使用标准浏览器 API、自定义路由和可选的 Node 后端。','应用上下文已连接','参与者','作用域','调用自己的后端','已保存的请求次数','仅前端模式'],
 de:['Hier beginnt deine Anwendung','Browser-APIs, eigene Routen und ein optionales Node-Backend.','Anwendungskontext verbunden','Teilnehmer','Bereich','Backend aufrufen','Gespeicherte Anfragen','Nur Frontend'],
 ru:['Начните своё приложение здесь','API браузера, собственные маршруты и необязательный сервис Node.','Контекст приложения подключён','Участник','Область','Вызвать свой сервис','Сохранённые запросы','Только браузер'],
 ja:['ここからアプリを作成','標準ブラウザー API、独自ルート、任意の Node バックエンド。','アプリの接続情報を取得済み','参加者','範囲','バックエンドを呼び出す','保存したリクエスト数','フロントエンドのみ']};
const element=id=>document.getElementById(id);
function render(){const t=copy[context.language]??copy.en;for(const [id,index]of [['title',0],['intro',1],['status',2],['user-label',3],['scope-label',4],['request',5]])element(id).textContent=t[index];element('user').textContent=context.self.nickname;element('scope').textContent=context.scope.type;element('request').disabled=!context.serverUrl;if(!context.serverUrl)element('result').textContent=t[7];}
host.onContextChange(next=>{context=next;render();});render();
element('request').addEventListener('click',async()=>{element('request').disabled=true;try{const response=await fetch(context.serverUrl+'/my-counter',{method:'POST',signal:host.signal});if(!response.ok)throw new Error(String(response.status));const result=await response.json();element('result').textContent=(copy[context.language]??copy.en)[6]+': '+result.count;}catch(error){element('result').textContent=error.message;}finally{element('request').disabled=!context.serverUrl;}});
