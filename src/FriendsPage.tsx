import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LoaderCircle, MessageCircle, Phone, PhoneOff, Send, UserPlus, Users, X } from 'lucide-react';
import { translateUi, type AppLanguage } from './i18n';

type FriendsPageProps = {
  account: WestronAccount | null;
  gameRunning: boolean;
  language: AppLanguage;
  isActive: boolean;
  onOpenAccount: () => void;
  onIncomingCall: () => void;
};

type ActiveCall = {
  callId: string;
  friendUserId: string;
  friendUsername: string;
  status: 'calling' | 'connecting' | 'active';
};

type IncomingCall = {
  callId: string;
  fromUserId: string;
  fromUsername: string;
  sdp: string;
};

const EMPTY_FRIENDS: WestronFriendList = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
};

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'İstek tamamlanamadı.';
}

function isMissingFriendsApi(reason: unknown) {
  return errorMessage(reason).includes('Westron Skin API uç noktası sunucuda bulunamadı (404)');
}

function waitForIceGathering(peer: RTCPeerConnection, timeoutMs = 15_000) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', checkState);
      if (error) reject(error);
      else resolve();
    };
    const checkState = () => {
      if (peer.iceGatheringState === 'complete') finish();
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Arama için ağ bağlantısı hazırlanamadı. TURN sunucusu gerekebilir.')),
      timeoutMs,
    );
    peer.addEventListener('icegatheringstatechange', checkState);
    checkState();
  });
}

export default function FriendsPage({
  account,
  gameRunning,
  language,
  isActive,
  onOpenAccount,
  onIncomingCall,
}: FriendsPageProps) {
  const text = (value: string) => translateUi(language, value);
  const [friendList, setFriendList] = useState<WestronFriendList>(EMPTY_FRIENDS);
  const [messages, setMessages] = useState<WestronEphemeralMessage[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [username, setUsername] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [openedMessage, setOpenedMessage] = useState<WestronConsumedEphemeralMessage | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [presenceError, setPresenceError] = useState('');
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const signalPollBusyRef = useRef(false);
  const callTimeoutRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const incomingCallNotificationRef = useRef(onIncomingCall);
  const selectedFriend = friendList.friends.find((friend) => friend.userId === selectedFriendId) ?? null;

  function setCurrentCall(call: ActiveCall | null) {
    activeCallRef.current = call;
    setActiveCall(call);
  }

  function setIncoming(call: IncomingCall | null) {
    incomingCallRef.current = call;
    setIncomingCall(call);
  }

  function closePeerConnection() {
    if (callTimeoutRef.current !== null) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    setCurrentCall(null);
    setIncoming(null);
  }

  function reportApiError(reason: unknown) {
    if (isMissingFriendsApi(reason)) {
      setApiUnavailable(true);
      setError('');
      setPresenceError('');
      return;
    }
    setError(errorMessage(reason));
  }

  useEffect(() => {
    incomingCallNotificationRef.current = onIncomingCall;
  }, [onIncomingCall]);

  useEffect(() => {
    if (!account?.emailVerified || apiUnavailable) {
      setPresenceError('');
      return undefined;
    }

    let active = true;
    const heartbeat = () => {
      void window.nocturne.updateWestronPresence({ inGame: gameRunning }).then(() => {
        if (active) setPresenceError('');
      }).catch((reason: unknown) => {
        if (!active) return;
        if (isMissingFriendsApi(reason)) setApiUnavailable(true);
        else setPresenceError(errorMessage(reason));
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [account?.username, account?.emailVerified, gameRunning, apiUnavailable]);

  useEffect(() => {
    if (!account?.emailVerified) {
      setApiUnavailable(false);
      setFriendList(EMPTY_FRIENDS);
      setMessages([]);
      setSelectedFriendId('');
      closePeerConnection();
      return undefined;
    }
    if (apiUnavailable) return undefined;

    let active = true;
    const refreshSocialState = async () => {
      try {
        const [nextFriends, nextMessages] = await Promise.all([
          window.nocturne.listWestronFriends(),
          window.nocturne.listWestronEphemeralMessages(),
        ]);
        if (!active) return;
        setFriendList(nextFriends);
        setMessages(nextMessages);
        setError('');
      } catch (reason) {
        if (active) reportApiError(reason);
      }
    };
    const receiveSignals = async () => {
      if (signalPollBusyRef.current) return;
      signalPollBusyRef.current = true;
      try {
        const signals = await window.nocturne.consumeWestronVoiceCallSignals();
        for (const signal of signals) {
          if (signal.type === 'offer') {
            if (activeCallRef.current || incomingCallRef.current) {
              await window.nocturne.sendWestronVoiceCallSignal({
                recipientUserId: signal.fromUserId,
                callId: signal.callId,
                type: 'reject',
                sdp: '',
              });
            } else {
              setIncoming({
                callId: signal.callId,
                fromUserId: signal.fromUserId,
                fromUsername: signal.fromUsername,
                sdp: signal.sdp,
              });
              setSelectedFriendId(signal.fromUserId);
              incomingCallNotificationRef.current();
            }
            continue;
          }

          const currentCall = activeCallRef.current;
          if (currentCall?.callId === signal.callId && signal.type === 'answer' && peerRef.current) {
            if (callTimeoutRef.current !== null) {
              window.clearTimeout(callTimeoutRef.current);
              callTimeoutRef.current = null;
            }
            await peerRef.current.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            setCurrentCall({ ...currentCall, status: 'connecting' });
          } else if (currentCall?.callId === signal.callId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            closePeerConnection();
            if (signal.type === 'reject') setNotice(text('Sesli arama reddedildi.'));
          } else if (incomingCallRef.current?.callId === signal.callId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            closePeerConnection();
          }
        }
      } catch (reason) {
        if (active) reportApiError(reason);
      } finally {
        signalPollBusyRef.current = false;
      }
    };

    if (isActive) {
      void refreshSocialState();
      void receiveSignals();
    }
    const socialInterval = window.setInterval(() => {
      if (isActive) void refreshSocialState();
    }, 15_000);
    const signalInterval = window.setInterval(() => {
      void receiveSignals();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(socialInterval);
      window.clearInterval(signalInterval);
    };
  }, [account?.username, account?.emailVerified, isActive, language, apiUnavailable]);

  useEffect(() => () => {
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    setOpenedMessage(null);
  }, [selectedFriendId]);

  useEffect(() => {
    if (!isActive) setOpenedMessage(null);
  }, [isActive]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function submitFriendRequest(event: FormEvent) {
    event.preventDefault();
    setBusy('request');
    setError('');
    try {
      const result = await window.nocturne.sendWestronFriendRequest({ username: username.trim() });
      setNotice(text(result.message));
      setUsername('');
      setFriendList(await window.nocturne.listWestronFriends());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function respondToRequest(request: WestronFriendRequest, accept: boolean) {
    setBusy(request.requestId);
    setError('');
    try {
      const result = await window.nocturne.respondWestronFriendRequest({ requestId: request.requestId, accept });
      setNotice(text(result.message));
      setFriendList(await window.nocturne.listWestronFriends());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function removeFriend(friend: WestronFriend) {
    if (!window.confirm(text('Bu arkadaşı kaldırmak istiyor musunuz?'))) return;
    setBusy(friend.userId);
    setError('');
    try {
      if (activeCallRef.current?.friendUserId === friend.userId) await endVoiceCall();
      if (incomingCallRef.current?.fromUserId === friend.userId) await rejectIncomingCall();
      const result = await window.nocturne.removeWestronFriend({ userId: friend.userId });
      setNotice(text(result.message));
      setFriendList(await window.nocturne.listWestronFriends());
      setMessages((items) => items.filter((message) => message.senderUserId !== friend.userId));
      if (selectedFriendId === friend.userId) setSelectedFriendId('');
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedFriend || !messageBody.trim()) return;
    setBusy('message');
    setError('');
    try {
      await window.nocturne.sendWestronEphemeralMessage({
        recipientUserId: selectedFriend.userId,
        body: messageBody.trim(),
      });
      setMessageBody('');
      setNotice(text('Tek kullanımlık mesaj gönderildi.'));
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function openMessage(message: WestronEphemeralMessage) {
    setBusy(message.messageId);
    setError('');
    try {
      const opened = await window.nocturne.consumeWestronEphemeralMessage({ messageId: message.messageId });
      setMessages((items) => items.filter((item) => item.messageId !== message.messageId));
      setOpenedMessage(opened);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function createPeerConnection() {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Bu cihazda sesli arama desteklenmiyor.');
    }
    const { iceServers } = await window.nocturne.getWestronVoiceCallIceServers();
    const peer = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 4 });
    peerRef.current = peer;
    peer.ontrack = (event) => {
      const audio = remoteAudioRef.current;
      if (!audio) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch((reason: unknown) => setError(errorMessage(reason)));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') {
        const current = activeCallRef.current;
        if (current) setCurrentCall({ ...current, status: 'active' });
      } else if (peer.connectionState === 'failed') {
        setError(text('Sesli arama bağlantısı kurulamadı. TURN sunucusu gerekebilir.'));
        closePeerConnection();
      }
    };

    return peer;
  }

  async function addLocalAudio(peer: RTCPeerConnection) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: 48_000,
      },
    });
    localStreamRef.current = stream;
    for (const track of stream.getAudioTracks()) {
      const sender = peer.addTrack(track, stream);
      const transceiver = peer.getTransceivers().find((item) => item.sender === sender);
      const capabilities = RTCRtpSender.getCapabilities?.('audio');
      if (capabilities && transceiver?.setCodecPreferences) {
        const opusCodecs = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus');
        if (opusCodecs.length) {
          transceiver.setCodecPreferences([
            ...opusCodecs,
            ...capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'audio/opus'),
          ]);
        }
      }
    }
  }

  async function startVoiceCall(friend: WestronFriend) {
    if (activeCallRef.current || incomingCallRef.current) return;
    const call: ActiveCall = {
      callId: crypto.randomUUID(),
      friendUserId: friend.userId,
      friendUsername: friend.username,
      status: 'calling',
    };
    setCurrentCall(call);
    setBusy('call');
    setError('');
    try {
      const peer = await createPeerConnection();
      await addLocalAudio(peer);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: friend.userId,
        callId: call.callId,
        type: 'offer',
        sdp: peer.localDescription?.sdp ?? '',
      });
      callTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === call.callId) {
          setError(text('Arama yanıtlanmadı.'));
          void endVoiceCall();
        }
      }, 60_000);
    } catch (reason) {
      closePeerConnection();
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function acceptIncomingCall() {
    const request = incomingCallRef.current;
    if (!request) return;
    const call: ActiveCall = {
      callId: request.callId,
      friendUserId: request.fromUserId,
      friendUsername: request.fromUsername,
      status: 'connecting',
    };
    setCurrentCall(call);
    setIncoming(null);
    setBusy('call');
    setError('');
    try {
      const peer = await createPeerConnection();
      await peer.setRemoteDescription({ type: 'offer', sdp: request.sdp });
      await addLocalAudio(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: request.fromUserId,
        callId: request.callId,
        type: 'answer',
        sdp: peer.localDescription?.sdp ?? '',
      });
    } catch (reason) {
      closePeerConnection();
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function rejectIncomingCall() {
    const request = incomingCallRef.current;
    if (!request) return;
    setIncoming(null);
    try {
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: request.fromUserId,
        callId: request.callId,
        type: 'reject',
        sdp: '',
      });
    } catch (reason) {
      reportApiError(reason);
    }
  }

  async function endVoiceCall() {
    const call = activeCallRef.current;
    closePeerConnection();
    if (!call) return;
    try {
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: call.friendUserId,
        callId: call.callId,
        type: 'hangup',
        sdp: '',
      });
    } catch (reason) {
      reportApiError(reason);
    }
  }

  const selectedMessages = selectedFriend
    ? messages.filter((message) => message.senderUserId === selectedFriend.userId)
    : [];

  return (
    <section className="friends-page" hidden={!isActive} aria-label={text('Arkadaşlar')}>
      <header className="page-heading">
        <div>
          <div className="eyebrow">{text('SOSYAL')}</div>
          <h1>{text('Arkadaşlar')}</h1>
          <p>{text('Arkadaş ekle, tek kullanımlık mesaj gönder ve sesli konuş.')}</p>
        </div>
      </header>

      {apiUnavailable ? (
        <div className="friends-alert friends-alert-warning" role="status">
          <span>{text('Arkadaşlar hizmeti henüz sunucuda etkin değil. Sunucu güncellemesi tamamlanınca yeniden deneyin.')}</span>
          <button className="text-button" onClick={() => {
            setApiUnavailable(false);
            setError('');
            setPresenceError('');
          }} type="button">{text('Yeniden dene')}</button>
        </div>
      ) : (
        <>
          {error && <div className="friends-alert friends-alert-error" role="alert">{text(error)}</div>}
          {presenceError && <div className="friends-alert friends-alert-warning" role="status">{text('Çevrimiçi durumu güncellenemedi.')}: {text(presenceError)}</div>}
        </>
      )}
      {notice && <div className="friends-alert friends-alert-success" role="status"><Check size={15} />{notice}</div>}

      {!account ? (
        <section className="friends-panel friends-login-panel">
          <Users size={28} />
          <h2>{text('Arkadaşlar için Westron hesabınıza giriş yapın.')}</h2>
          <button className="button button-primary" type="button" onClick={onOpenAccount}>
            {text('Hesaba git')}
          </button>
        </section>
      ) : !account.emailVerified ? (
        <section className="friends-panel friends-login-panel">
          <h2>{text('Arkadaşlık özellikleri için e-posta adresinizi doğrulayın.')}</h2>
          <button className="button button-secondary" type="button" onClick={onOpenAccount}>
            {text('Hesaba git')}
          </button>
        </section>
      ) : (
        <div className="friends-layout">
          <aside className="friends-sidebar">
            <section className="friends-panel">
              <h2><UserPlus size={16} />{text('Arkadaş ekle')}</h2>
              <form className="friends-add-form" onSubmit={(event) => void submitFriendRequest(event)}>
                <input
                  aria-label={text('Westron kullanıcı adı')}
                  autoComplete="off"
                  maxLength={16}
                  minLength={3}
                  pattern="[A-Za-z0-9_]{3,16}"
                  placeholder={text('Westron kullanıcı adı')}
                  required
                  value={username}
                  disabled={apiUnavailable}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button className="button button-primary button-small" disabled={busy !== '' || apiUnavailable} type="submit">
                  {busy === 'request' ? <LoaderCircle className="spin" size={14} /> : <UserPlus size={14} />}
                  {text('İstek gönder')}
                </button>
              </form>
            </section>

            <section className="friends-panel">
              <h2>{text('Gelen istekler')} <span className="friends-count">{friendList.incomingRequests.length}</span></h2>
              {friendList.incomingRequests.length ? (
                <ul className="friends-requests">
                  {friendList.incomingRequests.map((request) => (
                    <li key={request.requestId}>
                      <strong>{request.username}</strong>
                      <div>
                        <button
                          className="friends-icon-action"
                          aria-label={`${text('Kabul et')}: ${request.username}`}
                          disabled={busy !== '' || apiUnavailable}
                          onClick={() => void respondToRequest(request, true)}
                          type="button"
                        ><Check size={15} /></button>
                        <button
                          className="friends-icon-action friends-action-danger"
                          aria-label={`${text('Reddet')}: ${request.username}`}
                          disabled={busy !== '' || apiUnavailable}
                          onClick={() => void respondToRequest(request, false)}
                          type="button"
                        ><X size={15} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="friends-muted">{text('Gelen istek yok.')}</p>}
              {friendList.outgoingRequests.length > 0 && (
                <p className="friends-muted">{text('Bekleyen giden istekler')}: {friendList.outgoingRequests.map((request) => request.username).join(', ')}</p>
              )}
            </section>

            <section className="friends-panel">
              <h2>{text('Arkadaşların')} <span className="friends-count">{friendList.friends.length}</span></h2>
              {friendList.friends.length ? (
                <ul className="friends-list">
                  {friendList.friends.map((friend) => (
                    <li className={selectedFriendId === friend.userId ? 'selected' : ''} key={friend.userId}>
                      <button
                        className="friends-select"
                        disabled={busy !== '' || apiUnavailable}
                        onClick={() => setSelectedFriendId(friend.userId)}
                        type="button"
                      >
                        <span className={`friends-presence-dot ${friend.online ? 'online' : 'offline'}`} />
                        <span className="friends-identity">
                          <strong>{friend.username}</strong>
                          <small>{text(friend.inGame ? 'Oyunda' : friend.online ? 'Çevrimiçi' : 'Çevrimdışı')}</small>
                        </span>
                      </button>
                      <button
                        className="friends-icon-action friends-remove-action"
                        aria-label={`${text('Arkadaşı kaldır')}: ${friend.username}`}
                        disabled={busy !== '' || apiUnavailable}
                        onClick={() => void removeFriend(friend)}
                        title={text('Arkadaşı kaldır')}
                        type="button"
                      ><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="friends-muted">{text('Henüz arkadaş eklemediniz.')}</p>}
            </section>
          </aside>

          <section className="friends-panel friends-chat-panel">
            {selectedFriend ? (
              <>
                <header className="friends-chat-header">
                  <div>
                    <span className={`friends-presence-dot ${selectedFriend.online ? 'online' : 'offline'}`} />
                    <div className="friends-identity">
                      <strong>{selectedFriend.username}</strong>
                      <small>{text(selectedFriend.inGame ? 'Oyunda' : selectedFriend.online ? 'Çevrimiçi' : 'Çevrimdışı')}</small>
                    </div>
                  </div>
                  <button
                    className="button button-secondary button-small"
                    disabled={busy !== '' || apiUnavailable || !selectedFriend.online || Boolean(activeCall)}
                    onClick={() => void startVoiceCall(selectedFriend)}
                    type="button"
                  >
                    {busy === 'call' ? <LoaderCircle className="spin" size={14} /> : <Phone size={14} />}
                    {text('Sesli ara')}
                  </button>
                </header>

                {incomingCall && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text('Gelen sesli arama')}: <strong>{incomingCall.fromUsername}</strong></span></div>
                    <button className="button button-primary button-small" disabled={busy !== '' || apiUnavailable} onClick={() => void acceptIncomingCall()} type="button">{text('Kabul et')}</button>
                    <button className="button button-secondary button-small" disabled={busy !== '' || apiUnavailable} onClick={() => void rejectIncomingCall()} type="button">{text('Reddet')}</button>
                  </div>
                )}
                {activeCall && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text(activeCall.status === 'active' ? 'Sesli arama sürüyor' : 'Bağlanıyor…')}: <strong>{activeCall.friendUsername}</strong></span></div>
                    <button className="button button-secondary button-small" disabled={busy === 'call'} onClick={() => void endVoiceCall()} type="button">
                      <PhoneOff size={14} />{text('Aramayı bitir')}
                    </button>
                  </div>
                )}
                <audio ref={remoteAudioRef} autoPlay />

                <div className="friends-message-area">
                  {openedMessage ? (
                    <article className="friends-opened-message">
                      <div><MessageCircle size={15} /><strong>{openedMessage.senderUsername}</strong><span>{text('Tek kullanımlık mesaj')}</span></div>
                      <p>{openedMessage.body}</p>
                      <button className="text-button" onClick={() => setOpenedMessage(null)} type="button">{text('Mesajı kapat')}</button>
                    </article>
                  ) : selectedMessages.length ? (
                    <div className="friends-inbox">
                      <h3>{text('Gelen tek kullanımlık mesajlar')}</h3>
                      {selectedMessages.map((message) => (
                        <button
                          className="friends-inbox-message"
                          disabled={busy !== '' || apiUnavailable}
                          key={message.messageId}
                          onClick={() => void openMessage(message)}
                          type="button"
                        >
                          <MessageCircle size={15} />
                          <span>{text('Bir mesajınız var')}</span>
                          {busy === message.messageId ? <LoaderCircle className="spin" size={14} /> : <span>{text('Mesajı aç')}</span>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="friends-empty-chat">
                      <MessageCircle size={23} />
                      <p>{text('Henüz açılmamış mesaj yok.')}</p>
                    </div>
                  )}
                </div>
                <form className="friends-message-form" onSubmit={(event) => void sendMessage(event)}>
                  <textarea
                    aria-label={text('Tek kullanımlık mesaj')}
                    maxLength={2000}
                    placeholder={text('Mesajınızı yazın…')}
                    rows={2}
                    value={messageBody}
                    disabled={apiUnavailable}
                    onChange={(event) => setMessageBody(event.target.value)}
                  />
                  <button className="button button-primary" disabled={busy !== '' || apiUnavailable || !messageBody.trim()} type="submit">
                    {busy === 'message' ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                    {text('Gönder')}
                  </button>
                  <small>{text('Mesaj alıcı tarafından ilk açılışta sunucudan silinir.')}</small>
                </form>
              </>
            ) : (
              <div className="friends-empty-chat">
                <Users size={28} />
                <p>{text('Sohbet etmek için bir arkadaş seçin.')}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
