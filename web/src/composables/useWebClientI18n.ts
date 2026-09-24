import type { Ref } from "vue";

import { webClientTranslations, type Language } from "../i18n/web-client.js";

export function useWebClientI18n(language: Ref<Language>) {

function t(key: string, variables: Record<string, string | number> = {}) {
  let value = webClientTranslations[language.value][key] ?? webClientTranslations.en[key] ?? webClientTranslations.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}

function localizedMessage(message: string) {
  if (language.value === "zh") return message;
  const localizedExact: Record<string, string> = language.value === "ru" ? {
    "该服务器需要密码，请输入密码后重试": "Для этого сервера требуется пароль. Введите его и повторите попытку",
    "服务器密码错误，请重新输入": "Неверный пароль сервера. Введите его ещё раз",
    "昵称长度不符合 TeamSpeak 服务器要求，至少 3 个字符，请修改后重试": "Длина имени не соответствует требованиям TeamSpeak (не менее 3 символов). Измените имя и повторите попытку",
    "TeamSpeak 服务器地址无效": "Неверный адрес сервера TeamSpeak",
    "找不到 TeamSpeak 服务器主机名，请检查地址": "Не удалось найти сервер TeamSpeak. Проверьте адрес",
    "无法到达 TeamSpeak 服务器，请检查网络或地址": "Сервер TeamSpeak недоступен. Проверьте сеть или адрес",
    "TeamSpeak 服务器拒绝了连接，请检查端口和服务状态": "Сервер TeamSpeak отклонил подключение. Проверьте порт и состояние службы",
    "连接 TeamSpeak 超时，请检查网络或服务器状态": "Истекло время подключения к TeamSpeak. Проверьте сеть и состояние сервера",
    "你没有执行此操作的权限": "У вас нет права выполнять это действие",
  } : {
    "该服务器需要密码，请输入密码后重试": "このサーバーにはパスワードが必要です。入力して再試行してください",
    "服务器密码错误，请重新输入": "サーバーパスワードが正しくありません。もう一度入力してください",
    "昵称长度不符合 TeamSpeak 服务器要求，至少 3 个字符，请修改后重试": "ニックネームの長さが TeamSpeak の要件を満たしていません（3文字以上）。変更して再試行してください",
    "TeamSpeak 服务器地址无效": "TeamSpeak サーバーアドレスが正しくありません",
    "找不到 TeamSpeak 服务器主机名，请检查地址": "TeamSpeak サーバーが見つかりません。アドレスを確認してください",
    "无法到达 TeamSpeak 服务器，请检查网络或地址": "TeamSpeak サーバーに到達できません。ネットワークまたはアドレスを確認してください",
    "TeamSpeak 服务器拒绝了连接，请检查端口和服务状态": "TeamSpeak サーバーが接続を拒否しました。ポートとサービスの状態を確認してください",
    "连接 TeamSpeak 超时，请检查网络或服务器状态": "TeamSpeak への接続がタイムアウトしました。ネットワークとサーバーの状態を確認してください",
    "你没有执行此操作的权限": "この操作を実行する権限がありません",
  };
  if ((language.value === "ru" || language.value === "ja") && localizedExact[message]) return localizedExact[message];
  const errorCodeMatch = message.match(/错误代码：([A-Z0-9_-]{1,64})）(?:：([^，。]+))?/);
  if (errorCodeMatch) {
    const code = errorCodeMatch[1];
    const detail = errorCodeMatch[2] ? `: ${errorCodeMatch[2]}` : "";
    const operation = message.startsWith("操作失败");
    if (language.value === "de") return `${operation ? "Vorgang" : "TeamSpeak-Verbindung"} fehlgeschlagen (Fehlercode: ${code})${detail}. Prüfe Eingaben, Netzwerk und Serverstatus`;
    if (language.value === "ru") return `${operation ? "Операция" : "Подключение TeamSpeak"} не выполнена (код ошибки: ${code})${detail}. Проверьте ввод, сеть и состояние сервера`;
    if (language.value === "ja") return `${operation ? "操作" : "TeamSpeak 接続"}に失敗しました（エラーコード: ${code}）${detail}。入力、ネットワーク、サーバーの状態を確認してください`;
    return `${operation ? "Operation" : "TeamSpeak connection"} failed (error code: ${code})${detail}. Check your input, network, and server status`;
  }
  const exact: Record<string, string> = {
    "语音功能需要 HTTPS 安全连接": "Voice requires a secure HTTPS connection",
    "当前浏览器不支持麦克风访问": "This browser does not support microphone access",
    "当前浏览器不支持 Web Audio 音频处理": "This browser does not support Web Audio processing",
    "当前浏览器不支持音频解码，请使用最新版 Chrome 或 Edge": "Audio decoding is unavailable. Use the latest Chrome or Edge",
    "当前浏览器不支持扬声器设备选择，将使用默认输出设备": "Output device selection is not supported by this browser. Using the default output device",
    "所选扬声器当前不可用": "The selected speaker is not available",
    "连接服务器失败，请检查邀请链接或服务器状态": "Could not connect. Check the invite link or server status",
    "请求来源不受信任，请从正确的网站入口重新打开": "The request origin is not trusted. Reopen the official WebSpeak page",
    "WebSpeak 尚未完成配置，请联系管理员": "WebSpeak has not been configured yet. Contact the administrator",
    "请求过于频繁，请稍后重试": "Too many requests. Try again shortly",
    "当前中继加速不可用，请关闭加速或联系管理员": "The selected relay is unavailable. Turn off relay mode or contact the administrator",
    "邀请链接已失效或已被撤销": "The invite link is invalid, expired, or revoked",
    "TeamSpeak 连接已断开": "The TeamSpeak connection was closed",
    "连接已断开": "The connection was closed",
    "此 TeamSpeak 身份已在另一个浏览器页面使用，请关闭另一条连接或取消“保持身份”后重试": "This TeamSpeak identity is already used by another browser page. Close that connection or clear ‘Remember identity’ and try again",
    "TeamSpeak 服务器地址无效": "The TeamSpeak server address is invalid",
    "昵称长度不符合 TeamSpeak 服务器要求，至少 3 个字符，请修改后重试": "The nickname length does not meet the TeamSpeak server requirements (at least 3 characters). Change it and try again",
    "TeamSpeak 服务器连接失败": "Could not connect to the TeamSpeak server",
    "找不到 TeamSpeak 服务器主机名，请检查地址": "The TeamSpeak server hostname could not be resolved. Check the address",
    "无法到达 TeamSpeak 服务器，请检查网络或地址": "The TeamSpeak server is unreachable. Check the network or address",
    "TeamSpeak 服务器拒绝了连接，请检查端口和服务状态": "The TeamSpeak server refused the connection. Check the port and server status",
    "TeamSpeak 连接被服务器或网络重置，请稍后重试": "The TeamSpeak connection was reset by the server or network. Try again shortly",
    "连接 TeamSpeak 超时，请检查网络或服务器状态": "The TeamSpeak connection timed out. Check the network or server status",
    "该服务器需要密码，请输入密码后重试": "This server requires a password. Enter it and try again",
    "服务器密码错误，请重新输入": "The server password is incorrect. Enter it again",
    "TeamSpeak 协议协商失败": "TeamSpeak protocol negotiation failed",
    "TeamSpeak 服务器拒绝了连接": "The TeamSpeak server rejected the connection",
    "TeamSpeak 连接失败，请检查地址、网络或服务器状态": "TeamSpeak connection failed. Check the address, network, or server status",
    "服务器当前已满，请稍后重试": "The server is full. Try again shortly",
    "服务器当前已满或拒绝了连接，请稍后重试": "The server is full or rejected the connection. Try again shortly",
    "WebSpeak 尚未配置 TeamSpeak 目标。": "The WebSpeak TeamSpeak target has not been configured",
    "此 TeamSpeak 服务器地址不允许连接": "This TeamSpeak server address is not allowed",
    "请输入有效的昵称": "Enter a valid nickname",
    "消息格式无效": "The message format is invalid",
    "请求标识无效": "The request id is invalid",
    "不支持的操作": "This operation is not supported",
    "操作参数无效": "The operation payload is invalid",
    "频道标识无效": "The channel id is invalid",
    "成员标识无效": "The member id is invalid",
    "频道密码无效": "The channel password is invalid",
    "文字消息无效": "The text message is invalid",
    "戳一戳消息无效": "The poke message is invalid",
    "离开状态无效": "The away status is invalid",
    "音频帧格式无效": "The audio frame is invalid",
    "私语目标无效": "The whisper targets are invalid",
    "私语状态无效": "The whisper state is invalid",
    "请先选择私语目标": "Choose a whisper target first",
    "私语目标已离线": "A whisper target is offline",
    "TeamSpeak 会话尚未就绪": "The TeamSpeak session is not ready",
    "频道切换失败": "Channel switch failed",
    "该频道需要密码": "This channel requires a password",
    "该频道已满": "This channel is full",
    "你没有执行此操作的权限": "You do not have permission to perform this action",
    "不能移动自己的客户端": "You cannot move yourself",
    "目标频道不可用": "The target channel is unavailable",
    "成员已离线或当前不可见": "The member is offline or no longer visible",
    "成员已离线": "This member is offline",
    "操作失败": "The operation failed",
    "语音会话票据缺失或已过期，请返回列表重新进入语音空间": "The voice session token is missing or expired. Return to the list and enter the voice space again",
    "语音网关拒绝了本次连接：身份无效，请取消“保持身份”后重新进入": "The voice gateway rejected the connection because the identity is invalid. Clear ‘Remember identity’ and try again",
    "语音网关拒绝了本次连接：身份无效或无法在此页面使用，请取消“保持身份”后重新进入": "The voice gateway rejected the connection because the identity is invalid or unavailable on this page. Clear ‘Remember identity’ and try again",
    "当前中继加速不可用，请关闭加速后重试或联系管理员": "The selected relay is unavailable. Turn off relay mode and try again, or contact the administrator",
    "与语音网关的网络连接异常中断（掉线或代理断开），并非 TeamSpeak 服务器拒绝连接，请检查网络后重新进入": "The voice gateway connection was interrupted (offline or proxy disconnected); the TeamSpeak server did not reject it. Check your network and enter again",
    "语音网关会话意外结束，请重新进入语音空间": "The voice gateway session ended unexpectedly. Enter the voice space again",
    "语音网关未能创建 TeamSpeak 客户端（服务器可能已关闭或地址不可达），请确认服务器地址或稍后重试": "The voice gateway could not create a TeamSpeak client. The server may be offline or unreachable; check the address and try again",
    "该昵称已被服务器上的其他用户占用，请更换昵称": "This nickname is already in use on the server. Choose another one",
    "该昵称已被占用，请更换昵称": "This nickname is already in use. Choose another one",
    "你的身份安全等级低于该服务器要求，请提升后重试": "Your identity security level is below what this server requires. Raise it and try again",
    "该身份建立的连接数已达上限，请关闭其他连接后重试": "This identity reached its connection limit. Close the other connections and try again",
    "客户端版本过旧，服务器拒绝连接，请升级后重试": "Your client version is outdated and the server rejected the connection. Update and try again",
    "客户端版本过旧，服务器拒绝了该操作": "Your client version is outdated, so the server rejected this action",
    "操作过于频繁，已被服务器洪水防护暂时拒绝，请稍后重试": "Too many requests: the server flood protection rejected you temporarily. Try again shortly",
    "操作过于频繁，请稍后重试": "Too many requests. Try again shortly",
    "你已被该服务器封禁，无法连接": "You are banned from this server, so the connection is refused",
    "你已被该服务器封禁": "You are banned from this server",
    "你已被服务器移出": "You were removed from the server",
    "TeamSpeak 服务器正在关闭，暂时无法连接": "The TeamSpeak server is shutting down and is unreachable right now",
    "TeamSpeak 服务器未能完成连接初始化，请检查地址、端口或稍后重试": "The TeamSpeak server could not finish initialising the connection. Check the address and port, or try again shortly",
    "TeamSpeak 服务器拒绝了参数，通常是昵称长度或格式不合规": "The TeamSpeak server rejected the parameters, usually because the nickname length or format is invalid",
  };
  if (language.value === "en" && exact[message]) return exact[message];
  if (message.startsWith("麦克风访问失败：")) {
    const detail = message.slice(8);
    if (language.value === "ru") return `Не удалось получить доступ к микрофону: ${detail}`;
    if (language.value === "ja") return `マイクへのアクセスに失敗しました: ${detail}`;
    return language.value === "de" ? `Mikrofonzugriff fehlgeschlagen: ${detail}` : `Microphone access failed: ${detail}`;
  }
  if (message.startsWith("切换失败：")) {
    const detail = message.slice(5);
    if (language.value === "ru") return `Не удалось переключить канал: ${detail}`;
    if (language.value === "ja") return `チャンネルの切り替えに失敗しました: ${detail}`;
    return language.value === "de" ? `Kanalwechsel fehlgeschlagen: ${detail}` : `Channel switch failed: ${detail}`;
  }
  if (language.value === "de") {
    const german: Record<string, string> = {
      "语音功能需要 HTTPS 安全连接": "Für Sprachfunktionen ist eine sichere HTTPS-Verbindung erforderlich",
      "当前浏览器不支持麦克风访问": "Dieser Browser unterstützt keinen Mikrofonzugriff",
      "当前浏览器不支持 Web Audio 音频处理": "Dieser Browser unterstützt keine Web-Audio-Verarbeitung",
      "连接服务器失败，请检查邀请链接或服务器状态": "Verbindung fehlgeschlagen. Prüfe den Einladungslink oder den Serverstatus",
      "请求来源不受信任，请从正确的网站入口重新打开": "Die Anfragequelle ist nicht vertrauenswürdig. Öffne die offizielle WebSpeak-Seite erneut",
      "WebSpeak 尚未完成配置，请联系管理员": "WebSpeak wurde noch nicht konfiguriert. Wende dich an den Administrator",
      "请求过于频繁，请稍后重试": "Zu viele Anfragen. Versuche es gleich erneut",
      "当前中继加速不可用，请关闭加速或联系管理员": "Das ausgewählte Relay ist nicht verfügbar. Deaktiviere den Relay-Modus oder wende dich an den Administrator",
      "邀请链接已失效或已被撤销": "Der Einladungslink ist ungültig, abgelaufen oder widerrufen",
      "TeamSpeak 连接已断开": "Die TeamSpeak-Verbindung wurde getrennt",
      "连接已断开": "Die Verbindung wurde getrennt",
      "TeamSpeak 服务器地址无效": "Die TeamSpeak-Serveradresse ist ungültig",
      "昵称长度不符合 TeamSpeak 服务器要求，至少 3 个字符，请修改后重试": "Die Länge des Spitznamens entspricht nicht den Anforderungen des TeamSpeak-Servers (mindestens 3 Zeichen). Ändere ihn und versuche es erneut",
      "请输入有效的昵称": "Gib einen gültigen Nicknamen ein",
      "找不到 TeamSpeak 服务器主机名，请检查地址": "Der TeamSpeak-Servername konnte nicht aufgelöst werden. Prüfe die Adresse",
      "无法到达 TeamSpeak 服务器，请检查网络或地址": "Der TeamSpeak-Server ist nicht erreichbar. Prüfe Netzwerk und Adresse",
      "TeamSpeak 服务器拒绝了连接，请检查端口和服务状态": "Der TeamSpeak-Server hat die Verbindung abgelehnt. Prüfe Port und Serverstatus",
      "TeamSpeak 连接被服务器或网络重置，请稍后重试": "Die TeamSpeak-Verbindung wurde vom Server oder Netzwerk zurückgesetzt. Versuche es später erneut",
      "连接 TeamSpeak 超时，请检查网络或服务器状态": "Die TeamSpeak-Verbindung hat das Zeitlimit überschritten. Prüfe Netzwerk und Serverstatus",
      "该服务器需要密码，请输入密码后重试": "Dieser Server benötigt ein Passwort. Gib es ein und versuche es erneut",
      "服务器密码错误，请重新输入": "Das Serverpasswort ist falsch. Gib es erneut ein",
      "TeamSpeak 协议协商失败": "Die Aushandlung des TeamSpeak-Protokolls ist fehlgeschlagen",
      "TeamSpeak 服务器拒绝了连接": "Der TeamSpeak-Server hat die Verbindung abgelehnt",
      "TeamSpeak 连接失败，请检查地址、网络或服务器状态": "Die TeamSpeak-Verbindung ist fehlgeschlagen. Prüfe Adresse, Netzwerk und Serverstatus",
      "服务器当前已满或拒绝了连接，请稍后重试": "Der Server ist voll oder hat die Verbindung abgelehnt. Versuche es später erneut",
      "服务器当前已满，请稍后重试": "Der Server ist derzeit voll. Versuche es später erneut",
      "该昵称已被服务器上的其他用户占用，请更换昵称": "Dieser Spitzname wird auf dem Server bereits verwendet. Wähle einen anderen",
      "该昵称已被占用，请更换昵称": "Dieser Spitzname wird bereits verwendet. Wähle einen anderen",
      "你的身份安全等级低于该服务器要求，请提升后重试": "Deine Sicherheitsstufe liegt unter der Anforderung dieses Servers. Erhöhe sie und versuche es erneut",
      "该身份建立的连接数已达上限，请关闭其他连接后重试": "Diese Identität hat ihr Verbindungslimit erreicht. Schließe die anderen Verbindungen und versuche es erneut",
      "客户端版本过旧，服务器拒绝连接，请升级后重试": "Deine Client-Version ist veraltet und der Server hat die Verbindung abgelehnt. Aktualisiere und versuche es erneut",
      "客户端版本过旧，服务器拒绝了该操作": "Deine Client-Version ist veraltet, daher hat der Server diese Aktion abgelehnt",
      "操作过于频繁，已被服务器洪水防护暂时拒绝，请稍后重试": "Zu viele Anfragen: Der Flood-Schutz des Servers hat dich vorübergehend abgewiesen. Versuche es gleich erneut",
      "操作过于频繁，请稍后重试": "Zu viele Anfragen. Versuche es gleich erneut",
      "你已被该服务器封禁，无法连接": "Du wurdest von diesem Server gebannt und kannst nicht verbinden",
      "你已被该服务器封禁": "Du wurdest von diesem Server gebannt",
      "你已被服务器移出": "Du wurdest vom Server entfernt",
      "TeamSpeak 服务器正在关闭，暂时无法连接": "Der TeamSpeak-Server wird heruntergefahren und ist derzeit nicht erreichbar",
      "TeamSpeak 服务器未能完成连接初始化，请检查地址、端口或稍后重试": "Der TeamSpeak-Server konnte die Verbindungsinitialisierung nicht abschließen. Prüfe Adresse und Port oder versuche es später erneut",
      "TeamSpeak 服务器拒绝了参数，通常是昵称长度或格式不合规": "Der TeamSpeak-Server hat die Parameter abgelehnt, meist wegen ungültiger Länge oder ungültigen Formats des Spitznamens",
      "此 TeamSpeak 身份已在另一个浏览器页面使用，请关闭另一条连接或取消“保持身份”后重试": "Diese TeamSpeak-Identität wird bereits in einem anderen Browser-Tab verwendet. Schließe die andere Verbindung oder deaktiviere „Identität merken“ und versuche es erneut",
      "语音会话票据缺失或已过期，请返回列表重新进入语音空间": "Der Sprachsitzungs-Token fehlt oder ist abgelaufen. Kehre zur Liste zurück und tritt dem Sprachraum erneut bei",
      "语音网关拒绝了本次连接：身份无效，请取消“保持身份”后重新进入": "Das Sprach-Gateway hat die Verbindung abgelehnt: Die Identität ist ungültig. Deaktiviere „Identität merken“ und tritt erneut bei",
      "语音网关拒绝了本次连接：身份无效或无法在此页面使用，请取消“保持身份”后重新进入": "Das Sprach-Gateway hat die Verbindung abgelehnt: Die Identität ist ungültig oder kann auf dieser Seite nicht verwendet werden. Deaktiviere „Identität merken“ und tritt erneut bei",
      "当前中继加速不可用，请关闭加速后重试或联系管理员": "Der beschleunigte Relay-Modus ist nicht verfügbar. Deaktiviere ihn und versuche es erneut oder wende dich an den Administrator",
      "与语音网关的网络连接异常中断（掉线或代理断开），并非 TeamSpeak 服务器拒绝连接，请检查网络后重新进入": "Die Verbindung zum Sprach-Gateway wurde unerwartet unterbrochen (Offline oder Proxy getrennt) – der TeamSpeak-Server hat die Verbindung nicht abgelehnt. Prüfe deine Netzwerkverbindung und tritt erneut bei",
      "语音网关会话意外结束，请重新进入语音空间": "Die Sprach-Gateway-Sitzung wurde unerwartet beendet. Tritt dem Sprachraum erneut bei",
      "语音网关未能创建 TeamSpeak 客户端（服务器可能已关闭或地址不可达），请确认服务器地址或稍后重试": "Das Sprach-Gateway konnte keinen TeamSpeak-Client erstellen (der Server ist möglicherweise aus oder nicht erreichbar). Prüfe die Serveradresse oder versuche es später erneut",
      "消息格式无效": "Ungültiges Nachrichtenformat",
      "请求标识无效": "Ungültige Anforderungs-ID",
      "不支持的操作": "Nicht unterstützte Operation",
      "操作参数无效": "Ungültige Operationsparameter",
      "频道标识无效": "Ungültige Kanal-ID",
      "频道密码无效": "Ungültiges Kanalpasswort",
      "成员标识无效": "Ungültige Mitglieds-ID",
      "文字消息无效": "Ungültige Textnachricht",
      "戳一戳消息无效": "Ungültige Poke-Nachricht",
      "离开状态无效": "Ungültiger Abwesenheitsstatus",
      "音频帧格式无效": "Ungültiges Audio-Frame-Format",
      "成员音量无效": "Ungültige Mitgliedslautstärke",
      "私语目标无效": "Ungültige Flüsterziele",
      "私语状态无效": "Ungültiger Flüsterstatus",
      "请先选择私语目标": "Wähle zuerst ein Flüsterziel",
      "TeamSpeak 会话尚未就绪": "Die TeamSpeak-Sitzung ist noch nicht bereit",
      "频道切换失败": "Kanalwechsel fehlgeschlagen",
      "该频道需要密码": "Dieser Kanal erfordert ein Passwort",
      "该频道已满": "Dieser Kanal ist voll",
      "你没有执行此操作的权限": "Du hast keine Berechtigung für diese Aktion",
      "不能移动自己的客户端": "Du kannst dich nicht selbst verschieben",
      "目标频道不可用": "Der Zielkanal ist nicht verfügbar",
      "成员已离线或当前不可见": "Das Mitglied ist offline oder nicht mehr sichtbar",
      "成员已离线": "Das Mitglied ist offline",
      "操作失败": "Operation fehlgeschlagen",
    };
    if (german[message]) return german[message];
    if (message.startsWith("麦克风访问失败：")) return `Mikrofonzugriff fehlgeschlagen: ${message.slice(8)}`;
    if (message.startsWith("麦克风声音未能发送：")) return `Mikrofon-Audio konnte nicht gesendet werden: ${message.slice(10)}`;
    if (message.startsWith("音频链路异常")) return message.replace("音频链路异常", "Audioverbindung fehlerhaft");
  }
  if (language.value === "ru") return exact[message] ?? "Не удалось выполнить операцию. Проверьте ввод, сеть и состояние сервера";
  if (language.value === "ja") return exact[message] ?? "操作に失敗しました。入力、ネットワーク、サーバーの状態を確認してください";
  return exact[message] ?? message;
}

function localizedAudioNotice(code: string, message: string) {
  if (language.value === "zh") return message;
  const normalizedCode = visibleErrorCode(code || "AUDIO_NOTICE");
  const messages: Record<string, { en: string; de: string; ru: string; ja: string }> = {
    WEBRTC_FALLBACK: {
      en: `WebRTC realtime voice is unavailable (error code: ${normalizedCode}). Compatibility transport is active; latency and audio quality may be lower`,
      de: `Echtzeitstimme über WebRTC ist nicht verfügbar (Fehlercode: ${normalizedCode}). Der Kompatibilitätstransport ist aktiv; Latenz und Audioqualität können schlechter sein`,
      ru: `Голосовая связь WebRTC недоступна (код ошибки: ${normalizedCode}). Используется совместимый транспорт; задержка и качество звука могут быть ниже`,
      ja: `WebRTC のリアルタイム音声は利用できません（エラーコード: ${normalizedCode}）。互換トランスポートを使用するため、遅延や音質が低下する場合があります`,
    },
    PLAYBACK_BLOCKED: {
      en: "The browser blocked automatic audio playback. Click the page or allow audio playback for this site",
      de: "Der Browser hat die automatische Audiowiedergabe blockiert. Klicke auf die Seite oder erlaube die Audiowiedergabe für diese Website",
      ru: "Браузер заблокировал автоматическое воспроизведение. Нажмите на страницу или разрешите воспроизведение для этого сайта",
      ja: "ブラウザが自動再生をブロックしました。ページをクリックするか、このサイトの再生を許可してください",
    },
    DEVICE_LIST_UNAVAILABLE: {
      en: "Audio devices could not be listed. The browser default devices will be used",
      de: "Audiogeräte konnten nicht aufgelistet werden. Die Standardgeräte des Browsers werden verwendet",
      ru: "Не удалось получить список аудиоустройств. Будут использованы устройства браузера по умолчанию",
      ja: "オーディオデバイスを一覧表示できません。ブラウザのデフォルトデバイスを使用します",
    },
    AUDIO_CONTEXT_SUSPENDED: {
      en: "Browser audio processing is paused. Click the page once to resume microphone and speaker audio",
      de: "Die Audioverarbeitung des Browsers ist pausiert. Klicke einmal auf die Seite, um Mikrofon und Lautsprecher fortzusetzen",
      ru: "Обработка звука браузером приостановлена. Нажмите на страницу, чтобы возобновить работу микрофона и динамиков",
      ja: "ブラウザの音声処理が一時停止しています。ページを一度クリックしてマイクとスピーカーを再開してください",
    },
    AUDIO_ENCODER_UNAVAILABLE: {
      en: `Microphone audio could not be encoded (error code: ${normalizedCode}). Other members may not hear you`,
      de: `Mikrofon-Audio konnte nicht kodiert werden (Fehlercode: ${normalizedCode}). Andere Mitglieder hören dich möglicherweise nicht`,
      ru: `Не удалось кодировать звук микрофона (код ошибки: ${normalizedCode}). Другие участники могут вас не слышать`,
      ja: `マイク音声をエンコードできませんでした（エラーコード: ${normalizedCode}）。他のメンバーに音声が届かない可能性があります`,
    },
  };
  const locale = language.value === "de" ? "de" : language.value === "ru" ? "ru" : language.value === "ja" ? "ja" : "en";
  return messages[code]?.[locale] ?? localizedMessage(message);
}

function visibleErrorCode(code: string): string {
  const normalized = String(code || "CONNECTION_FAILED")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (normalized || "CONNECTION_FAILED").slice(0, 64);
}

  return { t, localizedMessage, localizedAudioNotice, visibleErrorCode };

}
